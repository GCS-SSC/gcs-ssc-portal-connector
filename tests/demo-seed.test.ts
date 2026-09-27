import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { seedHealthCanadaPortalConnector } from '../server/demo-seed.ts'
import type { ConnectorDatabase } from '../server/db.ts'

const databases: Kysely<ConnectorDatabase>[] = []
const fixture = async () => {
  const db = new Kysely<ConnectorDatabase>({ dialect: new KyselyPGlite().dialect })
  databases.push(db)
  await sql`CREATE SCHEMA extensions`.execute(db)
  await sql`CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY, egcs_ay_name_en text, _deleted boolean)`.execute(db)
  await sql`CREATE TABLE "Applicant_Recipient_Profile" (id bigint PRIMARY KEY,
    egcs_ar_legalname_en text, egcs_ar_leadagency bigint, _deleted boolean)`.execute(db)
  await sql`CREATE TABLE "Funding_Case_Agreement_Profile" (id bigint PRIMARY KEY,
    egcs_fc_title_en text, _deleted boolean)`.execute(db)
  await sql`CREATE TABLE "Funding_Case_Agreement_Applicant_Recipient"
    (egcs_fc_fundingagreement bigint, egcs_fc_applicantrecipient bigint, _deleted boolean)`.execute(db)
  await sql`CREATE TABLE extensions.agency_enablement (id bigserial PRIMARY KEY,
    extension_key text, agency_id bigint, enabled boolean, config jsonb, _deleted boolean DEFAULT false)`.execute(db)
  await sql`INSERT INTO "Agency_Profile" VALUES (11,'Health Canada',false)`.execute(db)
  await sql`INSERT INTO "Applicant_Recipient_Profile" VALUES (21,'Shopify Inc.',11,false)`.execute(db)
  await sql`INSERT INTO "Funding_Case_Agreement_Profile" VALUES
    (31,'Health Canada Cost Agreement 1 - Showcase',false)`.execute(db)
  await sql`INSERT INTO "Funding_Case_Agreement_Applicant_Recipient" VALUES (31,21,false)`.execute(db)
  return db
}

const options = {
  portalUrl: 'http://localhost:3000/',
  portalAgencyId: 'G-NFAFV',
  portalKey: 'gcs_PgdzCAcAAc5UJO42TvnGK8QgSQSv-fWhM-vTd0sfyPo',
  organizations: [
    { id: 'N-GHDXW', name: 'Shopify Inc.', description: 'A', ownerName: 'Alice', ownerEmail: 'a@example.ca', memberCount: 2, agreementCount: 0, active: true },
    { id: 'N-YXWBF', name: 'Northern Community Health Initiative', description: 'B', ownerName: 'Bob', ownerEmail: 'b@example.ca', memberCount: 1, agreementCount: 0, active: true },
    { id: 'N-7G9CZ', name: 'Former Health Partnership', description: 'C', ownerName: 'Carol', ownerEmail: 'c@example.ca', memberCount: 0, agreementCount: 0, active: false }
  ]
}

afterEach(async () => { for (const db of databases.splice(0)) await db.destroy() })

describe('Health Canada Portal demo seed', () => {
  it('enables first, then caches organizations without making a connection or verification', async () => {
    const db = await fixture()
    expect(await seedHealthCanadaPortalConnector(db, options)).toEqual({
      phase: 'restart-required', agencyId: '11', agreementId: '31', proponentId: '21', proponentName: 'Shopify Inc.'
    })
    expect((await sql<{ enabled: boolean }>`SELECT enabled FROM extensions.agency_enablement`.execute(db)).rows)
      .toEqual([{ enabled: true }])
    await sql`CREATE TABLE extensions.gcs_portal_connection (agency_id bigint PRIMARY KEY)`.execute(db)
    await sql`CREATE TABLE extensions.gcs_portal_organization (
      agency_id bigint, portal_organization_id text, name text, description text,
      owner_name text, owner_email text, member_count integer, agreement_count integer,
      active boolean, synced_at timestamptz DEFAULT now(), PRIMARY KEY (agency_id,portal_organization_id))`.execute(db)
    await sql`CREATE TABLE extensions.gcs_portal_verification (portal_organization_id text)`.execute(db)
    await sql`CREATE TABLE extensions.gcs_portal_identity (portal_organization_id text)`.execute(db)
    expect((await seedHealthCanadaPortalConnector(db, options)).phase).toBe('ready')
    expect((await seedHealthCanadaPortalConnector(db, options)).phase).toBe('ready')
    expect((await sql<{ count: string }>`SELECT count(*)::text AS count FROM extensions.gcs_portal_organization`.execute(db)).rows[0]?.count).toBe('3')
    expect((await sql<{ count: string }>`SELECT count(*)::text AS count FROM extensions.gcs_portal_connection`.execute(db)).rows[0]?.count).toBe('0')
    expect((await sql<{ count: string }>`SELECT count(*)::text AS count FROM extensions.gcs_portal_verification`.execute(db)).rows[0]?.count).toBe('0')
    expect((await sql<{ count: string }>`SELECT count(*)::text AS count FROM extensions.gcs_portal_identity`.execute(db)).rows[0]?.count).toBe('0')
  })

  it('refuses a showcase Proponent that the verification route cannot use', async () => {
    const db = await fixture()
    await sql`UPDATE "Applicant_Recipient_Profile" SET egcs_ar_leadagency=12`.execute(db)
    await expect(seedHealthCanadaPortalConnector(db, options)).rejects.toThrow('not Health Canada-owned')
    expect((await sql<{ count: string }>`SELECT count(*)::text AS count FROM extensions.agency_enablement`.execute(db)).rows[0]?.count).toBe('0')
  })
})
