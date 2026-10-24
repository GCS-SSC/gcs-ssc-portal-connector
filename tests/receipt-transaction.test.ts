import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { PGlite } from '@electric-sql/pglite'
import type { PortalSubmission, PortalUpdate } from '../shared/portal-contract.ts'

const portal = vi.hoisted(() => ({
  update: null as PortalUpdate | null,
  submission: null as PortalSubmission | null,
  updates: vi.fn<(after?: string) => Promise<{ updates: PortalUpdate[]; nextCursor: string | null }>>(),
  response: vi.fn(async () => ({ evidence: 'original documentation' })),
  publishItemReference: vi.fn(async () => undefined),
  consume: vi.fn(async () => undefined)
}))

vi.mock('../server/authorization.ts', () => ({
  EXTENSION_KEY: 'gcs-ssc-portal-connector',
  agencyIdFromContext: (context: { params: { agencyId: string } }) => context.params.agencyId,
  // Keep the real PostgreSQL transaction but control the host lifecycle/auth lock seam.
  authorizedWrite: async (context: { db: Kysely<unknown> }, operation: (trx: unknown) => Promise<unknown>) =>
    context.db.transaction().execute(operation as never)
}))
vi.mock('../server/connection.ts', () => ({ readPortalCredential: vi.fn(async () => 'credential') }))
vi.mock('../server/portal-client.ts', () => ({
  /**
   * Supplies the deterministic Portal interchange used by these transaction tests.
   * @returns The fake client bound to the current test submission.
   */
  createPortalClient: () => ({
    updates: portal.updates,
    response: portal.response,
    submission: async () => portal.submission,
    publishItemReference: portal.publishItemReference,
    consume: portal.consume
  })
}))

const update = (eventId: string, itemSubmissionId: string): PortalUpdate => ({
  eventId, kind: 'submission_item', submissionId: 'submission-1', itemSubmissionId,
  detailId: null, createdAt: '2026-09-26T00:00:00.000Z', consumedAt: null, remoteReference: null
})
/**
 * Builds a Claim carrying its frozen submitting Proponent.
 * @param itemSubmissionId - Stable identity of the submitted item.
 * @returns The verified organization's original Claim export.
 */
const submission = (itemSubmissionId: string): PortalSubmission => ({
  schemaVersion: 1, submissionId: 'submission-1', organizationId: 'organization-1',
  agreementReference: { externalApplicantRecipientId: '55', externalStreamId: '44' },
  items: [{ kind: 'claim', itemSubmissionId, mappingComplete: true, claim: {
    agreementId: '33', applicantRecipientId: '55', streamId: '44', fiscalYearId: '77', isFinalForYear: false,
    periodStart: 0, periodEnd: 0, receivedDate: '2026-09-26T00:00:00.000Z',
    lineItems: [{ budgetLineItemId: '66', submittedCostCategory: null,
      submittedCostSubsection: null, submittedLineItem: null,
      description: 'Eligible cost', amount: '1.00', currency: 'CAD' }]
  } }]
})

const forecastSubmission = (): PortalSubmission => ({
  ...submission('item-1'),
  items: [{ kind: 'forecast', itemSubmissionId: 'item-1', mappingComplete: true,
    forecast: { agreementId: '33', header: { egcs_fc_fiscalyear: '77' },
      lineItems: [{ egcs_fc_fundingagreementbudgetlineitem: '66', egcs_fc_month: 0,
        egcs_fc_amount: '1000.00', egcs_fc_currency: 'CAD' }] }
  }]
})

describe('portal Claim receipt transaction', () => {
  let db: Kysely<unknown>
  let engine: PGlite
  let createClaim: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    engine = new PGlite()
    db = new Kysely({ dialect: new KyselyPGlite(engine).dialect })
    await engine.exec(`
      CREATE SCHEMA extensions;
      CREATE TABLE extensions.gcs_ssc_portal_connector_connection
        (agency_id text PRIMARY KEY, portal_agency_id text, portal_url text, scan_cursor text);
      CREATE TABLE extensions.gcs_ssc_portal_connector_identity
        (agency_id text, portal_organization_id text, proponent_id text);
      CREATE TABLE extensions.gcs_ssc_portal_connector_inbox
        (agency_id text, event_id text, kind text, submission_id text, item_submission_id text,
         created_at timestamptz, last_error text, PRIMARY KEY (agency_id,event_id));
      CREATE TABLE extensions.gcs_ssc_portal_connector_receipt
        (id bigserial PRIMARY KEY, agency_id text, event_id text, submission_id text,
         item_submission_id text, kind text, source_export jsonb, gcs_entity_type text,
         gcs_entity_id text, state text, updated_at timestamptz,
         UNIQUE (agency_id,event_id), UNIQUE (agency_id,item_submission_id));
      CREATE TABLE "Funding_Case_Agreement_Profile"
        (id text PRIMARY KEY, egcs_fc_transferpaymentstream text, _deleted boolean);
      CREATE TABLE "Transfer_Payment_Stream"
        (id text PRIMARY KEY, egcs_tp_transferpaymentprofile text, _deleted boolean);
      CREATE TABLE "Transfer_Payment_Profile"
        (id text PRIMARY KEY, egcs_tp_agency text, _deleted boolean);
      CREATE TABLE "Funding_Case_Agreement_Applicant_Recipient"
        (id text PRIMARY KEY, egcs_fc_fundingagreement text, egcs_fc_applicantrecipient text, _deleted boolean);
      CREATE TABLE host_claim (id text PRIMARY KEY);
      INSERT INTO extensions.gcs_ssc_portal_connector_connection VALUES ('11','G-ABCDE','https://portal.example.test/',NULL);
      INSERT INTO extensions.gcs_ssc_portal_connector_identity VALUES ('11','organization-1','55');
      INSERT INTO "Transfer_Payment_Profile" VALUES ('99','11',false);
      INSERT INTO "Transfer_Payment_Stream" VALUES ('44','99',false);
      INSERT INTO "Funding_Case_Agreement_Profile" VALUES ('33','44',false);
      INSERT INTO "Funding_Case_Agreement_Applicant_Recipient" VALUES ('1','33','55',false);
    `)
    createClaim = vi.fn(async (transaction: Kysely<unknown>, _input: { agreementId: string; applicantRecipientId: string }) => {
      await sql`INSERT INTO host_claim (id) VALUES ('88')`.execute(transaction)
      return { status: 'created', claimId: '88', lineItemIds: ['89'], draftStatusId: '90' }
    })
    portal.update = update('12', 'item-1')
    portal.submission = submission('item-1')
    portal.updates.mockImplementation(async () => ({ updates: portal.update ? [portal.update] : [], nextCursor: null }))
    portal.response.mockResolvedValue({ evidence: 'original documentation' })
  })

  afterEach(async () => {
    await db.destroy()
  })

  const context = (database: Kysely<unknown>, create: ReturnType<typeof vi.fn>) => ({
    db: database, params: { agencyId: '11' },
    writeAuthorization: { createAgreementClaim: create }
  })

  it('requires a connection before reading remote updates or creating drafts', async () => {
    await db.deleteFrom('extensions.gcs_ssc_portal_connector_connection' as never).execute()
    const { syncPortal } = await import('../server/sync.ts')
    await expect(syncPortal(context(db, createClaim) as never)).rejects.toThrow('Connect an organization portal')
    expect(portal.updates).not.toHaveBeenCalled()
    expect(createClaim).not.toHaveBeenCalled()
  })

  it.each(['claim', 'forecast'] as const)('reuses a completed %s receipt after an acknowledgement retry', async kind => {
    if (kind === 'forecast') portal.submission = forecastSubmission()
    const createForecast = vi.fn(async () => ({ status: 'created', forecastId: '91', version: '3', lineItemIds: [], draftStatusId: '90' }))
    const request = { ...context(db, createClaim), writeAuthorization: { createAgreementClaim: createClaim, createAgreementForecast: createForecast } }
    const { syncPortal } = await import('../server/sync.ts')
    const first = await syncPortal(request as never)
    const retry = await syncPortal(request as never)
    expect(retry.imported).toEqual(first.imported)
    expect(retry.imported).toHaveLength(1)
    expect(kind === 'claim' ? createClaim : createForecast).toHaveBeenCalledTimes(1)
    expect(portal.consume).toHaveBeenCalledTimes(2)
    expect((await sql`SELECT count(*)::int AS count FROM extensions.gcs_ssc_portal_connector_receipt`.execute(db)).rows).toEqual([{ count: 1 }])
  })

  it.each(['claim', 'forecast'] as const)('keeps a %s pending when the atomic host service is unavailable', async kind => {
    if (kind === 'forecast') portal.submission = forecastSubmission()
    const { syncPortal } = await import('../server/sync.ts')
    const result = await syncPortal({ db, params: { agencyId: '11' }, writeAuthorization: {} } as never)
    expect(result.pending).toEqual([expect.objectContaining({ reason: `The host does not provide atomic ${kind === 'claim' ? 'Claim' : 'Forecast'} creation.` })])
    expect(result.imported).toEqual([])
    expect(portal.consume).not.toHaveBeenCalled()
    expect((await sql`SELECT id FROM extensions.gcs_ssc_portal_connector_receipt`.execute(db)).rows).toEqual([])
  })

  it.each(['claim', 'forecast'] as const)('retains a %s whose host creation result is not created', async kind => {
    if (kind === 'forecast') portal.submission = forecastSubmission()
    const rejected = vi.fn(async () => ({ status: 'unavailable' }))
    const { syncPortal } = await import('../server/sync.ts')
    const result = await syncPortal({ db, params: { agencyId: '11' },
      writeAuthorization: { createAgreementClaim: rejected, createAgreementForecast: rejected } } as never)
    expect(result.pending).toEqual([expect.objectContaining({ reason: `${kind === 'claim' ? 'Claim' : 'Forecast'} cannot be imported: unavailable.` })])
    expect(result.imported).toEqual([])
    expect(portal.publishItemReference).not.toHaveBeenCalled()
    expect(portal.consume).not.toHaveBeenCalled()
    expect((await sql`SELECT id FROM extensions.gcs_ssc_portal_connector_receipt`.execute(db)).rows).toEqual([])
  })

  it.each([
    ['claim', 'event'], ['claim', 'state'], ['claim', 'entity'],
    ['forecast', 'event'], ['forecast', 'state'], ['forecast', 'entity']
  ] as const)('does not acknowledge a conflicting %s receipt with mismatched %s', async (kind, field) => {
    if (kind === 'forecast') portal.submission = forecastSubmission()
    await sql`INSERT INTO extensions.gcs_ssc_portal_connector_receipt
      (agency_id,event_id,submission_id,item_submission_id,kind,state,gcs_entity_id)
      VALUES ('11',${field === 'event' ? '99' : '12'},'submission-1','item-1',${kind},
        ${field === 'state' ? 'received' : 'imported'},${field === 'entity' ? null : '88'})`.execute(db)
    const createForecast = vi.fn()
    const { syncPortal } = await import('../server/sync.ts')
    const result = await syncPortal({ ...context(db, createClaim),
      writeAuthorization: { createAgreementClaim: createClaim, createAgreementForecast: createForecast } } as never)
    expect(result.pending).toEqual([expect.objectContaining({ reason: 'A conflicting or incomplete import receipt already exists.' })])
    expect(result.imported).toEqual([])
    expect(createClaim).not.toHaveBeenCalled()
    expect(createForecast).not.toHaveBeenCalled()
    expect(portal.consume).not.toHaveBeenCalled()
  })

  it.each(['proponent', 'stream'] as const)('leaves a Forecast pending without its frozen %s mapping', async missing => {
    portal.submission = { ...forecastSubmission(), agreementReference: {
      externalApplicantRecipientId: missing === 'proponent' ? null : '55',
      externalStreamId: missing === 'stream' ? null : '44'
    } }
    const createForecast = vi.fn()
    const { syncPortal } = await import('../server/sync.ts')
    const result = await syncPortal({ ...context(db, createClaim), writeAuthorization: { createAgreementForecast: createForecast } } as never)
    expect(result.pending).toEqual([expect.objectContaining({ reason: 'The organization has no verified GCS agreement and proponent mapping.' })])
    expect(createForecast).not.toHaveBeenCalled()
    expect(portal.consume).not.toHaveBeenCalled()
  })

  it('revalidates Forecast organization and live Stream ownership before calling the host', async () => {
    portal.submission = forecastSubmission()
    const createForecast = vi.fn()
    const request = { ...context(db, createClaim), writeAuthorization: { createAgreementForecast: createForecast } }
    const { syncPortal } = await import('../server/sync.ts')
    await sql`UPDATE extensions.gcs_ssc_portal_connector_identity SET proponent_id='56'`.execute(db)
    expect((await syncPortal(request as never)).pending).toEqual([expect.objectContaining({ reason: expect.stringContaining('not verified') })])
    await sql`UPDATE extensions.gcs_ssc_portal_connector_identity SET proponent_id='55'`.execute(db)
    await sql`UPDATE "Transfer_Payment_Stream" SET _deleted=true`.execute(db)
    expect((await syncPortal(request as never)).pending).toEqual([expect.objectContaining({ reason: expect.stringContaining('mapping do not match') })])
    expect(createForecast).not.toHaveBeenCalled()
    expect(portal.consume).not.toHaveBeenCalled()
  })

  it.each(['item', 'detail', 'event'] as const)('retains unsupported documentation once using its %s identity and leaves it unacknowledged', async identity => {
    portal.update = { ...update('12', 'item-1'), kind: 'organization_detail',
      itemSubmissionId: identity === 'item' ? 'item-1' : null, detailId: identity === 'detail' ? 'detail-1' : null }
    const { syncPortal } = await import('../server/sync.ts')
    const first = await syncPortal(context(db, createClaim) as never)
    expect(first.pending).toEqual([expect.objectContaining({ eventId: '12', code: 'documentationPending' })])
    await syncPortal(context(db, createClaim) as never)
    expect((await sql`SELECT item_submission_id, state, source_export FROM extensions.gcs_ssc_portal_connector_receipt`.execute(db)).rows)
      .toEqual([{ item_submission_id: identity === 'item' ? 'item-1' : identity === 'detail' ? 'detail-1' : 'event:12',
        state: 'unsupported', source_export: { evidence: 'original documentation' } }])
    expect(portal.consume).not.toHaveBeenCalled()
    expect(createClaim).not.toHaveBeenCalled()
  })

  it('retains a submission whose requested item is absent without creating or acknowledging a draft', async () => {
    portal.submission = submission('different-item')
    const { syncPortal } = await import('../server/sync.ts')
    const result = await syncPortal(context(db, createClaim) as never)
    expect(result.pending).toEqual([expect.objectContaining({ code: 'unsupportedPending', organizationId: 'organization-1' })])
    expect((await sql`SELECT kind,state FROM extensions.gcs_ssc_portal_connector_receipt`.execute(db)).rows).toEqual([{ kind: 'unknown', state: 'unsupported' }])
    expect(createClaim).not.toHaveBeenCalled()
    expect(portal.consume).not.toHaveBeenCalled()
  })

  it('records an untyped remote failure without losing the pending event', async () => {
    portal.update = { ...update('12', 'item-1'), kind: 'organization_detail' }
    portal.response.mockRejectedValueOnce('Transport disconnected')
    const { syncPortal } = await import('../server/sync.ts')
    const result = await syncPortal(context(db, createClaim) as never)
    expect(result.pending).toEqual([{ eventId: '12', reason: 'Import failed.' }])
    expect((await sql`SELECT last_error FROM extensions.gcs_ssc_portal_connector_inbox`.execute(db)).rows).toEqual([{ last_error: 'Import failed.' }])
    expect(portal.consume).not.toHaveBeenCalled()
  })

  it('bounds each feed scan to four pages and resumes its cursor on the next run', async () => {
    portal.updates.mockImplementation(async after => ({ updates: [], nextCursor: String(Number(after ?? 20) + 1) }))
    const { syncPortal } = await import('../server/sync.ts')
    expect(await syncPortal(context(db, createClaim) as never)).toEqual({ imported: [], pending: [], hasMore: true })
    expect(portal.updates.mock.calls).toEqual([[undefined], ['21'], ['22'], ['23']])
    expect((await sql`SELECT scan_cursor FROM extensions.gcs_ssc_portal_connector_connection`.execute(db)).rows).toEqual([{ scan_cursor: '24' }])
    portal.updates.mockResolvedValueOnce({ updates: [], nextCursor: null })
    expect((await syncPortal(context(db, createClaim) as never)).hasMore).toBe(false)
    expect(portal.updates).toHaveBeenLastCalledWith('24')
    expect((await sql`SELECT scan_cursor FROM extensions.gcs_ssc_portal_connector_connection`.execute(db)).rows).toEqual([{ scan_cursor: null }])
  })

  it('commits the host draft and receipt together, then reuses the receipt on retry', async () => {
    const { syncPortal } = await import('../server/sync.ts')
    const first = await syncPortal(context(db, createClaim) as never)
    expect(first.imported).toEqual([{ itemSubmissionId: 'item-1', kind: 'claim', entityId: '88' }])
    expect((await sql`SELECT id FROM host_claim`.execute(db)).rows).toEqual([{ id: '88' }])
    expect((await sql`SELECT event_id, item_submission_id, state, gcs_entity_id FROM extensions.gcs_ssc_portal_connector_receipt`.execute(db)).rows)
      .toEqual([{ event_id: '12', item_submission_id: 'item-1', state: 'imported', gcs_entity_id: '88' }])

    const retry = await syncPortal(context(db, createClaim) as never)
    expect(retry.imported).toEqual(first.imported)
    expect(createClaim).toHaveBeenCalledTimes(1)
    expect(createClaim.mock.calls[0]?.[1]).toMatchObject({ agreementId: '33', applicantRecipientId: '55' })
    expect(portal.publishItemReference).toHaveBeenCalledTimes(2)
    expect(portal.consume).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('imports a Forecast without assigning a version (historical zero: %s)', async legacy => {
    const createForecast = vi.fn(async () => ({
      status: 'created', forecastId: '91', version: '3', lineItemIds: ['92'], draftStatusId: '90'
    }))
    portal.submission = {
      ...submission('item-1'),
      items: [{ kind: 'forecast', itemSubmissionId: 'item-1', mappingComplete: true,
        forecast: { agreementId: '33', header: { egcs_fc_fiscalyear: '77' },
          lineItems: [{ egcs_fc_fundingagreementbudgetlineitem: '66', egcs_fc_month: 0,
            egcs_fc_amount: '1000.00', egcs_fc_currency: 'CAD' }] }
      }]
    }
    if (legacy) {
      const item = portal.submission.items[0] as unknown as { forecast: { lineItems: object[] } }
      Object.assign(item.forecast.lineItems[0]!, { egcs_fc_version: '0' })
    }
    const { syncPortal } = await import('../server/sync.ts')
    const result = await syncPortal({ db, params: { agencyId: '11' },
      writeAuthorization: { createAgreementForecast: createForecast } } as never)
    expect(result.imported).toEqual([{ itemSubmissionId: 'item-1', kind: 'forecast', entityId: '91' }])
    expect(createForecast).toHaveBeenCalledWith(expect.anything(), {
      agreementId: '33', streamId: '44', fiscalYearId: '77', applicantRecipientId: '55',
      lineItems: [{ budgetLineItemId: '66', month: 0, amount: '1000.00', currency: 'CAD' }]
    })
    expect(portal.consume).toHaveBeenCalledWith('12', '91')
  })

  it('uses the verified organization identity on a multi-Proponent Agreement and rejects an alternative submitting Proponent', async () => {
    await engine.exec(`INSERT INTO "Funding_Case_Agreement_Applicant_Recipient" VALUES ('2','33','56',false);`)
    const original = submission('item-1')
    const item = original.items[0] as unknown as { claim: { applicantRecipientId: string } }
    item.claim.applicantRecipientId = '56'
    portal.submission = original
    const { syncPortal } = await import('../server/sync.ts')
    const rejected = await syncPortal(context(db, createClaim) as never)
    expect(rejected.imported).toEqual([])
    expect(rejected.pending).toEqual([expect.objectContaining({ reason: expect.stringContaining('not verified') })])
    expect(createClaim).not.toHaveBeenCalled()
    expect(portal.consume).not.toHaveBeenCalled()
    expect((await sql`SELECT id FROM host_claim`.execute(db)).rows).toEqual([])
    portal.submission = submission('item-1')
    const accepted = await syncPortal(context(db, createClaim) as never)
    expect(accepted.imported).toHaveLength(1)
    expect(createClaim.mock.calls[0]?.[1]).toMatchObject({ applicantRecipientId: '55' })
  })

  it('leaves a Claim pending if its submitting Proponent is missing or its Agreement relationship was removed', async () => {
    const { syncPortal } = await import('../server/sync.ts')
    const original = submission('item-1')
    delete (original.items[0] as unknown as { claim: { applicantRecipientId?: string } }).claim.applicantRecipientId
    portal.submission = original
    expect((await syncPortal(context(db, createClaim) as never)).imported).toEqual([])
    expect(createClaim).not.toHaveBeenCalled()
    portal.submission = submission('item-1')
    await engine.exec(`UPDATE "Funding_Case_Agreement_Applicant_Recipient" SET _deleted=true WHERE egcs_fc_applicantrecipient='55';`)
    const result = await syncPortal(context(db, createClaim) as never)
    expect(result.imported).toEqual([])
    expect(result.pending).toEqual([expect.objectContaining({ reason: expect.stringContaining('mapping do not match') })])
    expect(createClaim).not.toHaveBeenCalled()
    expect(portal.consume).not.toHaveBeenCalled()
  })

  it('rolls the host draft back if receipt insertion fails', async () => {
    await engine.exec(`CREATE FUNCTION reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'receipt rejected'; END $$;
      CREATE TRIGGER receipt_rejection BEFORE INSERT ON extensions.gcs_ssc_portal_connector_receipt
      FOR EACH ROW EXECUTE FUNCTION reject_receipt();`)
    const { syncPortal } = await import('../server/sync.ts')
    const result = await syncPortal(context(db, createClaim) as never)
    expect(result.imported).toEqual([])
    expect(result.pending).toEqual([expect.objectContaining({ eventId: '12', reason: expect.stringContaining('receipt rejected') })])
    expect((await sql`SELECT id FROM host_claim`.execute(db)).rows).toEqual([])
    expect((await sql`SELECT id FROM extensions.gcs_ssc_portal_connector_receipt`.execute(db)).rows).toEqual([])
    expect(portal.publishItemReference).not.toHaveBeenCalled()
    expect(portal.consume).not.toHaveBeenCalled()
  })
  it('retries a failed other-form outcome acknowledgement without duplicating durable evidence', async () => {
    portal.submission = { schemaVersion: 1, submissionId: 'submission-1', organizationId: 'organization-1',
      agreementReference: null, sourceSystem: 'gcs-ssc-form', application: null,
      items: [{ kind: 'survey', itemSubmissionId: 'item-1', answers: { title: 'Submitted project' },
        survey: { id: 'form', kind: 'survey', surveyId: 'V-ABCDE', surveyRevision: 1 },
        definition: { schemaVersion: 3, title: { en: 'Project', fr: 'Projet' },
          questions: [{ id: 'title', type: 'text', label: { en: 'Title', fr: 'Titre' }, required: true, maxLength: 500 }],
          pages: [{ id: 'page_1', title: { en: 'Details', fr: 'Détails' }, questionIds: ['title'], groups: [], branches: [] }] }
      }] }
    portal.publishItemReference.mockRejectedValueOnce(new Error('Ambiguous network response'))
    const { syncPortal } = await import('../server/sync.ts')
    const first = await syncPortal(context(db, createClaim) as never)
    expect(first.imported).toEqual([])
    expect(first.pending).toEqual([expect.objectContaining({ eventId: '12', reason: 'Ambiguous network response' })])
    expect(portal.consume).not.toHaveBeenCalled()
    expect((await sql`SELECT state FROM extensions.gcs_ssc_portal_connector_receipt`.execute(db)).rows).toEqual([{ state: 'received' }])
    const retry = await syncPortal(context(db, createClaim) as never)
    expect(retry.imported).toEqual([{ itemSubmissionId: 'item-1', kind: 'other_form', entityId: 'portal-receipt:1' }])
    expect((await sql`SELECT count(*)::int AS count FROM extensions.gcs_ssc_portal_connector_receipt`.execute(db)).rows).toEqual([{ count: 1 }])
    expect(portal.consume).toHaveBeenCalledWith('12', 'portal-receipt:1')
    expect(createClaim).not.toHaveBeenCalled()
  })
})
