import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { afterEach, describe, expect, it } from 'vitest'
import migration from '../server/migrations/0007_organization_verification.ts'

const databases: Kysely<unknown>[] = []
const legacyDatabase = async () => {
  const db = new Kysely<unknown>({ dialect: new KyselyPGlite().dialect })
  databases.push(db)
  await sql`CREATE SCHEMA extensions`.execute(db)
  await sql`CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY)`.execute(db)
  await sql`CREATE TABLE "Applicant_Recipient_Profile" (id bigint PRIMARY KEY)`.execute(db)
  await sql`CREATE TABLE "Funding_Case_Agreement_Profile" (id bigint PRIMARY KEY)`.execute(db)
  await sql`INSERT INTO "Agency_Profile" VALUES (11),(22)`.execute(db)
  await sql`INSERT INTO "Applicant_Recipient_Profile" VALUES (101),(102)`.execute(db)
  await sql`INSERT INTO "Funding_Case_Agreement_Profile" VALUES (201)`.execute(db)
  await sql`CREATE TABLE extensions.gcs_portal_identity (
    agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id), portal_organization_id text NOT NULL,
    proponent_id bigint NOT NULL, verified_at timestamptz NOT NULL,
    PRIMARY KEY (agency_id,portal_organization_id), UNIQUE (agency_id,proponent_id))`.execute(db)
  await sql`CREATE TABLE extensions.gcs_portal_outbox (
    id bigserial PRIMARY KEY, agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
    agreement_id bigint NOT NULL REFERENCES "Funding_Case_Agreement_Profile"(id),
    portal_organization_id text NOT NULL, proponent_id bigint NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','delivered')),
    last_error text, updated_at timestamptz NOT NULL DEFAULT now())`.execute(db)
  return db
}

afterEach(async () => { for (const db of databases.splice(0)) await db.destroy() })

describe('organization verification upgrade', () => {
  it('preserves older links as global history, allows a replacement and cancels stale pending work', async () => {
    const db = await legacyDatabase()
    await sql`INSERT INTO extensions.gcs_portal_identity VALUES
      (11,'N-ABCDE',101,'2025-01-01'),(22,'N-FGHIJ',101,'2025-02-01')`.execute(db)
    await sql`INSERT INTO extensions.gcs_portal_outbox
      (agency_id,agreement_id,portal_organization_id,proponent_id)
      VALUES (11,201,'N-ABCDE',101),(22,201,'N-FGHIJ',101)`.execute(db)
    await migration.up(db)
    const history = (await sql<{ portal_organization_id: string; proponent_id: string; portal_active: boolean }>`
      SELECT portal_organization_id,proponent_id::text,portal_active
      FROM extensions.gcs_portal_verification ORDER BY portal_organization_id`.execute(db)).rows
    expect(history).toEqual([
      { portal_organization_id: 'N-ABCDE', proponent_id: '101', portal_active: false },
      { portal_organization_id: 'N-FGHIJ', proponent_id: '101', portal_active: true }
    ])
    const queue = (await sql<{ portal_organization_id: string; state: string }>`
      SELECT portal_organization_id,state FROM extensions.gcs_portal_outbox
      ORDER BY portal_organization_id`.execute(db)).rows
    expect(queue).toEqual([
      { portal_organization_id: 'N-ABCDE', state: 'cancelled' },
      { portal_organization_id: 'N-FGHIJ', state: 'pending' }
    ])
    await sql`INSERT INTO extensions.gcs_portal_identity
      (agency_id,portal_organization_id,proponent_id,verified_at)
      VALUES (11,'N-KLMNP',101,now())`.execute(db)
    await expect(sql`INSERT INTO extensions.gcs_portal_verification
      (portal_organization_id,proponent_id,origin_agency_id,portal_active)
      VALUES ('N-KLMNP',101,11,true)`.execute(db)).rejects.toThrow()
    await sql`UPDATE extensions.gcs_portal_verification SET portal_active=false
      WHERE portal_organization_id='N-FGHIJ'`.execute(db)
    await sql`INSERT INTO extensions.gcs_portal_verification
      (portal_organization_id,proponent_id,origin_agency_id,portal_active)
      VALUES ('N-KLMNP',101,11,true)`.execute(db)
    expect((await sql<{ count: string }>`SELECT count(*)::text AS count
      FROM extensions.gcs_portal_verification WHERE proponent_id=101`.execute(db)).rows[0]?.count).toBe('3')
  })

  it('rejects conflicting deployed mappings for the same Portal organization', async () => {
    const db = await legacyDatabase()
    await sql`INSERT INTO extensions.gcs_portal_identity VALUES
      (11,'N-ABCDE',101,now()),(22,'N-ABCDE',102,now())`.execute(db)
    await expect(migration.up(db)).rejects.toThrow('conflict across agencies')
  })

  it('reuses one immutable global mapping for the same organization in two agencies', async () => {
    const db = await legacyDatabase()
    await sql`INSERT INTO extensions.gcs_portal_identity VALUES
      (11,'N-ABCDE',101,'2025-01-01'),(22,'N-ABCDE',101,'2025-02-01')`.execute(db)
    await migration.up(db)
    expect((await sql<{ count: string }>`SELECT count(*)::text AS count
      FROM extensions.gcs_portal_verification WHERE portal_organization_id='N-ABCDE'`.execute(db)).rows[0]?.count).toBe('1')
    expect((await sql<{ count: string }>`SELECT count(*)::text AS count
      FROM extensions.gcs_portal_identity WHERE portal_organization_id='N-ABCDE'`.execute(db)).rows[0]?.count).toBe('2')
  })

  it('queues an Agreement change only for the Agreement-owning agency', async () => {
    const db = await legacyDatabase()
    await sql`INSERT INTO extensions.gcs_portal_identity VALUES
      (11,'N-ABCDE',101,now()),(22,'N-ABCDE',101,now())`.execute(db)
    await migration.up(db)
    await sql`ALTER TABLE "Funding_Case_Agreement_Profile"
      ADD COLUMN egcs_fc_transferpaymentstream bigint, ADD COLUMN _deleted boolean DEFAULT false`.execute(db)
    await sql`CREATE TABLE "Transfer_Payment_Profile"
      (id bigint PRIMARY KEY,egcs_tp_agency bigint, _deleted boolean DEFAULT false)`.execute(db)
    await sql`CREATE TABLE "Transfer_Payment_Stream"
      (id bigint PRIMARY KEY,egcs_tp_transferpaymentprofile bigint,_deleted boolean DEFAULT false)`.execute(db)
    await sql`CREATE TABLE "Funding_Case_Agreement_Applicant_Recipient"
      (egcs_fc_fundingagreement bigint,egcs_fc_applicantrecipient bigint,_deleted boolean DEFAULT false)`.execute(db)
    await sql`CREATE TABLE extensions.gcs_portal_connection (agency_id bigint PRIMARY KEY)`.execute(db)
    await sql`INSERT INTO "Transfer_Payment_Profile"(id,egcs_tp_agency) VALUES (301,11)`.execute(db)
    await sql`INSERT INTO "Transfer_Payment_Stream"(id,egcs_tp_transferpaymentprofile) VALUES (401,301)`.execute(db)
    await sql`UPDATE "Funding_Case_Agreement_Profile" SET egcs_fc_transferpaymentstream=401 WHERE id=201`.execute(db)
    await sql`INSERT INTO "Funding_Case_Agreement_Applicant_Recipient"
      (egcs_fc_fundingagreement,egcs_fc_applicantrecipient) VALUES (201,101)`.execute(db)
    await sql`INSERT INTO extensions.gcs_portal_connection VALUES (11),(22)`.execute(db)
    await sql`CREATE TRIGGER test_agreement_change AFTER UPDATE ON "Funding_Case_Agreement_Profile"
      FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_agreement_change()`.execute(db)
    await sql`UPDATE "Funding_Case_Agreement_Profile" SET egcs_fc_transferpaymentstream=401 WHERE id=201`.execute(db)
    expect((await sql<{ agency_id: string }>`SELECT agency_id::text FROM extensions.gcs_portal_outbox`.execute(db)).rows)
      .toEqual([{ agency_id: '11' }])
  })
})
