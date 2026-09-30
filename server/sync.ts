import { sql } from 'kysely'
import { createHash } from 'node:crypto'
import { importSurvey } from './survey-import.ts'
import { defineGcsExtensionRouteHandler, createGcsExtensionUserError, type GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { claimItemSchema, forecastItemSchema, type PortalSubmission, type PortalUpdate } from '../shared/portal-contract.ts'
import { agencyIdFromContext, authorizedWrite } from './authorization.ts'
import { readPortalCredential } from './connection.ts'
import { asConnectorDb, type ConnectorDb } from './db.ts'
import { queuePortalClient } from './operations.ts'

const loadConnection = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const row = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_connection').selectAll()
    .where('agency_id', '=', agencyId).executeTakeFirst()
  if (!row) throw new Error('Connect an organization portal before synchronizing.')
  return {
    agencyId,
    sourceSystem: `gcs-ssc-portal:${createHash('sha256').update(JSON.stringify([row.portal_url, row.portal_agency_id])).digest('hex').slice(0, 32)}`,
    scanCursor: row.scan_cursor ?? undefined,
    client: queuePortalClient(asConnectorDb(context.db), agencyId, {
      portalUrl: row.portal_url,
      portalAgencyId: row.portal_agency_id,
      key: await readPortalCredential(context, agencyId)
    })
  }
}

const agreementRecipientAvailable = async (
  db: ConnectorDb, agencyId: string, agreementId: string, streamId: string, proponentId: string
): Promise<boolean> => {
  const scope = await db.selectFrom('Funding_Case_Agreement_Profile as agreement')
    .innerJoin('Transfer_Payment_Stream as stream', 'stream.id', 'agreement.egcs_fc_transferpaymentstream')
    .innerJoin('Transfer_Payment_Profile as program', 'program.id', 'stream.egcs_tp_transferpaymentprofile')
    .select('agreement.id')
    .where('agreement.id', '=', agreementId)
    .where('stream.id', '=', streamId)
    .where('program.egcs_tp_agency', '=', agencyId)
    .where('agreement._deleted', '=', false)
    .where('stream._deleted', '=', false)
    .where('program._deleted', '=', false)
    .executeTakeFirst()
  if (!scope) return false
  const recipient = await db.selectFrom('Funding_Case_Agreement_Applicant_Recipient')
    .select('id')
    .where('egcs_fc_fundingagreement', '=', agreementId)
    .where('egcs_fc_applicantrecipient', '=', proponentId)
    .where('_deleted', '=', false).executeTakeFirst()
  return Boolean(recipient)
}

const importClaim = async (
  context: GcsExtensionRouteContext, agencyId: string,
  update: PortalUpdate, submission: PortalSubmission
): Promise<string> => {
  const item = claimItemSchema.parse(submission.items.find((candidate) => candidate.itemSubmissionId === update.itemSubmissionId))
  const proponentId = submission.agreementReference?.externalApplicantRecipientId
  if (!proponentId) throw new Error('The organization has no verified GCS proponent mapping.')
  return authorizedWrite(context, async (transaction) => {
    const identity = await transaction.selectFrom('extensions.gcs_portal_identity').select('proponent_id')
      .where('agency_id', '=', agencyId).where('portal_organization_id', '=', submission.organizationId)
      .executeTakeFirst()
    if (identity?.proponent_id !== proponentId) throw new Error('The portal organization is not verified for this GCS recipient.')
    const existing = await transaction.selectFrom('extensions.gcs_portal_receipt').selectAll()
      .where('agency_id', '=', agencyId)
      .where('item_submission_id', '=', item.itemSubmissionId).forUpdate().executeTakeFirst()
    if (existing) {
      if (existing.event_id !== update.eventId || existing.state !== 'imported' || !existing.gcs_entity_id)
        throw new Error('A conflicting or incomplete import receipt already exists.')
      return String(existing.gcs_entity_id)
    }
    const claim = item.claim
    if (!(await agreementRecipientAvailable(transaction, agencyId, claim.agreementId, claim.streamId, proponentId)))
      throw new Error('The GCS agreement, stream, agency, and recipient mapping do not match.')
    const createClaim = context.writeAuthorization?.createAgreementClaim
    if (!createClaim) throw new Error('The host does not provide atomic Claim creation.')
    const result = await createClaim(transaction, {
      agreementId: claim.agreementId,
      applicantRecipientId: proponentId,
      streamId: claim.streamId,
      fiscalYearId: claim.fiscalYearId,
      isFinalForYear: claim.isFinalForYear,
      periodStart: claim.periodStart,
      periodEnd: claim.periodEnd,
      receivedDate: new Date(claim.receivedDate),
      submissionUuid: null,
      lineItems: claim.lineItems.map((line) => ({
        budgetLineItemId: line.budgetLineItemId,
        submittedCostCategory: line.submittedCostCategory,
        submittedCostSubsection: line.submittedCostSubsection,
        submittedLineItem: line.submittedLineItem,
        description: line.description,
        amount: line.amount,
        currency: line.currency
      }))
    })
    if (result.status !== 'created') throw new Error(`Claim cannot be imported: ${result.status}.`)
    await transaction.insertInto('extensions.gcs_portal_receipt').values({
      agency_id: agencyId,
      event_id: update.eventId,
      submission_id: submission.submissionId,
      item_submission_id: item.itemSubmissionId,
      kind: 'claim',
      source_export: sql`${JSON.stringify(submission)}::jsonb`,
      gcs_entity_type: 'fundingcaseagreementclaim',
      gcs_entity_id: result.claimId,
      state: 'imported',
      updated_at: new Date()
    }).execute()
    return result.claimId
  })
}

const importForecast = async (
  context: GcsExtensionRouteContext, agencyId: string,
  update: PortalUpdate, submission: PortalSubmission
): Promise<string> => {
  const item = forecastItemSchema.parse(submission.items.find((candidate) => candidate.itemSubmissionId === update.itemSubmissionId))
  const proponentId = submission.agreementReference?.externalApplicantRecipientId
  const streamId = submission.agreementReference?.externalStreamId
  if (!proponentId || !streamId) throw new Error('The organization has no verified GCS agreement and proponent mapping.')
  return authorizedWrite(context, async (transaction) => {
    const identity = await transaction.selectFrom('extensions.gcs_portal_identity').select('proponent_id')
      .where('agency_id', '=', agencyId).where('portal_organization_id', '=', submission.organizationId)
      .executeTakeFirst()
    if (identity?.proponent_id !== proponentId) throw new Error('The portal organization is not verified for this GCS recipient.')
    const existing = await transaction.selectFrom('extensions.gcs_portal_receipt').selectAll()
      .where('agency_id', '=', agencyId)
      .where('item_submission_id', '=', item.itemSubmissionId).forUpdate().executeTakeFirst()
    if (existing) {
      if (existing.event_id !== update.eventId || existing.state !== 'imported' || !existing.gcs_entity_id)
        throw new Error('A conflicting or incomplete import receipt already exists.')
      return String(existing.gcs_entity_id)
    }
    const forecast = item.forecast
    if (!(await agreementRecipientAvailable(transaction, agencyId, forecast.agreementId, streamId, proponentId)))
      throw new Error('The GCS agreement, stream, agency, and recipient mapping do not match.')
    const createForecast = context.writeAuthorization?.createAgreementForecast
    if (!createForecast) throw new Error('The host does not provide atomic Forecast creation.')
    const result = await createForecast(transaction, {
      agreementId: forecast.agreementId,
      streamId,
      fiscalYearId: forecast.header.egcs_fc_fiscalyear,
      applicantRecipientId: proponentId,
      lineItems: forecast.lineItems.map((line) => ({
        budgetLineItemId: line.egcs_fc_fundingagreementbudgetlineitem,
        month: line.egcs_fc_month,
        amount: line.egcs_fc_amount,
        currency: line.egcs_fc_currency,
        version: line.egcs_fc_version
      }))
    })
    if (result.status !== 'created') throw new Error(`Forecast cannot be imported: ${result.status}.`)
    await transaction.insertInto('extensions.gcs_portal_receipt').values({
      agency_id: agencyId,
      event_id: update.eventId,
      submission_id: submission.submissionId,
      item_submission_id: item.itemSubmissionId,
      kind: 'forecast',
      source_export: sql`${JSON.stringify(submission)}::jsonb`,
      gcs_entity_type: 'fundingcaseforecast',
      gcs_entity_id: result.forecastId,
      state: 'imported',
      updated_at: new Date()
    }).execute()
    return result.forecastId
  })
}

const retainUnsupported = async (
  context: GcsExtensionRouteContext, agencyId: string,
  update: PortalUpdate, evidence: unknown, kind: string
) => authorizedWrite(context, async (transaction) => {
  const itemId = update.itemSubmissionId ?? update.detailId ?? `event:${update.eventId}`
  const existing = await transaction.selectFrom('extensions.gcs_portal_receipt').select('id')
    .where('agency_id', '=', agencyId).where('event_id', '=', update.eventId).executeTakeFirst()
  if (existing) return
  await transaction.insertInto('extensions.gcs_portal_receipt').values({
    agency_id: agencyId, event_id: update.eventId, submission_id: update.submissionId,
    item_submission_id: itemId, kind,
    source_export: sql`${JSON.stringify(evidence)}::jsonb`,
    gcs_entity_type: null, gcs_entity_id: null,
    state: 'unsupported', updated_at: new Date()
  }).execute()
})

/** Bounded staff-triggered synchronization; failed items remain in the portal feed. */
export const syncPortal = async (context: GcsExtensionRouteContext) => {
  const { agencyId, client, scanCursor, sourceSystem } = await loadConnection(context)
  let after: string | undefined = scanCursor
  const imported: Array<{ itemSubmissionId: string; kind: 'claim' | 'forecast' | 'funding_application' | 'other_form'; entityId: string }> = []
  const pending: Array<{ eventId: string; reason: string; code?: 'forecastPending' | 'documentationPending' | 'unsupportedPending'; submissionId?: string; organizationId?: string }> = []
  let hasMore = false
  for (let page = 0; page < 4; page++) {
    const batch = await client.updates(after)
    hasMore = batch.nextCursor !== null
    for (const update of batch.updates) {
      await asConnectorDb(context.db).insertInto('extensions.gcs_portal_inbox').values({
        agency_id: agencyId, event_id: update.eventId, kind: update.kind,
        submission_id: update.submissionId, item_submission_id: update.itemSubmissionId,
        created_at: new Date(update.createdAt), last_error: null
      }).onConflict((conflict) => conflict.columns(['agency_id', 'event_id']).doNothing()).execute()
      try {
        if (update.kind === 'organization_detail') {
          await retainUnsupported(context, agencyId, update, await client.response(update.submissionId), 'organization_detail')
          pending.push({ eventId: update.eventId, code: 'documentationPending',
            submissionId: update.submissionId, reason: 'GCS documentation import is not available.' })
          continue
        }
        const submission = await client.submission(update.submissionId)
        const item = submission.items.find((candidate) => candidate.itemSubmissionId === update.itemSubmissionId)
        if (item?.kind === 'survey') {
          const result = await importSurvey(context, agencyId, update, submission, client, sourceSystem)
          await client.publishItemReference(update.submissionId, item.itemSubmissionId, result.entityId)
          await client.consume(update.eventId, result.entityId)
          await asConnectorDb(context.db).updateTable('extensions.gcs_portal_inbox')
            .set({ last_error: null }).where('agency_id', '=', agencyId).where('event_id', '=', update.eventId).execute()
          imported.push({ itemSubmissionId: item.itemSubmissionId, ...result })
          continue
        }
        if (item?.kind !== 'claim' && item?.kind !== 'forecast') {
          await retainUnsupported(context, agencyId, update, submission, item?.kind ?? 'unknown')
          pending.push({ eventId: update.eventId,
            code: item?.kind === 'forecast' ? 'forecastPending' : 'unsupportedPending',
            submissionId: update.submissionId, organizationId: submission.organizationId,
            reason: item?.kind === 'forecast'
            ? `Forecast submission ${update.submissionId} from organization ${submission.organizationId} is waiting for GCS forecast import support.`
            : `Submission ${update.submissionId} from organization ${submission.organizationId} cannot yet be imported into GCS.` })
          continue
        }
        const entityId = item.kind === 'claim'
          ? await importClaim(context, agencyId, update, submission)
          : await importForecast(context, agencyId, update, submission)
        await client.publishItemReference(update.submissionId, item.itemSubmissionId, entityId)
        await client.consume(update.eventId, entityId)
        await asConnectorDb(context.db).updateTable('extensions.gcs_portal_inbox')
          .set({ last_error: null }).where('agency_id', '=', agencyId)
          .where('event_id', '=', update.eventId).execute()
        imported.push({ itemSubmissionId: item.itemSubmissionId, kind: item.kind, entityId })
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Import failed.'
        await asConnectorDb(context.db).updateTable('extensions.gcs_portal_inbox')
          .set({ last_error: reason.slice(0, 500) }).where('agency_id', '=', agencyId)
          .where('event_id', '=', update.eventId).execute()
        pending.push({ eventId: update.eventId, reason })
      }
    }
    if (!batch.nextCursor) break
    after = batch.nextCursor
  }
  await authorizedWrite(context, async (transaction) => {
    await transaction.updateTable('extensions.gcs_portal_connection')
      .set({ scan_cursor: hasMore ? after ?? null : null })
      .where('agency_id', '=', agencyId).execute()
  })
  return { imported, pending, hasMore }
}

export const listReceipts = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const rows = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_receipt')
    .select(['id', 'event_id', 'submission_id', 'item_submission_id', 'kind', 'state', 'gcs_entity_id', 'created_at'])
    .select(sql<string | null>`source_export->>'organizationId'`.as('organization_id'))
    .select(sql<unknown>`(SELECT item->'definition'->'title' FROM jsonb_array_elements(source_export->'items') item
      WHERE item->>'itemSubmissionId'=item_submission_id LIMIT 1)`.as('form_title'))
    .where('agency_id', '=', agencyId).orderBy('id', 'desc').limit(100).execute()
  return { receipts: rows.map((row) => ({ ...row, id: String(row.id), created_at: new Date(row.created_at).toISOString() })) }
}

export const getReceipt = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const receiptId = context.params.receiptId
  if (!receiptId || !/^[1-9]\d{0,18}$/.test(receiptId) || BigInt(receiptId) > BigInt('9223372036854775807'))
    throw createGcsExtensionUserError({ code: 'GCS_PORTAL_RECEIPT_INVALID_ID', statusCode: 400,
      message: { en: 'Choose a valid Portal delivery.', fr: 'Choisissez une livraison au portail valide.' } })
  const receipt = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_receipt')
    .select(['id', 'submission_id', 'source_export', 'kind', 'state']).where('agency_id', '=', agencyId)
    .where('id', '=', receiptId).executeTakeFirst()
  if (!receipt) throw createGcsExtensionUserError({ code: 'GCS_PORTAL_RECEIPT_NOT_FOUND', statusCode: 404,
    message: { en: 'This Portal delivery is unavailable in this agency.',
      fr: 'Cette livraison au portail est indisponible dans cet organisme gouvernemental.' } })
  return { receipt }
}

export const syncRoute = defineGcsExtensionRouteHandler(syncPortal)
export const receiptsRoute = defineGcsExtensionRouteHandler(listReceipts)
