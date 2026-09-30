import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { PGlite } from '@electric-sql/pglite'
import type { PortalSubmission, PortalUpdate } from '../shared/portal-contract.ts'
vi.mock('../server/authorization.ts', () => ({ agencyIdFromContext: (context: { params: { agencyId: string } }) => context.params.agencyId, authorizedWrite: async (context: { db: Kysely<unknown> }, operation: (trx: unknown) => Promise<unknown>) => context.db.transaction().execute(operation as never) }))
import { applicationNumericId, importSurvey } from '../server/survey-import.ts'
import { getReceipt, listReceipts } from '../server/sync.ts'
const definition = { schemaVersion: 3, title: { en: 'Project', fr: 'Projet' },
  questions: [{ id: 'title', type: 'text', label: { en: 'Title', fr: 'Titre' }, required: true, maxLength: 500 }],
  pages: [{ id: 'page_1', title: { en: 'Details', fr: 'Détails' }, questionIds: ['title'], groups: [], branches: [] }] }
const item = (id: string) => ({ kind: 'survey', itemSubmissionId: id, answers: { title: 'Northern health' },
  survey: { id: 'form', kind: 'survey', surveyId: 'V-ABCDE', surveyRevision: 1 }, definition })
const submission = (application = false): PortalSubmission => ({ schemaVersion: 1,
  submissionId: 'K-ABCDE', organizationId: 'N-ABCDE', agreementReference: null,
  sourceSystem: application ? 'gcs-ssc-opportunity' : 'gcs-ssc-form',
  application: application ? { callId: 'D-ABCDE', sourceSystem: 'gcs-ssc-opportunity', foreignSystemId: '110' } : null,
  items: [item('item-1')] })
const event = (id = 'item-1'): PortalUpdate => ({ eventId: id === 'item-1' ? '1' : '2',
  kind: 'submission_item', submissionId: 'K-ABCDE', itemSubmissionId: id, detailId: null,
  createdAt: '2026-09-29T00:00:00.000Z', consumedAt: null, remoteReference: null })

describe('immutable survey and application receipt imports', () => {
  let engine: PGlite
  let db: Kysely<unknown>
  const client = { structure: vi.fn(), sets: vi.fn() }
  const create = vi.fn()
  const context = () => ({ db, params: { agencyId: '1' }, writeAuthorization: { createFundingCaseIntake: create } })
  const run = (source: PortalSubmission, update = event()) => importSurvey(context() as never, '1', update, source, client as never, 'portal:instance1')
  beforeEach(async () => {
    vi.clearAllMocks(); engine = new PGlite(); db = new Kysely({ dialect: new KyselyPGlite(engine).dialect })
    await engine.exec(`CREATE SCHEMA extensions;
      CREATE TABLE extensions.gcs_portal_identity (agency_id text,portal_organization_id text,proponent_id text);
      CREATE TABLE extensions.agency_enablement (agency_id bigint,extension_key text,enabled boolean,config jsonb,_deleted boolean DEFAULT false);
      CREATE TABLE extensions.gcs_portal_receipt (id bigserial PRIMARY KEY,agency_id text,event_id text,
        submission_id text,item_submission_id text,kind text,source_export jsonb,gcs_entity_type text,gcs_entity_id text,
        state text,created_at timestamptz DEFAULT now(),updated_at timestamptz,
        UNIQUE(agency_id,event_id),UNIQUE(agency_id,item_submission_id));
      CREATE TABLE host_intake (id text PRIMARY KEY, source text UNIQUE);
      INSERT INTO extensions.gcs_portal_identity VALUES ('1','N-ABCDE','55');
      INSERT INTO extensions.agency_enablement (agency_id,extension_key,enabled,config) VALUES (1,'gcs-ssc-portal-connector',true,'{"intakeGroupId":"4"}');`)
    client.structure.mockResolvedValue({ calls: [{ id: 'D-ABCDE',sourceSystem: 'gcs-ssc-opportunity',foreignSystemId: '110' }] })
    create.mockImplementation(async (trx, input) => {
      const prior = (await sql`SELECT id FROM host_intake WHERE source=${input.sourceSubmissionId}`.execute(trx)).rows[0]
      if (prior) return { status: 'already_imported',intakeId: '99' }
      await sql`INSERT INTO host_intake VALUES ('99',${input.sourceSubmissionId})`.execute(trx)
      return { status: 'created',intakeId: '99',draftStatusId: '2' }
    })
  })
  afterEach(async () => { await db.destroy() })
  it('retains other-form evidence once and returns its receipt after publication changes', async () => {
    const source = submission(); expect(await run(source)).toEqual({ kind: 'other_form',entityId: 'portal-receipt:1' })
    client.sets.mockRejectedValue(new Error('withdrawn publication'))
    expect(await run(source)).toEqual({ kind: 'other_form',entityId: 'portal-receipt:1' })
    expect(client.sets).not.toHaveBeenCalled()
    expect((await sql`SELECT count(*)::int AS count FROM extensions.gcs_portal_receipt`.execute(db)).rows[0]).toEqual({count:1})
  })
  it('promotes matching unsupported evidence without losing its original source', async () => {
    const source = submission()
    await sql`INSERT INTO extensions.gcs_portal_receipt (agency_id,event_id,submission_id,item_submission_id,kind,source_export,state)
      VALUES ('1','1','K-ABCDE','item-1','survey',${JSON.stringify(source)}::jsonb,'unsupported')`.execute(db)
    expect(await run(source)).toEqual({kind:'other_form',entityId:'portal-receipt:1'})
    expect((await sql`SELECT state,source_export FROM extensions.gcs_portal_receipt`.execute(db)).rows[0]).toEqual({state:'received',source_export:source})
  })
  it('rejects changed retained evidence and unverified organizations', async () => {
    await run(submission());const changed=submission();changed.items[0]!.answers={title:'Changed'}
    await expect(run(changed)).rejects.toThrow('importEvidenceConflict')
    await sql`DELETE FROM extensions.gcs_portal_identity`.execute(db)
    await expect(run(submission())).rejects.toThrow('importUnverifiedOrganization')
  })
  it('imports all application forms into one host Intake with per-item receipts', async () => {
    const source=submission(true);source.items.push(item('item-2'))
    expect(await run(source)).toEqual({kind:'funding_application',entityId:'99'})
    expect(await run(source,event('item-2'))).toEqual({kind:'funding_application',entityId:'99'})
    expect((await sql`SELECT count(*)::int AS count FROM host_intake`.execute(db)).rows[0]).toEqual({count:1})
    expect((await sql`SELECT count(*)::int AS count FROM extensions.gcs_portal_receipt`.execute(db)).rows[0]).toEqual({count:2})
    expect(create.mock.calls[0]![1]).toEqual(expect.objectContaining({opportunityId:'110',groupId:'4',applicantRecipientId:'55',sourceExport:source}))
    client.structure.mockRejectedValue(new Error('changed call'))
    expect(await run(source)).toEqual({kind:'funding_application',entityId:'99'})
  })
  it('retains no receipt or host row when receipt insertion rolls back', async () => {
    await engine.exec(`CREATE FUNCTION reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rejected'; END $$;
      CREATE TRIGGER reject_receipt BEFORE INSERT ON extensions.gcs_portal_receipt FOR EACH ROW EXECUTE FUNCTION reject_receipt();`)
    await expect(run(submission(true))).rejects.toThrow('rejected')
    expect((await sql`SELECT id FROM host_intake`.execute(db)).rows).toEqual([])
  })
  it('ignores soft-deleted settings and re-reads the configured group for each new application', async () => {
    await sql`UPDATE extensions.agency_enablement SET _deleted=true`.execute(db)
    await expect(run(submission(true))).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
    await sql`INSERT INTO extensions.agency_enablement (agency_id,extension_key,enabled,config)
      VALUES (1,'gcs-ssc-portal-connector',true,'{"intakeGroupId":"7"}')`.execute(db)
    expect(await run(submission(true))).toEqual({kind:'funding_application',entityId:'99'})
    expect(create.mock.calls[0]![1].groupId).toBe('7')
  })
  it('does not acknowledge applications without explicit configuration or a valid host result', async () => {
    await sql`UPDATE extensions.agency_enablement SET config='{}'`.execute(db)
    await expect(run(submission(true))).rejects.toThrow();expect(create).not.toHaveBeenCalled()
    await sql`UPDATE extensions.agency_enablement SET config='{"intakeGroupId":"4"}'`.execute(db)
    create.mockResolvedValue({status:'application_id_conflict'})
    await expect(run(submission(true))).rejects.toThrow('importApplicationIdConflict')
    expect((await sql`SELECT id FROM extensions.gcs_portal_receipt`.execute(db)).rows).toEqual([])
  })
  it('keeps receipt lists thin and isolates detail evidence by agency', async () => {
    await run(submission())
    const list=await listReceipts(context() as never);expect(list.receipts[0]).not.toHaveProperty('source_export')
    expect((await getReceipt({...context(),params:{agencyId:'1',receiptId:'1'}} as never)).receipt.source_export).toEqual(submission())
    await expect(getReceipt({...context(),params:{agencyId:'2',receiptId:'1'}} as never)).rejects.toMatchObject({ code:'GCS_PORTAL_RECEIPT_NOT_FOUND', statusCode:404 })
    for (const receiptId of ['9223372036854775808','9999999999999999999','0','bad'])
      await expect(getReceipt({...context(),params:{agencyId:'1',receiptId}} as never)).rejects.toMatchObject({ code:'GCS_PORTAL_RECEIPT_INVALID_ID',statusCode:400 })
  })
  it('generates deterministic positive bigint surrogates separated by source instance', () => {
    const id=applicationNumericId('portal:a','K-ABCDE')
    expect(id).toEqual(applicationNumericId('portal:a','K-ABCDE'))
    expect(BigInt(id)>BigInt(0) && BigInt(id)<=BigInt('9223372036854775807')).toBe(true)
    expect(id).not.toEqual(applicationNumericId('portal:b','K-ABCDE'))
    expect(id).not.toEqual(applicationNumericId('portal:a','K-BCDEF'))
  })
})
