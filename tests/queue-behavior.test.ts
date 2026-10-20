import { readdirSync } from 'node:fs'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setEncryptedExtensionSecret, type GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import type { ConnectorDatabase } from '../server/db.ts'
import { secretOptions } from '../server/connection.ts'
import { drainOutbox, enqueueAgreement, getOutboxItem, listOutbox, pushOutbox } from '../server/outbox.ts'
import { drainOutcomeOutbox } from '../server/outcomes.ts'
import { pullDueAgencies, releasePullLease } from '../server/pull.ts'

let db: Kysely<ConnectorDatabase>
const context = (agencyId: string, itemId?: string) => ({ db, params: { agencyId, itemId } }) as unknown as GcsExtensionRouteContext
beforeAll(async () => {
  db = new Kysely<ConnectorDatabase>({ dialect: new KyselyPGlite().dialect })
  const fixture = `CREATE SCHEMA extensions;
    CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY, _deleted boolean DEFAULT false);
    CREATE TABLE "Applicant_Recipient_Profile" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Profile" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Budget_Fiscal_Year" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Budget_Line_Item" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Budget_Version" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Applicant_Recipient" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Claim" (id bigint PRIMARY KEY, egcs_fc_status bigint);
    CREATE TABLE "Funding_Case_Agreement_Forecast" (id bigint PRIMARY KEY, egcs_fc_status bigint);
    CREATE TABLE "Funding_Case_Intake_Profile" (id bigint PRIMARY KEY, egcs_fi_status bigint);
    CREATE TABLE "Common_Status" (id bigint PRIMARY KEY, egcs_cn_name_en text, egcs_cn_name_fr text, egcs_cn_color text, _deleted boolean);
    CREATE TABLE extensions.agency_enablement (extension_key text, agency_id bigint, enabled boolean, _deleted boolean DEFAULT false);
    CREATE TABLE extensions.secret_entry (id bigserial PRIMARY KEY, extension_key text, owner_type text, owner_id text, secret_key text,
      ciphertext text, iv text, auth_tag text, algorithm text, key_version integer, metadata jsonb,
      created_at timestamptz DEFAULT now(), updated_at timestamptz, _deleted boolean DEFAULT false);
    INSERT INTO "Agency_Profile" (id) VALUES (11),(22);
    INSERT INTO "Applicant_Recipient_Profile" VALUES (101);
    INSERT INTO "Funding_Case_Agreement_Profile" VALUES (201)`
  for (const statement of fixture.split(';')) await sql.raw(statement).execute(db)
  const directory = new URL('../server/migrations/', import.meta.url)
  for (const file of readdirSync(directory).sort()) {
    const migration = await import(new URL(file, directory).href)
    await migration.default.up(db)
  }
}, 30_000)
beforeEach(async () => {
  vi.stubEnv('GCS_EXTENSION_SECRETS_KEY', 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=')
  for (const table of ['operation', 'outcome_outbox', 'inbox', 'outbox', 'receipt', 'connection', 'identity', 'verification']) {
    await sql.raw(`TRUNCATE extensions.gcs_ssc_portal_connector_${table} RESTART IDENTITY CASCADE`).execute(db)
  }
  await sql`TRUNCATE extensions.agency_enablement, extensions.secret_entry, "Common_Status",
    "Funding_Case_Agreement_Claim", "Funding_Case_Agreement_Forecast", "Funding_Case_Intake_Profile" CASCADE`.execute(db)
  await sql`INSERT INTO extensions.agency_enablement VALUES
    ('gcs-ssc-portal-connector',11,true,false), ('gcs-ssc-portal-connector',22,true,false)`.execute(db)
  await sql`INSERT INTO "Common_Status" VALUES (401,'Approved','Approuvé','#123abc',false)`.execute(db)
  for (const agencyId of ['11', '22']) {
    await db.insertInto('extensions.gcs_ssc_portal_connector_connection').values({
      agency_id: agencyId, portal_agency_id: `G-${agencyId}`, portal_url: 'https://portal.example/',
      scan_cursor: null, pull_interval_minutes: 5, last_pull_at: null, last_pull_error: null,
      pull_lease_until: null, updated_at: new Date()
    }).execute()
    await setEncryptedExtensionSecret(db, { ...secretOptions(agencyId), value: { key: `gcs_${'a'.repeat(43)}` } })
  }
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(async () => { await db.destroy() })
const receipt = async (agencyId: string, type: string, state: 'received' | 'imported' = 'imported') => {
  const row = await db.insertInto('extensions.gcs_ssc_portal_connector_receipt').values({
    agency_id: agencyId, event_id: '71', submission_id: 'submission', item_submission_id: 'item',
    kind: 'submission_item', source_export: {}, gcs_entity_type: type, gcs_entity_id: '301', state
  }).returning('id').executeTakeFirstOrThrow()
  const queued = await db.selectFrom('extensions.gcs_ssc_portal_connector_outcome_outbox').select('id')
    .where('receipt_id', '=', String(row.id)).executeTakeFirst()
  if (queued) return
  await db.insertInto('extensions.gcs_ssc_portal_connector_outcome_outbox').values({
    agency_id: agencyId, receipt_id: String(row.id), status_id: '401', last_error: null, delivered_at: null
  }).execute()
}

describe('outcome queue with renamed real tables', () => {
  it.each([
    ['fundingcaseagreementclaim', 'claim', true], ['fundingcaseforecast', 'forecast', true],
    ['fundingcaseintake', 'funding_application', true], ['fundingcaseagreementclaim', 'claim', false]
  ] as const)('publishes the %s status only when configured: %s %s', async (type, selected, visible) => {
    await sql`INSERT INTO "Funding_Case_Agreement_Claim" VALUES (301,401)`.execute(db)
    await sql`INSERT INTO "Funding_Case_Agreement_Forecast" VALUES (301,401)`.execute(db)
    await sql`INSERT INTO "Funding_Case_Intake_Profile" VALUES (301,401)`.execute(db)
    await db.updateTable('extensions.gcs_ssc_portal_connector_connection').set({
      entity_status_ids: { claim: [], forecast: [], funding_application: [], other_form: [], [selected]: visible ? ['401'] : [] }
    }).where('agency_id', '=', '11').execute()
    await receipt('11', type)
    const transport = vi.fn(async (_url: unknown, options?: RequestInit) => options?.method === 'GET'
      ? Response.json({ outcomes: [] }) : Response.json({ ok: true }))
    vi.stubGlobal('fetch', transport)
    expect(await drainOutcomeOutbox(db, 1, '11')).toEqual({ results: [{ id: '1', delivered: true }] })
    expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body))).toEqual({ expectedRevision: 0, remoteReference: '301',
      gcsStatus: visible ? { en: 'Approved', fr: 'Approuvé', colour: '#123abc' } : null })
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation').select(['state', 'attempts']).execute())
      .toEqual([{ state: 'delivered', attempts: 1 }])
    expect(await drainOutcomeOutbox(db, 2)).toEqual({ results: [] })
  })
  it('reschedules an unimported receipt without crossing the agency boundary', async () => {
    await receipt('11', 'fundingcaseagreementclaim', 'received')
    expect(await drainOutcomeOutbox(db, 1, '22')).toEqual({ results: [] })
    expect(await drainOutcomeOutbox(db, 1, '11')).toEqual({ results: [{ id: '1', delivered: false,
      error: 'The imported GCS item is unavailable.' }] })
    const pending = await db.selectFrom('extensions.gcs_ssc_portal_connector_outcome_outbox').selectAll().executeTakeFirstOrThrow()
    expect(pending.state).toBe('pending')
    expect(pending.attempts).toBe(1)
    expect(new Date(pending.next_attempt_at).getTime()).toBeGreaterThan(Date.now())
    expect(await drainOutcomeOutbox(db, 1, '11')).toEqual({ results: [] })
  })
  it('recovers an expired lease and records remote failure for only the chosen agency', async () => {
    await receipt('11', 'fundingcaseagreementclaim')
    await receipt('22', 'fundingcaseforecast')
    await sql`UPDATE extensions.gcs_ssc_portal_connector_outcome_outbox SET state='leased', attempts=2,
      next_attempt_at=now()-interval '1 minute' WHERE agency_id=11`.execute(db)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Portal offline') }))
    expect(await drainOutcomeOutbox(db, 1, '11')).toEqual({ results: [{ id: '1', delivered: false, error: 'Portal offline' }] })
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_outcome_outbox').select(['state', 'attempts']).orderBy('id').execute())
      .toEqual([{ state: 'pending', attempts: 3 }, { state: 'pending', attempts: 0 }])
  })
})

describe('agreement queue recovery and visibility', () => {
  it('leases active verification links only and retries a missing connection', async () => {
    await db.insertInto('extensions.gcs_ssc_portal_connector_verification').values({
      portal_organization_id: 'N-ABCDE', proponent_id: '101', origin_agency_id: '11', verification_note: null,
      verified_by_user_id: null, portal_active: false
    }).execute()
    await enqueueAgreement(db, '11', '201', 'N-ABCDE', '101')
    expect(await drainOutbox(db, 1)).toEqual({ results: [] })
    await db.updateTable('extensions.gcs_ssc_portal_connector_verification').set({ portal_active: true }).execute()
    expect(await drainOutbox(db, 1, '22')).toEqual({ results: [] })
    await db.deleteFrom('extensions.gcs_ssc_portal_connector_connection').where('agency_id', '=', '11').execute()
    await sql`UPDATE extensions.gcs_ssc_portal_connector_outbox SET state='leased', attempts=1,
      next_attempt_at=now()-interval '1 minute'`.execute(db)
    expect(await drainOutbox(db, 1, '11')).toEqual({ results: [{ id: '1', delivered: false,
      error: 'Connect an organization portal before publishing.' }] })
    expect(await getOutboxItem(context('11', '1'))).toMatchObject({ state: 'pending', attempts: 2, deliveredAt: null })
    await expect(getOutboxItem(context('22', '1'))).rejects.toThrow('Delivery not found for this agency.')
    await expect(getOutboxItem(context('11', '0'))).rejects.toThrow('A valid delivery is required.')
  })
  it('lists agency queues, request targets and pending/imported inbound state', async () => {
    await enqueueAgreement(db, '11', '201', 'N-ABCDE', '101')
    await enqueueAgreement(db, '22', '201', 'N-FGHIJ', '101')
    await receipt('11', 'fundingcaseagreementclaim')
    await db.insertInto('extensions.gcs_ssc_portal_connector_inbox').values([
      { agency_id: '11', event_id: '71', kind: 'submission_item', submission_id: 'submission', item_submission_id: 'item', created_at: new Date() },
      { agency_id: '11', event_id: '72', kind: 'organization_detail', submission_id: 'other', item_submission_id: null, created_at: new Date() }
    ]).execute()
    await db.insertInto('extensions.gcs_ssc_portal_connector_operation').values({
      agency_id: '11', kind: 'request', method: 'PUT', path: 'calls/C-TEST', body: {}, form_id: null,
      last_error: null, response: null, delivered_at: null
    }).execute()
    const queues = await listOutbox(context('11'))
    expect(queues.backlog).toHaveLength(1)
    expect(queues.backlog[0]?.organizationId).toBe('N-ABCDE')
    expect(queues.operations[0]?.target).toBe('PUT calls/C-TEST')
    expect(queues.outcomes[0]?.submissionId).toBe('submission')
    expect(queues.inbound.map(row => row.state)).toEqual(['pending', 'imported'])
    const other = await listOutbox(context('22'))
    expect(other.backlog).toHaveLength(1)
    expect(other.operations).toEqual([])
    expect(other.inbound).toEqual([])
    expect(other.outcomes).toEqual([])
  })
})

describe('pull queue pagination, retry and leases', () => {
  it('persists paginated events once and skips disabled agencies', async () => {
    await sql`UPDATE extensions.agency_enablement SET enabled=false WHERE agency_id=22`.execute(db)
    const event = { eventId: '71', kind: 'submission_item', submissionId: 'submission', itemSubmissionId: 'item',
      detailId: null, createdAt: '2026-10-01T12:00:00Z', consumedAt: null, remoteReference: null }
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ updates: [event], nextCursor: '71' }))
      .mockResolvedValueOnce(Response.json({ updates: [event, { ...event, eventId: '72' }], nextCursor: null }))
    vi.stubGlobal('fetch', transport)
    expect(await pullDueAgencies(db)).toEqual({ results: [{ agencyId: '11', found: 3 }] })
    expect(String(transport.mock.calls[1]?.[0])).toContain('?after=71')
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_inbox').select('event_id').orderBy('event_id').execute())
      .toEqual([{ event_id: '71' }, { event_id: '72' }])
    expect(await pullDueAgencies(db)).toEqual({ results: [] })
    await releasePullLease(db, '11')
    expect((await db.selectFrom('extensions.gcs_ssc_portal_connector_connection').select('pull_lease_until')
      .where('agency_id', '=', '11').executeTakeFirstOrThrow()).pull_lease_until).toBeNull()
  })
  it.each([new Error('Remote offline'), 'untyped failure'])('records failure and releases the lease: %s', async failure => {
    await sql`UPDATE extensions.gcs_ssc_portal_connector_connection SET pull_interval_minutes=NULL WHERE agency_id=22`.execute(db)
    vi.stubGlobal('fetch', vi.fn(async () => { throw failure }))
    const error = failure instanceof Error ? failure.message : 'Portal pull failed'
    expect(await pullDueAgencies(db)).toEqual({ results: [{ agencyId: '11', found: 0, error }] })
    const connection = await db.selectFrom('extensions.gcs_ssc_portal_connector_connection').selectAll()
      .where('agency_id', '=', '11').executeTakeFirstOrThrow()
    expect(connection.last_pull_error).toBe(error)
    expect(connection.pull_lease_until).toBeNull()
  })
})


describe('manual push bounded and all operations', () => {
  it('reschedules only the authorized agency and accounts for the shared drain limit', async () => {
    for (const agencyId of ['11', '11', '22']) {
      await db.insertInto('extensions.gcs_ssc_portal_connector_operation').values({
        agency_id: agencyId, kind: 'request', method: 'POST', path: 'operations', body: {}, form_id: null,
        next_attempt_at: new Date(Date.now() + 3600000), last_error: null, response: null, delivered_at: null
      }).execute()
    }
    await enqueueAgreement(db, '11', '201', 'N-ABCDE', '101')
    const authorizationCalls: string[] = []
    const writeContext = (body: unknown) => ({ ...context('11'), readBody: async () => body,
      writeAuthorization: {
        lockAuthState: async () => { authorizationCalls.push('lock') },
        authorizeCurrentScope: async () => { authorizationCalls.push('authorize') }
      }
    }) as unknown as GcsExtensionRouteContext
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })))
    expect(await pushOutbox(writeContext({ limit: 1 }))).toMatchObject({ results: [{ id: '1', delivered: true }], queued: 0 })
    expect(authorizationCalls).toEqual(['lock', 'authorize'])
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation').select(['state', 'attempts']).orderBy('id').execute())
      .toEqual([{ state: 'delivered', attempts: 1 }, { state: 'pending', attempts: 0 }, { state: 'pending', attempts: 0 }])
    expect(await pushOutbox(writeContext({ all: true }))).toMatchObject({ results: [{ id: '2', delivered: true }], queued: 2 })
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation').select(['state', 'attempts'])
      .where('agency_id', '=', '22').execute()).toEqual([{ state: 'pending', attempts: 0 }])
    await expect(pushOutbox(writeContext({ limit: 0 }))).rejects.toThrow()
    await expect(pushOutbox(writeContext({ all: true, limit: 1 }))).rejects.toThrow()
  })
})
