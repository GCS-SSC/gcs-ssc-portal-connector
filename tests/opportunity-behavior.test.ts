import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setEncryptedExtensionSecret, type GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { asConnectorDb } from '../server/db.ts'
import migration from '../server/migrations/0010_portal_operations.ts'
import { getOpportunityForm, listOpportunityForms, manageOpportunity } from '../server/opportunities.ts'

const db = new Kysely<unknown>({ dialect: new KyselyPGlite({ parsers: { 20: value => value } }).dialect })
const rootKey = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
const definition = { schemaVersion: 3, pages: [{ id: 'page', title: { en: 'Project', fr: 'Projet' }, questionIds: ['name'], groups: [], branches: [] }], title: { en: 'Project', fr: 'Projet' }, questions: [
  { id: 'name', type: 'text', label: { en: 'Name', fr: 'Nom' }, required: true, maxLength: 200 }
] }
const form = { surveyId: 'V-ABCDE', revision: 1 }
const originalProjection = { active: true, editable: true, agency: { id: '1' }, program: { id: '2', nameEn: 'Program', nameFr: 'Programme' },
  stream: { id: '3', nameEn: 'Stream', nameFr: 'Volet' }, nameEn: 'Opportunity', nameFr: 'Occasion', startDate: '2027-01-01', endDate: '2027-12-31' }
const originalCall = { id: 'D-ABCDE', sourceSystem: 'gcs-ssc-opportunity', foreignSystemId: '44', streamId: 'S-ABCDE',
  nameEn: 'Opportunity', nameFr: 'Occasion', revision: 2, published: false, surveyId: null, surveyRevision: null,
  startDate: '2027-01-01', endDate: '2027-12-31', forms: [form] }
let projection: typeof originalProjection | null
let call: typeof originalCall | null
let hasProgram: boolean
let hasStream: boolean
let readBack: boolean
let revision: number
let translated: boolean
let summaries: boolean
let allow: boolean
let projectAvailable: boolean
let denial: boolean
const requests: Array<{ path: string; method: string; body: unknown }> = []
const transport = vi.fn<typeof fetch>()
const context = (body: unknown = { action: 'publish' }, ownerId = '44', agencyId = '1') => ({
  db, params: { agencyId, opportunityId: '44', formId: 'V-ABCDE' },
  entity: { ownerId, agencyId: '1', scope: { type: 'entity', agencyId: '1', path: [] } },
  auth: { userAbilities: { authorize: () => allow } }, readBody: async () => body,
  writeAuthorization: { lockAuthState: async () => undefined,
    authorizeCurrentScope: async () => { if (denial) throw new Error('Scope denied') },
    ...(projectAvailable ? { projectFundingOpportunity: async () => projection } : {}) }
} as unknown as GcsExtensionRouteContext)
const structure = () => ({ programs: hasProgram ? [{ id: 'P-ABCDE', sourceSystem: 'gcs-ssc', foreignSystemId: '2' }] : [],
  streams: hasStream ? [{ id: 'S-ABCDE', nameEn: 'Stream', nameFr: 'Volet', sourceSystem: 'gcs-ssc', foreignSystemId: '3' }] : [], calls: call ? [call] : [] })

beforeAll(async () => {
  for (const command of `CREATE SCHEMA extensions;
    CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY,_deleted boolean DEFAULT false);
    INSERT INTO "Agency_Profile" VALUES (1,false);
    CREATE TABLE extensions.agency_enablement (agency_id bigint,extension_key text,enabled boolean,_deleted boolean);
    INSERT INTO extensions.agency_enablement VALUES (1,'gcs-ssc-portal-connector',true,false);
    CREATE TABLE extensions.gcs_ssc_portal_connector_connection (agency_id bigint PRIMARY KEY,portal_url text,portal_agency_id text);
    INSERT INTO extensions.gcs_ssc_portal_connector_connection VALUES (1,'https://portal.example/','G-ABCDE');
    CREATE TABLE extensions.secret_entry (id bigserial PRIMARY KEY,extension_key text,owner_type text,owner_id text,secret_key text,
      ciphertext text,iv text,auth_tag text,algorithm text,key_version integer,metadata jsonb,
      created_at timestamptz DEFAULT now(),updated_at timestamptz,_deleted boolean DEFAULT false)`.split(';')) {
    await sql.raw(command).execute(db)
  }
  await migration.up(db)
  await setEncryptedExtensionSecret(asConnectorDb(db), { rootKey, extensionKey: 'gcs-ssc-portal-connector', ownerType: 'agency',
    ownerId: '1', secretKey: 'portal-key', value: { key: `gcs_${'a'.repeat(43)}` } })
}, 30_000)
beforeEach(async () => {
  projection = structuredClone(originalProjection); call = structuredClone(originalCall)
  hasProgram = true; hasStream = true; readBack = true; revision = 1; translated = true; summaries = true
  allow = true; projectAvailable = true; denial = false; requests.length = 0
  await sql`TRUNCATE extensions.gcs_ssc_portal_connector_operation`.execute(db)
  transport.mockReset().mockImplementation(async (url, options) => {
    const path = new URL(String(url)).pathname.replace('/api/government/', '')
    const method = options?.method ?? 'GET'
    const body: unknown = options?.body ? JSON.parse(String(options.body)) : null
    requests.push({ path, method, body })
    if (method === 'GET') {
      if (path === 'agencies/G-ABCDE') return Response.json(structure())
      if (path === 'agencies/G-ABCDE/surveys') return Response.json({ surveys: summaries ? [
        { id: 'V-ABCDE', revision: 1, title: { en: 'Project', fr: 'Projet' }, updatedAt: '2027-01-01' }
      ] : [] })
      if (path.startsWith('surveys/')) return Response.json({ survey: { id: path.split('/')[1], revision,
        definition: { ...definition, questions: definition.questions.map(question => ({ ...question, hint: { en: 'Instructions', fr: translated ? 'Consignes' : '' } })) } } })
    }
    if (path === 'programs') return Response.json({ program: { id: 'P-ABCDE' } })
    if (path === 'streams') return Response.json({ stream: { id: 'S-ABCDE' } })
    if (path === 'calls' && readBack) call = structuredClone(originalCall)
    if (path === 'surveys' || path.startsWith('surveys/')) return Response.json({ survey: { id: path === 'surveys' ? 'V-BCDEF' : 'V-ABCDE', revision: 2 } })
    return Response.json({ id: 'D-ABCDE' })
  })
  vi.stubGlobal('fetch', transport); vi.stubEnv('GCS_EXTENSION_SECRETS_KEY', rootKey)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(async () => { await db.destroy() })

describe('opportunity lifecycle through the real connector queue', () => {
  it.each(['missing', 'empty', 'unknown-title', 'read-only'])('lists %s attached forms and capabilities', async mode => {
    if (mode === 'missing') call = null
    if (mode === 'empty' && call) call.forms = []
    if (mode === 'unknown-title') summaries = false
    if (mode === 'read-only') allow = false
    const result = await listOpportunityForms(context())
    expect(result.canWrite).toBe(mode !== 'read-only')
    expect(result.forms.length).toBe(mode === 'missing' || mode === 'empty' ? 0 : 1)
    if (mode === 'missing') expect(result).toMatchObject({ callId: null, published: false })
    if (mode === 'unknown-title') expect(result.forms[0]?.title).toEqual({ en: 'V-ABCDE', fr: 'V-ABCDE' })
  })
  it('recognizes imported opportunity identity and rejects unrelated form and agency access', async () => {
    if (call) call.sourceSystem = 'gcs-ssc-opportunity-shim'
    expect((await getOpportunityForm(context())).survey.revision).toBe(1)
    if (call) call.sourceSystem = 'other'
    await expect(getOpportunityForm(context())).rejects.toThrow('not attached')
    await expect(listOpportunityForms(context(undefined, '44', '2'))).rejects.toThrow('unavailable in this agency')
  })
  it.each(['missing-projection', 'wrong-owner', 'wrong-agency', 'inactive', 'locked', 'no-projector', 'denied'])('rejects %s publication boundaries', async mode => {
    if (mode === 'missing-projection') projection = null
    if (mode === 'wrong-agency' && projection) projection.agency.id = '2'
    if (mode === 'inactive' && projection) projection.active = false
    if (mode === 'locked' && projection) projection.editable = false
    if (mode === 'no-projector') projectAvailable = false
    if (mode === 'denied') denial = true
    await expect(manageOpportunity(context(mode === 'locked' ? { action: 'saveForms', forms: [] } : { action: 'publish' },
      mode === 'wrong-owner' ? '45' : '44'))).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
  })
  it.each(['absent', 'draft', 'published'])('withdraws a %s call only when necessary', async mode => {
    if (mode === 'absent') call = null
    if (mode === 'published' && call) call.published = true
    expect(await manageOpportunity(context({ action: 'withdraw' }))).toEqual({ callId: mode === 'absent' ? null : 'D-ABCDE', published: false })
    expect(requests.filter(item => item.method === 'PATCH')).toHaveLength(mode === 'published' ? 1 : 0)
  })
  it('creates missing program, stream and call before attaching forms', async () => {
    hasProgram = false; hasStream = false; call = null
    expect(await manageOpportunity(context({ action: 'saveForms', forms: [] }))).toEqual({ callId: 'D-ABCDE', forms: [], published: false })
    expect(requests.filter(item => item.method === 'POST').map(item => item.path)).toEqual(['programs', 'streams', 'calls'])
  })
  it('reports failed call readback instead of attaching to an unknown call', async () => {
    call = null; readBack = false
    await expect(manageOpportunity(context({ action: 'saveForms', forms: [] }))).rejects.toThrow('could not be read back')
  })
  it.each(['duplicates', 'unattached', 'published', 'moved-stream', 'stale'])('rejects %s form reorder', async mode => {
    if (mode === 'published' && call) call.published = true
    if (mode === 'moved-stream' && call) call.streamId = 'S-BCDEF'
    if (mode === 'stale') revision = 2
    const forms = mode === 'duplicates' ? [form, form] : mode === 'unattached' ? [{ ...form, surveyId: 'V-BCDEF' }] : [form]
    await expect(manageOpportunity(context({ action: 'saveForms', forms }))).rejects.toThrow()
    expect(requests.some(item => item.path.endsWith('/forms'))).toBe(false)
  })
  it('reorders attached forms at their current revisions', async () => {
    expect(await manageOpportunity(context({ action: 'saveForms', forms: [form] }))).toEqual({ callId: 'D-ABCDE', forms: [form], published: false })
    expect(requests.find(item => item.path.endsWith('/forms'))?.body).toEqual({ forms: [form] })
  })
  it.each(['new', 'existing'])('saves a %s bilingual form and attaches its returned revision', async mode => {
    const result = await manageOpportunity(context({ action: 'saveForm', definition,
      ...(mode === 'existing' ? { surveyId: form.surveyId, expectedRevision: 1 } : {}) }))
    expect(result).toMatchObject({ survey: { id: mode === 'existing' ? 'V-ABCDE' : 'V-BCDEF', revision: 2 }, attached: true })
    expect(requests.find(item => item.path.endsWith('/forms'))?.body).toEqual({ forms: mode === 'existing'
      ? [{ surveyId: 'V-ABCDE', revision: 2 }] : [form, { surveyId: 'V-BCDEF', revision: 2 }] })
  })
  it.each(['missing-revision', 'missing-id', 'unattached', 'full'])('rejects %s form edits', async mode => {
    if (mode === 'full' && call) call.forms = Array.from({ length: 10 }, () => form)
    const extra = mode === 'missing-revision' ? { surveyId: 'V-ABCDE' } : mode === 'missing-id' ? { expectedRevision: 1 }
      : mode === 'unattached' ? { surveyId: 'V-BCDEF', expectedRevision: 1 } : {}
    await expect(manageOpportunity(context({ action: 'saveForm', definition, ...extra }))).rejects.toThrow()
    expect(requests.some(item => item.path === 'surveys' || item.path.startsWith('surveys/'))).toBe(false)
  })
  it.each(['published', 'no-forms', 'stale', 'untranslated', 'ready'])('checks %s publication state', async mode => {
    if (mode === 'published' && call) call.published = true
    if (mode === 'no-forms' && call) call.forms = []
    if (mode === 'stale') revision = 2
    if (mode === 'untranslated') translated = false
    if (mode === 'published' || mode === 'ready') expect(await manageOpportunity(context())).toEqual({ callId: 'D-ABCDE', published: true })
    else await expect(manageOpportunity(context())).rejects.toThrow(mode === 'no-forms' ? 'at least one form' : mode === 'stale' ? 'latest form revision' : 'English and French')
    expect(requests.filter(item => item.method === 'PATCH')).toHaveLength(mode === 'ready' ? 1 : 0)
  })
})
