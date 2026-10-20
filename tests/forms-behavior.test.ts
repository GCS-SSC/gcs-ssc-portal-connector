import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorDatabase } from '../server/db.ts'
import migration from '../server/migrations/0010_portal_operations.ts'
import { foreignId, getForm, listForms, manageForm } from '../server/forms.ts'

const remote = vi.hoisted(() => ({ transport: vi.fn() }))
vi.mock('../server/portal-context.ts', async () => {
  const { createPortalClient } = await import('../server/portal-client.ts')
  return { clientForAgency: async () => ({ agencyId: '1', connection: { portal_agency_id: 'G-ABCDE' },
    client: createPortalClient({ portalUrl: 'https://portal.example/', portalAgencyId: 'G-ABCDE', key: 'test' }, remote.transport) }) }
})
const definition = { schemaVersion: 3, title: { en: 'Application', fr: 'Demande' },
  questions: [{ id: 'name', type: 'text', label: { en: 'Name', fr: 'Nom' }, required: false, maxLength: 500 }],
  pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' }, questionIds: ['name'], groups: [], branches: [] }] }
const call = { id: 'C-ABCDE', streamId: 'T-ABCDE', nameEn: 'Call', nameFr: 'Appel', revision: 1,
  published: false, surveyId: null, surveyRevision: null, startDate: '2026-01-01', endDate: '2026-12-31', sourceSystem: 'gcs-ssc-intake', foreignSystemId: 'call' }
const stream = { id: 'T-ABCDE', programId: 'P-ABCDE', sourceSystem: 'gcs-ssc', foreignSystemId: 'stream', nameEn: 'Stream', nameFr: 'Volet' }
const agreement = { id: 'A-ABCDE', organizationId: 'N-ABCDE', streamId: stream.id, active: true, revision: 1,
  nameEn: 'Agreement', nameFr: 'Entente', agreementNumber: 'A1', config: { foreignSystemId: '31', sourceSystem: 'gcs-ssc',
    externalStreamId: '2', externalApplicantRecipientId: '3', budgetLines: [], fiscalYears: [] } }
let db: Kysely<ConnectorDatabase>
const executeStatements = async (statements: string) => {
  for (const statement of statements.split(';').map(value => value.trim()).filter(Boolean)) await sql.raw(statement).execute(db)
}
const context = (body: unknown = {}, params: Record<string, string> = {}) => ({ db, params: { agencyId: '1', ...params },
  readBody: async () => body, writeAuthorization: { lockAuthState: async () => undefined,
    authorizeCurrentEntity: async () => undefined } }) as never
const command = (action: string, extra: object = {}) => ({ action, surveyId: 'V-ABCDE', revision: 1, ...extra })
const setupTransport = (overrides: Record<string, unknown> = {}) => {
  const responses: Record<string, unknown> = {
    'GET agencies/G-ABCDE': { programs: [{ id: 'P-ABCDE', sourceSystem: 'gcs-ssc', foreignSystemId: 'program' }], streams: [stream], calls: [call] },
    'GET agencies/G-ABCDE/surveys': { surveys: [{ id: 'V-ABCDE', revision: 1, title: definition.title, updatedAt: '2026-01-01T00:00:00Z' }] },
    'GET agencies/G-ABCDE/agreements': { agreements: [agreement] }, 'GET agencies/G-ABCDE/sets': { sets: [] },
    'GET surveys/V-ABCDE': { survey: { id: 'V-ABCDE', revision: 1, definition } },
    'POST surveys': { survey: { id: 'V-ABCDE', revision: 1 } }, 'PUT surveys/V-ABCDE': { survey: { id: 'V-ABCDE', revision: 2 } },
    'PUT calls/C-ABCDE/survey': {}, 'POST sets': { set: { id: 'S-ABCDE', revision: 1 } }, 'POST sets/S-ABCDE/publish': {}, ...overrides
  }
  remote.transport.mockImplementation(async (url: URL, request: RequestInit) => {
    const key = `${request.method} ${url.pathname.replace('/api/government/', '')}`
    const value = responses[key]
    if (value instanceof Error) throw value
    if (value === undefined) throw new Error(`Unexpected Portal request: ${key}`)
    return Response.json(value)
  })
}
beforeAll(async () => {
  db = new Kysely<ConnectorDatabase>({ dialect: new KyselyPGlite().dialect })
  await executeStatements(`CREATE SCHEMA extensions; CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY); INSERT INTO "Agency_Profile" VALUES (1),(2)`)
  await migration.up(db)
  await executeStatements(`CREATE TABLE extensions.gcs_ssc_portal_connector_identity (agency_id bigint, portal_organization_id text, proponent_id text);
    CREATE TABLE extensions.gcs_ssc_portal_connector_verification (portal_organization_id text, portal_active boolean);
    CREATE TABLE extensions.gcs_ssc_portal_connector_organization (agency_id bigint, portal_organization_id text, name text, active boolean);
    CREATE TABLE extensions.gcs_ssc_portal_connector_publication (agency_id bigint, gcs_agreement_id text, portal_agreement_id text, portal_organization_id text)`)
})
afterAll(async () => { await db.destroy() })
beforeEach(async () => {
  remote.transport.mockReset(); setupTransport()
  await sql`TRUNCATE extensions.gcs_ssc_portal_connector_operation, extensions.gcs_ssc_portal_connector_form,
    extensions.gcs_ssc_portal_connector_identity, extensions.gcs_ssc_portal_connector_verification,
    extensions.gcs_ssc_portal_connector_organization, extensions.gcs_ssc_portal_connector_publication`.execute(db)
  await executeStatements(`INSERT INTO extensions.gcs_ssc_portal_connector_identity VALUES (1,'N-ABCDE','3');
    INSERT INTO extensions.gcs_ssc_portal_connector_verification VALUES ('N-ABCDE',true);
    INSERT INTO extensions.gcs_ssc_portal_connector_organization VALUES (1,'N-ABCDE','Organization',true);
    INSERT INTO extensions.gcs_ssc_portal_connector_publication VALUES (1,'31','A-ABCDE','N-ABCDE')`)
})

describe('persisted form workflows', () => {
  it('keeps bilingual drafts available offline and saves their first queued revision atomically', async () => {
    remote.transport.mockRejectedValue(new Error('offline'))
    await manageForm(context({ action: 'createDraft', title: definition.title }))
    const draft = await db.selectFrom('extensions.gcs_ssc_portal_connector_form').selectAll().executeTakeFirstOrThrow()
    expect(await getForm(context({}, { formId: draft.id }))).toMatchObject({ survey: { revision: 0, synced: false } })
    expect(await listForms(context())).toMatchObject({ surveys: [{ id: draft.id, title: definition.title, synced: false }], programs: [], streams: [], calls: [] })
    await manageForm(context({ action: 'save', surveyId: draft.id, expectedRevision: 0, definition }))
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation').select(['kind', 'form_id']).execute()).toEqual([{ kind: 'form', form_id: draft.id }])
    await expect(manageForm(context({ action: 'save', surveyId: draft.id, expectedRevision: 0, definition }))).rejects.toThrow('latest saved form revision')
    expect((await db.selectFrom('extensions.gcs_ssc_portal_connector_form').select('revision').executeTakeFirstOrThrow()).revision).toBe(1)
  })
  it('imports a remote form on edit, preserves its mapping and deduplicates its listing', async () => {
    expect(await getForm(context({}, { formId: 'V-ABCDE' }))).toMatchObject({ survey: { revision: 1, synced: true } })
    await manageForm(context({ action: 'save', surveyId: 'V-ABCDE', expectedRevision: 1, definition }))
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_form').selectAll().executeTakeFirstOrThrow()).toMatchObject({ revision: 2, portal_id: 'V-ABCDE', portal_revision: 1 })
    const listing = await listForms(context())
    expect(listing.surveys).toHaveLength(1)
    expect(listing.surveys[0]).toMatchObject({ revision: 2, synced: false })
    expect(listing.agreements).toMatchObject([{ id: agreement.id, organizationId: agreement.organizationId }])
  })
  it('rejects mismatched revision input and stale remote edits before persistence', async () => {
    for (const values of [{ surveyId: 'V-ABCDE' }, { expectedRevision: 1 }]) {
      await expect(manageForm(context({ action: 'save', definition, ...values }))).rejects.toThrow()
    }
    await expect(manageForm(context({ action: 'save', definition, surveyId: 'V-ABCDE', expectedRevision: 2 }))).rejects.toThrow('latest saved form revision')
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_form').selectAll().execute()).toEqual([])
  })
  it('denies writes without host authorization and leaves no draft behind', async () => {
    await expect(manageForm({ db, params: { agencyId: '1' }, readBody: async () => ({ action: 'createDraft', title: definition.title }) } as never)).rejects.toThrow('Host write authorization')
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_form').selectAll().execute()).toEqual([])
  })
})

describe('intake form delivery', () => {
  it('attaches the current revision and reuses repeated attachments without mutation', async () => {
    expect(await manageForm(context(command('attachIntakeForm', { intakeId: call.id })))).toEqual({ attached: true })
    setupTransport({ 'GET agencies/G-ABCDE': { programs: [], streams: [stream], calls: [{ ...call, surveyId: 'V-ABCDE', surveyRevision: 1 }] } })
    remote.transport.mockClear()
    expect(await manageForm(context(command('attachIntakeForm', { intakeId: call.id })))).toEqual({ attached: true })
    expect(remote.transport).toHaveBeenCalledTimes(1)
  })
  it.each([{ ...call, published: true }, { ...call, surveyId: 'V-FGHJK' }, { ...call, sourceSystem: 'other' }])('rejects an invalid intake attachment: %j', async intake => {
    setupTransport({ 'GET agencies/G-ABCDE': { programs: [], streams: [stream], calls: [intake] } })
    await expect(manageForm(context(command('attachIntakeForm', { intakeId: call.id })))).rejects.toThrow()
  })
  it('requires the latest survey revision for attachment', async () => {
    await expect(manageForm(context(command('attachIntakeForm', { intakeId: call.id, revision: 2 })))).rejects.toThrow()
  })
  it('returns the saved form when attachment fails so the user can recover', async () => {
    setupTransport({ 'PUT calls/C-ABCDE/survey': new Error('offline') })
    expect(await manageForm(context({ action: 'save', intakeId: call.id, definition }))).toEqual({ survey: { id: 'V-ABCDE', revision: 1 }, attached: false })
    setupTransport()
    expect(await manageForm(context({ action: 'save', intakeId: call.id, surveyId: 'V-ABCDE', expectedRevision: 1, definition }))).toEqual({ survey: { id: 'V-ABCDE', revision: 2 }, attached: true })
    await expect(manageForm(context({ action: 'save', intakeId: call.id, surveyId: 'V-ABCDE', definition }))).rejects.toThrow()
  })
})

describe('form publication', () => {
  it.each([
    command('publishOrganization', { organizationId: 'N-ABCDE' }), command('publishAgreement', { agreementId: 'A-ABCDE', organizationId: 'N-ABCDE' }),
    command('publishScope', { scope: 'program', scopeId: 'P-ABCDE' }), command('publishScope', { scope: 'stream', scopeId: 'T-ABCDE' })
  ])('publishes the bilingual form to its verified target: %j', async body => {
    expect(await manageForm(context(body))).toEqual({ setIds: ['S-ABCDE'], published: true })
    const request = remote.transport.mock.calls.find(([url, options]) => String(url).endsWith('/sets') && options.method === 'POST')
    expect(JSON.parse(request?.[1].body)).toMatchObject({ organizationId: 'N-ABCDE', nameEn: 'Application', nameFr: 'Demande', items: [{ surveyId: 'V-ABCDE', surveyRevision: 1 }] })
  })
  it.each([
    [command('publishOrganization', { organizationId: 'N-FGHJK' }), 'verified organization'],
    [command('publishAgreement', { agreementId: 'A-FGHJK', organizationId: 'N-ABCDE' }), 'verified and synced'],
    [command('publishScope', { scope: 'program', scopeId: 'P-FGHJK' }), 'GCS Program'],
    [command('publishScope', { scope: 'stream', scopeId: 'T-FGHJK' }), 'GCS Stream']
  ])('rejects a publication outside verified agency targets: %j', async (body, message) => {
    await expect(manageForm(context(body))).rejects.toThrow(message)
  })
  it('rejects stale and unsynchronized saved revisions before publishing', async () => {
    await manageForm(context({ action: 'save', definition }))
    const saved = await db.selectFrom('extensions.gcs_ssc_portal_connector_form').selectAll().executeTakeFirstOrThrow()
    await expect(manageForm(context(command('publishOrganization', { surveyId: saved.id, organizationId: 'N-ABCDE' })))).rejects.toThrow('synchronize')
    await expect(manageForm(context(command('publishOrganization', { revision: 2, organizationId: 'N-ABCDE' })))).rejects.toThrow('latest form revision')
  })
  it('resumes a created set and skips an already published set', async () => {
    const set = { id: 'S-ABCDE', organizationId: 'N-ABCDE', agreementId: null, revision: 4, sourceSystem: 'gcs-ssc-form',
      foreignSystemId: foreignId('form-set:V-ABCDE:1:organization:N-ABCDE'), snapshot: null,
      items: [{ id: 'form', kind: 'survey', surveyId: 'V-ABCDE', surveyRevision: 1 }] }
    for (const published of [false, true]) {
      setupTransport({ 'GET agencies/G-ABCDE/sets': { sets: [{ ...set, published }] } }); remote.transport.mockClear()
      expect(await manageForm(context(command('publishOrganization', { organizationId: 'N-ABCDE' })))).toEqual({ setIds: ['S-ABCDE'], published: true })
      expect(remote.transport.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(published ? 0 : 1)
    }
  })
  it('blocks publication until all survey content has English and French translations', async () => {
    setupTransport({ 'GET surveys/V-ABCDE': { survey: { id: 'V-ABCDE', revision: 1,
      definition: { ...definition, questions: [{ ...definition.questions[0], hint: { en: 'Your full name', fr: '' } }] } } } })
    await expect(manageForm(context(command('publishOrganization', { organizationId: 'N-ABCDE' })))).rejects.toThrow('English and French')
    expect(remote.transport.mock.calls.filter(([, options]) => options.method === 'POST')).toEqual([])
  })
  it('maps remote placements back to a synchronized local form and preserves bilingual target labels', async () => {
    await db.insertInto('extensions.gcs_ssc_portal_connector_form').values({ id: 'V-FGHJK', agency_id: '1', definition,
      revision: 1, portal_id: 'V-ABCDE', portal_revision: 1 }).execute()
    setupTransport({
      'GET agencies/G-ABCDE/sets': { sets: [{ id: 'S-ABCDE', organizationId: 'N-ABCDE', agreementId: agreement.id,
        published: true, revision: 1, sourceSystem: 'gcs-ssc-form', foreignSystemId: null, snapshot: null,
        items: [{ id: 'form', kind: 'survey', surveyId: 'V-ABCDE', surveyRevision: 1 }] }] },
      'GET agencies/G-ABCDE': { programs: [], streams: [stream], calls: [{ ...call, surveyId: 'V-ABCDE', surveyRevision: 1 }] }
    })
    const listing = await listForms(context())
    expect(listing.surveys).toMatchObject([{ id: 'V-FGHJK', synced: true }])
    expect(listing.publications).toMatchObject([
      { surveyId: 'V-FGHJK', targetType: 'agreement', targetNameEn: 'Agreement', targetNameFr: 'Entente' },
      { surveyId: 'V-FGHJK', targetType: 'opportunity', targetNameEn: 'Call', targetNameFr: 'Appel' }
    ])
    expect(await getForm(context({}, { formId: 'V-FGHJK' }))).toMatchObject({ survey: { synced: true } })
  })
  it('rejects a valid scope with no verified synced Agreements', async () => {
    await sql`DELETE FROM extensions.gcs_ssc_portal_connector_publication`.execute(db)
    await expect(manageForm(context(command('publishScope', { scope: 'program', scopeId: 'P-ABCDE' })))).rejects.toThrow('No active, verified, synced')
  })
})
