import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { sql } from 'kysely'
import { z } from 'zod'
import { surveySchema, answersSchema, validateSurveyAnswers } from '@gcs-ssc/survey'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import type { PortalSubmission, PortalUpdate } from '../shared/portal-contract.ts'
import { PortalImportDiagnostic, intakeResultDiagnostic } from '../shared/import-diagnostics.ts'
import { authorizedWrite } from './authorization.ts'
import type { createPortalClient } from './portal-client.ts'

const externalId = z.string().regex(/^[1-9]\d{0,18}$/).refine(value => BigInt(value) <= BigInt('9223372036854775807'))
const surveyItem = z.object({ kind: z.literal('survey'), itemSubmissionId: z.string().min(1),
  answers: answersSchema, survey: z.object({ id: z.string(), kind: z.literal('survey'),
    surveyId: z.string(), surveyRevision: z.number().int().positive() }).passthrough(),
  definition: surveySchema }).passthrough()
const applicationMapping = z.object({ callId: z.string(), sourceSystem: z.enum(['gcs-ssc-opportunity', 'gcs-ssc-opportunity-shim']),
  foreignSystemId: externalId }).passthrough()

export const applicationNumericId = (sourceSystem: string, submissionId: string): string => {
  const digest = createHash('sha256').update(JSON.stringify([sourceSystem, submissionId])).digest('hex')
  return ((BigInt(`0x${digest.slice(0, 16)}`) % BigInt('9223372036854775807')) + BigInt(1)).toString()
}

const receiptReference = (id: string) => `portal-receipt:${id}`

/** The original export is the idempotency evidence, including every form in an application. */
export const importSurvey = async (context: GcsExtensionRouteContext, agencyId: string,
  update: PortalUpdate, submission: PortalSubmission, client: ReturnType<typeof createPortalClient>,
  sourceSystem: string): Promise<{ kind: 'funding_application' | 'other_form'; entityId: string }> => {
  const parsedItem = surveyItem.safeParse(submission.items.find(candidate => candidate.itemSubmissionId === update.itemSubmissionId))
  if (!parsedItem.success) throw new PortalImportDiagnostic('importMalformedSubmission')
  const item = parsedItem.data
  if (submission.submissionId !== update.submissionId) throw new PortalImportDiagnostic('importMalformedSubmission')
  const application = submission.application === null || submission.application === undefined
    ? null : applicationMapping.safeParse(submission.application)
  if (application && !application.success) throw new PortalImportDiagnostic('importOpportunityMapping')
  const mapping = application?.success ? application.data : null
  const kind = mapping ? 'funding_application' : 'other_form'
  // The authenticated export endpoint checks the owning agency and returns immutable submitted evidence.
  // Never compare it to a mutable current set publication, which may have been withdrawn or revised.
  if (Object.keys(validateSurveyAnswers(item.definition, item.answers, 'submit').errors).length)
    throw new PortalImportDiagnostic('importInvalidAnswers')
  if (!mapping && submission.sourceSystem !== 'gcs-ssc-form')
    throw new PortalImportDiagnostic('importUnsupportedSource')
  return authorizedWrite(context, async transaction => {
    const identity = await transaction.selectFrom('extensions.gcs_portal_identity').select('proponent_id')
      .where('agency_id', '=', agencyId).where('portal_organization_id', '=', submission.organizationId).executeTakeFirst()
    if (!identity) throw new PortalImportDiagnostic('importUnverifiedOrganization')
    const existing = await transaction.selectFrom('extensions.gcs_portal_receipt').selectAll()
      .where('agency_id', '=', agencyId).where('item_submission_id', '=', item.itemSubmissionId).forUpdate().executeTakeFirst()
    if (existing && (existing.event_id !== update.eventId || existing.submission_id !== submission.submissionId
      || !isDeepStrictEqual(existing.source_export, submission)))
      throw new PortalImportDiagnostic('importEvidenceConflict')
    if (existing?.state === 'imported' && existing.gcs_entity_type === 'fundingcaseintake' && existing.gcs_entity_id)
      return { kind, entityId: String(existing.gcs_entity_id) }
    if (existing?.state === 'received' && existing.kind === 'other_form')
      return { kind, entityId: receiptReference(String(existing.id)) }
    if (mapping) {
      const call = (await client.structure()).calls.find(candidate => candidate.id === mapping.callId)
      if (!call || call.sourceSystem !== mapping.sourceSystem || call.foreignSystemId !== mapping.foreignSystemId)
        throw new PortalImportDiagnostic('importOpportunityMapping')
    }
    let intakeId: string | null = null
    if (mapping) {
      const create = context.writeAuthorization?.createFundingCaseIntake
      if (!create) throw new PortalImportDiagnostic('importHostUnavailable')
      const config = (await sql<{ config: Record<string, unknown> }>`SELECT config FROM extensions.agency_enablement
        WHERE extension_key='gcs-ssc-portal-connector' AND agency_id=${agencyId}::bigint AND enabled=true AND _deleted=false`.execute(transaction)).rows[0]?.config
      const parsedGroup = externalId.safeParse(config?.intakeGroupId)
      if (!parsedGroup.success) throw new PortalImportDiagnostic('importMissingGroup')
      const groupId = parsedGroup.data
      // Stable positive bigint identity avoids decoding the Portal's opaque public codes.
      const applicationId = applicationNumericId(sourceSystem, submission.submissionId)
      const result = await create(transaction, { opportunityId: mapping.foreignSystemId,
        applicantRecipientId: identity.proponent_id, groupId, applicationId,
        application: JSON.parse(JSON.stringify(submission)), sourceSystem,
        sourceSubmissionId: submission.submissionId, sourceExport: JSON.parse(JSON.stringify(submission)) })
      if (result.status !== 'created' && result.status !== 'already_imported')
        throw new PortalImportDiagnostic(intakeResultDiagnostic(result.status))
      intakeId = result.intakeId
    }
    const values = { kind, state: mapping ? 'imported' as const : 'received' as const,
      gcs_entity_type: mapping ? 'fundingcaseintake' : null, gcs_entity_id: intakeId, updated_at: new Date() }
    const receipt = existing
      ? await transaction.updateTable('extensions.gcs_portal_receipt').set(values)
        .where('id', '=', String(existing.id)).returning('id').executeTakeFirstOrThrow()
      : await transaction.insertInto('extensions.gcs_portal_receipt').values({ ...values, agency_id: agencyId,
        event_id: update.eventId, submission_id: submission.submissionId, item_submission_id: item.itemSubmissionId,
        source_export: sql`${JSON.stringify(submission)}::jsonb` }).returning('id').executeTakeFirstOrThrow()
    return { kind, entityId: intakeId ?? receiptReference(String(receipt.id)) }
  })
}
