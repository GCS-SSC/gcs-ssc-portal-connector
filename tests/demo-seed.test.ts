import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_APPLICATION_FORM_ID, seedHealthCanadaPortalConnector } from '../server/demo-seed.ts'
import type { ConnectorDatabase } from '../server/db.ts'
import { initializeLocalPortalDemo } from '../server/local-demo.ts'
import { getEncryptedExtensionSecret } from '@gcs-ssc/extensions/server'
import migration0010 from '../server/migrations/0010_portal_operations.ts'
import { drainOperations } from '../server/operations.ts'
import { designerSurveySchema } from '@gcs-ssc/survey'
import { formPublicationIssues } from '../server/form-readiness.ts'

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

afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); for (const db of databases.splice(0)) await db.destroy() })

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

  it('accepts a showcase Proponent led by another agency', async () => {
    const db = await fixture()
    await sql`UPDATE "Applicant_Recipient_Profile" SET egcs_ar_leadagency=12`.execute(db)
    await expect(seedHealthCanadaPortalConnector(db, options)).resolves.toMatchObject({
      phase: 'restart-required', agencyId: '11', proponentId: '21'
    })
  })
})

const readyFixture = async () => {
  const db = await fixture()
  await sql`CREATE TABLE extensions.gcs_portal_connection (
    agency_id bigint PRIMARY KEY, portal_agency_id text, portal_url text, scan_cursor text,
    portal_status_ids jsonb, entity_status_ids jsonb, pull_interval_minutes integer,
    last_pull_at timestamptz, last_pull_error text, pull_lease_until timestamptz, updated_at timestamptz
  )`.execute(db)
  await sql`CREATE TABLE extensions.gcs_portal_organization (agency_id bigint)`.execute(db)
  await sql`CREATE TABLE extensions.secret_entry (
    id bigserial PRIMARY KEY, extension_key text, owner_type text, owner_id text, secret_key text,
    ciphertext text, iv text, auth_tag text, algorithm text, key_version integer,
    metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz, _deleted boolean DEFAULT false
  )`.execute(db)
  await migration0010.up(db)
  await seedHealthCanadaPortalConnector(db, { ...options, organizations: [] })
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('GCS_PORTAL_DEMO_SEED', '1')
  vi.stubEnv('GCS_EXTENSION_SECRETS_KEY', 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=')
  vi.stubEnv('PORTAL_DEMO_URL', '')
  delete process.env.PORTAL_DEMO_URL
  return db
}

describe('automatic local Portal demo', () => {
  it('preconfigures an encrypted credential and queues one bilingual all-field form, preserving later edits', async () => {
    const db = await readyFixture()
    await initializeLocalPortalDemo(db)
    await initializeLocalPortalDemo(db)
    const connection = await db.selectFrom('extensions.gcs_portal_connection').selectAll().executeTakeFirstOrThrow()
    expect(connection.portal_url).toBe('http://localhost:3003/')
    expect(connection.portal_agency_id).toBe('G-NFAFV')
    const credential = await getEncryptedExtensionSecret(db, {
      rootKey: process.env.GCS_EXTENSION_SECRETS_KEY!, extensionKey: 'gcs-ssc-portal-connector',
      ownerType: 'agency', ownerId: '11', secretKey: 'portal-key'
    })
    expect(credential).toEqual({ key: options.portalKey })
    const form = await db.selectFrom('extensions.gcs_portal_form').selectAll().executeTakeFirstOrThrow()
    const definition = designerSurveySchema.parse(form.definition)
    expect(definition.pages).toHaveLength(4)
    expect(new Set(definition.questions.map(question => question.type)).size).toBe(14)
    expect(formPublicationIssues(definition)).toEqual([])
    expect(form.id).toBe(DEMO_APPLICATION_FORM_ID)
    expect(form.id).toMatch(/^V-[A-HJKMNP-Z2-9]{5,}$/)
    expect(await db.selectFrom('extensions.gcs_portal_operation').selectAll().execute()).toHaveLength(1)
    await db.updateTable('extensions.gcs_portal_form').set({ revision: 2 }).where('id', '=', form.id).execute()
    await db.updateTable('extensions.gcs_portal_connection').set({ portal_url: 'http://localhost:4003/' }).execute()
    await initializeLocalPortalDemo(db)
    expect((await db.selectFrom('extensions.gcs_portal_form').select('revision').executeTakeFirstOrThrow()).revision).toBe(2)
    expect((await db.selectFrom('extensions.gcs_portal_connection').select('portal_url').executeTakeFirstOrThrow()).portal_url).toBe('http://localhost:4003/')
  })

  it('retains the queued form while the portal is offline and delivers its full definition on recovery', async () => {
    const db = await readyFixture()
    await initializeLocalPortalDemo(db)
    const transport = vi.fn().mockRejectedValueOnce(new Error('Portal is offline'))
      .mockResolvedValue(Response.json({ survey: { id: 'V-ABCDE', revision: 1 } }))
    vi.stubGlobal('fetch', transport)
    expect((await drainOperations(db, 1)).results[0]?.delivered).toBe(false)
    expect((await db.selectFrom('extensions.gcs_portal_operation').select('state').executeTakeFirstOrThrow()).state).toBe('pending')
    await sql`UPDATE extensions.gcs_portal_operation SET next_attempt_at=now()`.execute(db)
    expect((await drainOperations(db, 1)).results[0]?.delivered).toBe(true)
    expect(String(transport.mock.calls[1]?.[0])).toBe('http://localhost:3003/api/government/surveys')
    const request = JSON.parse(transport.mock.calls[1]?.[1].body as string)
    expect(request.agencyId).toBe('G-NFAFV')
    expect(request.definition.pages).toHaveLength(4)
    expect(request.definition.attachments.enabled).toBe(true)
    expect((await db.selectFrom('extensions.gcs_portal_form').select(['portal_id', 'portal_revision']).executeTakeFirstOrThrow()))
      .toEqual({ portal_id: 'V-ABCDE', portal_revision: 1 })
    expect((await drainOperations(db, 1)).results).toEqual([])
  })

  it('does not initialize in production, when opted out, or after Health Canada disables the connector', async () => {
    const db = await readyFixture()
    vi.stubEnv('NODE_ENV', 'production')
    await initializeLocalPortalDemo(db)
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('GCS_PORTAL_DEMO_SEED', '0')
    await initializeLocalPortalDemo(db)
    vi.stubEnv('GCS_PORTAL_DEMO_SEED', '1')
    await sql`UPDATE extensions.agency_enablement SET enabled=false`.execute(db)
    await initializeLocalPortalDemo(db)
    expect((await seedHealthCanadaPortalConnector(db, { ...options, organizations: [], requireEnabled: true })).phase).toBe('disabled')
    expect((await sql<{ enabled: boolean }>`SELECT enabled FROM extensions.agency_enablement`.execute(db)).rows[0]?.enabled).toBe(false)
    expect(await db.selectFrom('extensions.gcs_portal_form').selectAll().execute()).toEqual([])
    expect(await db.selectFrom('extensions.gcs_portal_connection').selectAll().execute()).toEqual([])
  })
})
