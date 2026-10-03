import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { PGlite } from '@electric-sql/pglite'
import type { PortalSubmission, PortalUpdate } from '../shared/portal-contract.ts'

const portal = vi.hoisted(() => ({
  update: null as PortalUpdate | null,
  submission: null as PortalSubmission | null,
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
    updates: async () => ({ updates: portal.update ? [portal.update] : [], nextCursor: null }),
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
      CREATE TABLE extensions.gcs_portal_connection
        (agency_id text PRIMARY KEY, portal_agency_id text, portal_url text, scan_cursor text);
      CREATE TABLE extensions.gcs_portal_identity
        (agency_id text, portal_organization_id text, proponent_id text);
      CREATE TABLE extensions.gcs_portal_inbox
        (agency_id text, event_id text, kind text, submission_id text, item_submission_id text,
         created_at timestamptz, last_error text, PRIMARY KEY (agency_id,event_id));
      CREATE TABLE extensions.gcs_portal_receipt
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
      INSERT INTO extensions.gcs_portal_connection VALUES ('11','G-ABCDE','https://portal.example.test/',NULL);
      INSERT INTO extensions.gcs_portal_identity VALUES ('11','organization-1','55');
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
  })

  afterEach(async () => {
    await db.destroy()
  })

  const context = (database: Kysely<unknown>, create: ReturnType<typeof vi.fn>) => ({
    db: database, params: { agencyId: '11' },
    writeAuthorization: { createAgreementClaim: create }
  })

  it('commits the host draft and receipt together, then reuses the receipt on retry', async () => {
    const { syncPortal } = await import('../server/sync.ts')
    const first = await syncPortal(context(db, createClaim) as never)
    expect(first.imported).toEqual([{ itemSubmissionId: 'item-1', kind: 'claim', entityId: '88' }])
    expect((await sql`SELECT id FROM host_claim`.execute(db)).rows).toEqual([{ id: '88' }])
    expect((await sql`SELECT event_id, item_submission_id, state, gcs_entity_id FROM extensions.gcs_portal_receipt`.execute(db)).rows)
      .toEqual([{ event_id: '12', item_submission_id: 'item-1', state: 'imported', gcs_entity_id: '88' }])

    const retry = await syncPortal(context(db, createClaim) as never)
    expect(retry.imported).toEqual(first.imported)
    expect(createClaim).toHaveBeenCalledTimes(1)
    expect(createClaim.mock.calls[0]?.[1]).toMatchObject({ agreementId: '33', applicantRecipientId: '55' })
    expect(portal.publishItemReference).toHaveBeenCalledTimes(2)
    expect(portal.consume).toHaveBeenCalledTimes(2)
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
      CREATE TRIGGER receipt_rejection BEFORE INSERT ON extensions.gcs_portal_receipt
      FOR EACH ROW EXECUTE FUNCTION reject_receipt();`)
    const { syncPortal } = await import('../server/sync.ts')
    const result = await syncPortal(context(db, createClaim) as never)
    expect(result.imported).toEqual([])
    expect(result.pending).toEqual([expect.objectContaining({ eventId: '12', reason: expect.stringContaining('receipt rejected') })])
    expect((await sql`SELECT id FROM host_claim`.execute(db)).rows).toEqual([])
    expect((await sql`SELECT id FROM extensions.gcs_portal_receipt`.execute(db)).rows).toEqual([])
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
    expect((await sql`SELECT state FROM extensions.gcs_portal_receipt`.execute(db)).rows).toEqual([{ state: 'received' }])
    const retry = await syncPortal(context(db, createClaim) as never)
    expect(retry.imported).toEqual([{ itemSubmissionId: 'item-1', kind: 'other_form', entityId: 'portal-receipt:1' }])
    expect((await sql`SELECT count(*)::int AS count FROM extensions.gcs_portal_receipt`.execute(db)).rows).toEqual([{ count: 1 }])
    expect(portal.consume).toHaveBeenCalledWith('12', 'portal-receipt:1')
    expect(createClaim).not.toHaveBeenCalled()
  })
})
