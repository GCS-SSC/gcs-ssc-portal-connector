import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { getConnection, saveConnection, testConnection, readPortalCredential, secretOptions, connectionInput } from '../server/connection.ts'
import { getSettings, saveSettings } from '../server/settings.ts'
import { listPublications } from '../server/publications.ts'
import baseline from '../server/migrations/0001_portal_connector.ts'
import publications from '../server/migrations/0002_publication_history.ts'
import settings from '../server/migrations/0004_status_and_pull_settings.ts'

const db = new Kysely<unknown>({ dialect: new KyselyPGlite().dialect })
const key = `gcs_${'A'.repeat(43)}`
const input = { portalUrl: 'https://portal.example/', portalAgencyId: 'G-ABCDE', portalKey: key }
const selection = { portalStatusIds: [], entityStatusIds: { claim: [], forecast: [], funding_application: [], other_form: [] }, pullIntervalMinutes: null }
const network = vi.fn()
const context = (body: unknown = {}, agencyId = '1', params = {}) => ({
  db, params: { agencyId, ...params }, readBody: async () => body,
  writeAuthorization: { lockAuthState: async () => {}, authorizeCurrentScope: async () => {} }
}) as unknown as GcsExtensionRouteContext

beforeAll(async () => {
  const statements = [
    'CREATE SCHEMA extensions',
    'CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY)',
    'CREATE TABLE "Funding_Case_Agreement_Profile" (id bigint PRIMARY KEY, egcs_fc_transferpaymentstream bigint, _deleted boolean DEFAULT false)',
    'INSERT INTO "Agency_Profile" VALUES (1),(2)',
    'INSERT INTO "Funding_Case_Agreement_Profile" (id) VALUES (10),(20)'
  ]
  for (const statement of statements) await sql.raw(statement).execute(db)
  await baseline.up(db); await publications.up(db); await settings.up(db)
  await sql`ALTER TABLE extensions.gcs_ssc_portal_connector_connection ADD COLUMN entity_status_ids jsonb NOT NULL DEFAULT '{"claim":[],"forecast":[],"funding_application":[],"other_form":[]}'`.execute(db)
  for (const statement of [
    'CREATE TABLE extensions.secret_entry (id bigserial PRIMARY KEY, extension_key text, owner_type text, owner_id text, secret_key text, ciphertext text, iv text, auth_tag text, algorithm text, key_version integer, metadata jsonb, updated_at timestamptz, _deleted boolean)',
    'CREATE TABLE extensions.gcs_ssc_portal_connector_identity (agency_id bigint, portal_organization_id text, proponent_id bigint)',
    'CREATE TABLE extensions.gcs_ssc_portal_connector_operation (id bigserial PRIMARY KEY, agency_id bigint, state text, kind text, next_attempt_at timestamptz)',
    'CREATE TABLE "Common_Status" (id bigint PRIMARY KEY, egcs_cn_agency bigint, egcs_cn_name_en text, egcs_cn_name_fr text, _deleted boolean DEFAULT false)',
    `INSERT INTO "Common_Status" VALUES (11,1,'Active','Actif',false),(12,1,'Hidden','Caché',true),(21,2,'Other','Autre',false)`,
    'CREATE TABLE "Funding_Case_Agreement_Claim" (id bigint, egcs_fc_status bigint)',
    'CREATE TABLE "Funding_Case_Agreement_Forecast" (id bigint, egcs_fc_status bigint)',
    'CREATE TABLE "Funding_Case_Intake_Profile" (id bigint, egcs_fi_status bigint)',
    'CREATE TABLE extensions.gcs_ssc_portal_connector_outcome_outbox (agency_id bigint, receipt_id bigint, status_id bigint)',
    'CREATE TABLE extensions.gcs_ssc_portal_connector_outbox (id bigserial PRIMARY KEY, agency_id bigint, agreement_id bigint, portal_organization_id text, proponent_id bigint)',
    'CREATE TABLE extensions.gcs_ssc_portal_connector_verification (portal_organization_id text, portal_active boolean)',
    'CREATE TABLE "Funding_Case_Agreement_Applicant_Recipient" (egcs_fc_fundingagreement bigint, egcs_fc_applicantrecipient bigint, _deleted boolean)',
    'CREATE TABLE "Transfer_Payment_Stream" (id bigint, egcs_tp_transferpaymentprofile bigint, _deleted boolean)',
    'CREATE TABLE "Transfer_Payment_Profile" (id bigint, egcs_tp_agency bigint, _deleted boolean)'
  ]) await sql.raw(statement).execute(db)
})
beforeEach(async () => {
  vi.stubEnv('GCS_EXTENSION_SECRETS_KEY', Buffer.alloc(32, 7).toString('base64'))
  vi.stubGlobal('fetch', network)
  network.mockReset().mockImplementation(async () => Response.json({ programs: [], streams: [], calls: [] }))
  await sql`TRUNCATE extensions.gcs_ssc_portal_connector_connection, extensions.secret_entry,
    extensions.gcs_ssc_portal_connector_identity, extensions.gcs_ssc_portal_connector_operation,
    extensions.gcs_ssc_portal_connector_publication, extensions.gcs_ssc_portal_connector_receipt,
    extensions.gcs_ssc_portal_connector_outcome_outbox, extensions.gcs_ssc_portal_connector_outbox`.execute(db)
})
afterAll(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await db.destroy() })

it('encrypts credentials, retains and rotates them on edits, and isolates agencies', async () => {
  expect(await getConnection(context())).toEqual({ connection: null })
  const created = await saveConnection(context(input))
  expect(created.connection).toMatchObject({ hasCredential: true, revision: 1 })
  expect(JSON.stringify(created)).not.toContain(key)
  expect(await readPortalCredential(context(), '1')).toBe(key)
  expect(await getConnection(context({}, '2'))).toEqual({ connection: null })
  const updated = await saveConnection(context({ portalUrl: input.portalUrl, portalAgencyId: input.portalAgencyId }))
  expect(updated.connection?.revision).toBe(2)
  expect(await readPortalCredential(context(), '1')).toBe(key)
  await saveConnection(context({ ...input, portalKey: `gcs_${'B'.repeat(43)}` }))
  expect(await readPortalCredential(context(), '1')).toBe(`gcs_${'B'.repeat(43)}`)
  const secrets = (await sql<{ ciphertext: string }>`SELECT ciphertext FROM extensions.secret_entry`.execute(db)).rows
  expect(secrets).toHaveLength(1)
  expect(secrets[0]?.ciphertext).not.toContain(key)
})
it('tests without saving and requires credentials for a new connection', async () => {
  await expect(saveConnection(context({ portalUrl: input.portalUrl, portalAgencyId: input.portalAgencyId }))).rejects.toThrow('portal key is required')
  expect(await testConnection(context(input))).toEqual({ connected: true })
  expect(await getConnection(context())).toEqual({ connection: null })
  await saveConnection(context(input))
  expect(await testConnection(context({ portalUrl: input.portalUrl, portalAgencyId: input.portalAgencyId }))).toEqual({ connected: true })
  vi.stubEnv('GCS_EXTENSION_SECRETS_KEY', '')
  expect(() => secretOptions('1')).toThrow('GCS_EXTENSION_SECRETS_KEY is required')
})
it.each([[401, 'GCS_PORTAL_INVALID_CREDENTIAL'], [404, 'GCS_PORTAL_AGENCY_NOT_FOUND']])('provides public feedback for %s and recovers', async (status, code) => {
  network.mockResolvedValueOnce(new Response('private remote detail', { status: Number(status) }))
  await expect(saveConnection(context(input))).rejects.toMatchObject({ code })
  expect(await getConnection(context())).toEqual({ connection: null })
  expect((await saveConnection(context(input))).connection?.hasCredential).toBe(true)
})
it('propagates transport failures without persisting secrets', async () => {
  network.mockRejectedValueOnce(new Error('network offline'))
  await expect(saveConnection(context(input))).rejects.toThrow('network offline')
  network.mockResolvedValueOnce(new Response('', { status: 503 }))
  await expect(testConnection(context(input))).rejects.toThrow('503')
  expect((await sql`SELECT * FROM extensions.secret_entry`.execute(db)).rows).toHaveLength(0)
})
it('blocks portal switches with linked organizations or pending deliveries but permits key rotation', async () => {
  await saveConnection(context(input))
  await sql`INSERT INTO extensions.gcs_ssc_portal_connector_identity VALUES (1,'N-ABCDE',100)`.execute(db)
  await expect(saveConnection(context({ ...input, portalUrl: 'https://other.example/' }))).rejects.toThrow('cannot switch portals')
  await saveConnection(context(input))
  await sql`DELETE FROM extensions.gcs_ssc_portal_connector_identity`.execute(db)
  await sql`INSERT INTO extensions.gcs_ssc_portal_connector_operation (agency_id,state,kind) VALUES (1,'pending','form')`.execute(db)
  await expect(saveConnection(context({ ...input, portalAgencyId: 'G-FGHJK' }))).rejects.toThrow('Deliver pending')
  await sql`UPDATE extensions.gcs_ssc_portal_connector_operation SET state='delivered'`.execute(db)
  expect((await saveConnection(context({ ...input, portalAgencyId: 'G-FGHJK' }))).connection?.portalAgencyId).toBe('G-FGHJK')
})
it.each(['http://remote.example/', 'https://name:password@example.com/', 'https://example.com/path', 'https://example.com/?secret=1', 'https://example.com/#hash'])('rejects unsafe origin %s', portalUrl => {
  expect(connectionInput.safeParse({ ...input, portalUrl }).success).toBe(false)
})
it('lists only active agency statuses and saves deduplicated settings', async () => {
  expect(await getSettings(context())).toEqual({ statuses: [{ id: '11', name_en: 'Active', name_fr: 'Actif' }], settings: null })
  await expect(saveSettings(context(selection))).rejects.toThrow('Connect the portal first')
  await saveConnection(context(input))
  for (const id of ['21', '12']) await expect(saveSettings(context({ ...selection, portalStatusIds: [id] }))).rejects.toThrow('unavailable in this agency')
  const result = await saveSettings(context({ ...selection, portalStatusIds: ['11', '11'], entityStatusIds: { ...selection.entityStatusIds, claim: ['11', '11'] }, pullIntervalMinutes: 15 }))
  expect(result.settings).toMatchObject({ portalStatusIds: ['11'], entityStatusIds: { ...selection.entityStatusIds, claim: ['11'] }, pullIntervalMinutes: 15, lastPullAt: null })
  await sql`UPDATE extensions.gcs_ssc_portal_connector_connection SET last_pull_at='2026-01-01', last_pull_error='temporary outage'`.execute(db)
  expect((await saveSettings(context(selection))).settings).toMatchObject({ portalStatusIds: [], lastPullAt: '2026-01-01T00:00:00.000Z', lastPullError: 'temporary outage' })
  await saveSettings(context(selection))
  await expect(saveSettings(context({ ...selection, pullIntervalMinutes: 7 }))).rejects.toThrow()
  await expect(getSettings(context({}, 'invalid'))).rejects.toThrow('valid agency')
})
it('returns the latest publication per organization scoped to agency and agreement', async () => {
  await sql`INSERT INTO extensions.gcs_ssc_portal_connector_publication
    (agency_id,gcs_agreement_id,portal_organization_id,portal_agreement_id,portal_agreement_revision,portal_set_ids,source_digest,published_at) VALUES
    (1,10,'N-ABCDE','A-OLD',1,'[]','old','2026-01-01'),
    (1,10,'N-ABCDE','A-NEW',2,'["S-1","S-2"]','new','2026-02-01'),
    (1,10,'N-FGHJK','A-OTHER',1,'[]','other','2026-02-01'),
    (2,10,'N-ABCDE','A-PRIVATE',1,'[]','private','2026-03-01'),
    (1,20,'N-ABCDE','A-UNRELATED',1,'[]','unrelated','2026-03-01')`.execute(db)
  expect(await listPublications(context({}, '1', { agreementId: '10' }))).toEqual({ publications: [
    { organizationId: 'N-FGHJK', agreementId: 'A-OTHER', revision: 1, setCount: 0, publishedAt: '2026-02-01T00:00:00.000Z' },
    { organizationId: 'N-ABCDE', agreementId: 'A-NEW', revision: 2, setCount: 2, publishedAt: '2026-02-01T00:00:00.000Z' }
  ] })
  await expect(listPublications(context())).rejects.toThrow('valid Agreement')
  await expect(listPublications(context({}, 'bad', { agreementId: '10' }))).rejects.toThrow('valid agency')
})

it('requeues pending forms for this agency and keeps scan state isolated during connection edits', async () => {
  await saveConnection(context(input))
  await sql`UPDATE extensions.gcs_ssc_portal_connector_connection SET scan_cursor='old-cursor' WHERE agency_id=1`.execute(db)
  await sql`INSERT INTO extensions.gcs_ssc_portal_connector_operation (agency_id,state,kind,next_attempt_at)
    VALUES (1,'pending','form','2099-01-01'),(1,'pending','agreement','2099-01-01'),(2,'pending','form','2099-01-01')`.execute(db)
  await saveConnection(context(input))
  const rows = (await sql<{ agency: string; kind: string; retry: boolean }>`SELECT agency_id::text AS agency,kind,
    next_attempt_at < '2090-01-01' AS retry FROM extensions.gcs_ssc_portal_connector_operation ORDER BY id`.execute(db)).rows
  expect(rows).toEqual([{ agency: '1', kind: 'form', retry: true }, { agency: '1', kind: 'agreement', retry: false }, { agency: '2', kind: 'form', retry: false }])
  expect((await sql<{ scan_cursor: string | null }>`SELECT scan_cursor FROM extensions.gcs_ssc_portal_connector_connection WHERE agency_id=1`.execute(db)).rows[0]?.scan_cursor).toBeNull()
})

it('rejects an unauthorized connection edit atomically before replacing the credential', async () => {
  await saveConnection(context(input))
  const denied = context({ ...input, portalKey: `gcs_${'C'.repeat(43)}` })
  denied.writeAuthorization = {
    ...denied.writeAuthorization!, authorizeCurrentScope: async () => { throw new Error('permission revoked') }
  }
  await expect(saveConnection(denied)).rejects.toThrow('permission revoked')
  expect(await readPortalCredential(context(), '1')).toBe(key)
  expect((await getConnection(context())).connection?.revision).toBe(1)
})

it('queues imported outcome statuses when the selected entity statuses change', async () => {
  await saveConnection(context(input))
  await sql`INSERT INTO "Funding_Case_Agreement_Claim" (id,egcs_fc_status) VALUES (90,11)`.execute(db)
  await sql`INSERT INTO extensions.gcs_ssc_portal_connector_receipt
    (agency_id,event_id,submission_id,item_submission_id,kind,source_export,gcs_entity_type,gcs_entity_id,state)
    VALUES (1,'event-1','submission-1','item-1','claim','{}','fundingcaseagreementclaim',90,'imported'),
      (2,'event-2','submission-2','item-2','claim','{}','fundingcaseagreementclaim',90,'imported'),
      (1,'event-3','submission-3','item-3','claim','{}','fundingcaseagreementclaim',90,'received')`.execute(db)
  await sql`INSERT INTO "Common_Status" VALUES (13,1,'Complete','Terminé',false)`.execute(db)
  const body = { ...selection, entityStatusIds: { ...selection.entityStatusIds, claim: ['11', '13'] } }
  await saveSettings(context(body))
  expect((await sql<{ agency: string; status: string }>`SELECT agency_id::text AS agency,status_id::text AS status
    FROM extensions.gcs_ssc_portal_connector_outcome_outbox`.execute(db)).rows).toEqual([{ agency: '1', status: '11' }])
  await saveSettings(context(body))
  expect((await sql`SELECT * FROM extensions.gcs_ssc_portal_connector_outcome_outbox`.execute(db)).rows).toHaveLength(1)
  await saveSettings(context({ ...body, entityStatusIds: { ...body.entityStatusIds, claim: ['13', '11'] } }))
  expect((await sql`SELECT * FROM extensions.gcs_ssc_portal_connector_outcome_outbox`.execute(db)).rows).toHaveLength(1)
  await saveSettings(context({ ...body, entityStatusIds: { ...body.entityStatusIds, claim: ['11'] } }))
  expect((await sql`SELECT * FROM extensions.gcs_ssc_portal_connector_outcome_outbox`.execute(db)).rows).toHaveLength(2)
  await saveSettings(context(body))
  expect((await sql`SELECT * FROM extensions.gcs_ssc_portal_connector_outcome_outbox`.execute(db)).rows).toHaveLength(3)
})
