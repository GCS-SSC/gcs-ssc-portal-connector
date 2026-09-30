import { z } from 'zod'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { authorizedWrite } from './authorization.ts'
import { clientForAgency } from './portal-context.ts'
import { formPublicationIssues } from './form-readiness.ts'
import { upgradeToAdvancedSurvey } from '@gcs-ssc/survey'
import { designerSurveySchema } from '@gcs-ssc/survey'

const portalCode = z.string().regex(/^V-[A-HJKMNP-Z2-9]{5,}$/)
const isOpportunityCall = (call: { sourceSystem: string; foreignSystemId: string | null }, opportunityId: string) =>
  (call.sourceSystem === 'gcs-ssc-opportunity' || call.sourceSystem === 'gcs-ssc-opportunity-shim')
  && call.foreignSystemId === opportunityId
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveForms'), forms: z.array(z.object({
    surveyId: portalCode, revision: z.number().int().positive()
  }).strict()).max(10) }).strict(),
  z.object({ action: z.literal('publish') }).strict(),
  z.object({ action: z.literal('withdraw') }).strict(),
  z.object({ action: z.literal('saveForm'), surveyId: portalCode.optional(),
    expectedRevision: z.number().int().positive().optional(), definition: designerSurveySchema }).strict()
])

const callForOpportunity = async (context: GcsExtensionRouteContext) => {
  const opportunityId = z.string().regex(/^[1-9]\d{0,18}$/).parse(context.params.opportunityId)
  if (context.entity?.agencyId !== context.params.agencyId || context.entity?.ownerId !== opportunityId)
    throw new Error('Opportunity is unavailable in this agency.')
  const { client } = await clientForAgency(context)
  const call = (await client.structure()).calls.find(item => isOpportunityCall(item, opportunityId))
  return { client, call }
}

export const listOpportunityForms = async (context: GcsExtensionRouteContext) => {
  const { client, call } = await callForOpportunity(context)
  const summaries = call?.forms.length ? (await client.surveys()).surveys : []
  const canWrite = Boolean(context.auth?.userAbilities.authorize('transfer_payment', 'update',
    context.entity?.scope as { type: 'entity'; agencyId: string; path: Array<{ type: 'transfer_payment'; id: string }> }))
  return { callId: call?.id ?? null, published: call?.published ?? false, canWrite,
    forms: call?.forms.map(form => ({ ...form,
      title: summaries.find(summary => summary.id === form.surveyId)?.title ?? { en: form.surveyId, fr: form.surveyId }
    })) ?? [], surveys: summaries.filter(summary => call?.forms.some(form => form.surveyId === summary.id)) }
}

export const getOpportunityForm = async (context: GcsExtensionRouteContext) => {
  const formId = portalCode.parse(context.params.formId)
  const { client, call } = await callForOpportunity(context)
  if (!call?.forms.some(form => form.surveyId === formId)) throw new Error('Form is not attached to this opportunity.')
  return { survey: await client.survey(formId) }
}

/** Opportunity identity is the GCS ID; Portal calls retain an independent public ID. */
export const manageOpportunity = async (context: GcsExtensionRouteContext) => {
  const command = commandSchema.parse(await context.readBody())
  const opportunityId = z.string().regex(/^[1-9]\d{0,18}$/).parse(context.params.opportunityId)
  const projection = await authorizedWrite(context, async transaction => {
    const project = context.writeAuthorization?.projectFundingOpportunity
    if (!project) throw new Error('Opportunity publication is unavailable in this GCS version.')
    return await project(transaction, opportunityId)
  })
  if (!projection || context.entity?.ownerId !== opportunityId)
    throw new Error('Opportunity is unavailable in this Program.')
  if (projection.agency.id !== context.params.agencyId)
    throw new Error('Opportunity is unavailable in this agency.')
  if (command.action === 'publish' && !projection.active)
    throw new Error('Activate the Funding Opportunity before publishing it to the portal.')
  if ((command.action === 'saveForms' || command.action === 'saveForm') && !projection.editable)
    throw new Error('This Funding Opportunity is locked for editing.')
  const { connection, client } = await clientForAgency(context)
  let structure = await client.structure()
  let call = structure.calls.find(item => isOpportunityCall(item, opportunityId))
  if (command.action === 'withdraw') {
    if (call?.published) await client.withdrawCall(call.id)
    return { callId: call?.id ?? null, published: false }
  }
  const portalProgramId = structure.programs.find(program => program.sourceSystem === 'gcs-ssc'
    && program.foreignSystemId === projection.program.id)?.id ?? await client.createProgram({
    agencyId: connection.portal_agency_id, nameEn: projection.program.nameEn, nameFr: projection.program.nameFr,
    sourceSystem: 'gcs-ssc', foreignSystemId: projection.program.id
  })
  const portalStreamId = structure.streams.find(stream => stream.sourceSystem === 'gcs-ssc'
    && stream.foreignSystemId === projection.stream.id)?.id ?? await client.createStream({
    programId: portalProgramId, nameEn: projection.stream.nameEn, nameFr: projection.stream.nameFr,
    sourceSystem: 'gcs-ssc', foreignSystemId: projection.stream.id
  })
  if (command.action === 'saveForms' && new Set(command.forms.map(form => form.surveyId)).size !== command.forms.length)
    throw new Error('Each form can appear only once in an opportunity.')
  if (command.action === 'saveForms' && command.forms.some(form => !call?.forms.some(attached => attached.surveyId === form.surveyId)))
    throw new Error('Only forms already attached to this opportunity can be reordered.')
  if (call?.published && (command.action === 'saveForms' || command.action === 'saveForm'))
    throw new Error('Withdraw the opportunity before changing its forms.')
  const metadata = {
    streamId: portalStreamId, nameEn: projection.nameEn, nameFr: projection.nameFr,
    startDate: projection.startDate, endDate: projection.endDate,
    sourceSystem: call?.sourceSystem ?? 'gcs-ssc-opportunity', foreignSystemId: opportunityId
  }
  if (!call) {
    const id = await client.createCall(metadata)
    structure = await client.structure()
    call = structure.calls.find(item => item.id === id)
    if (!call) throw new Error('The new portal opportunity could not be read back.')
  } else if (!call.published) {
    if (call.streamId !== portalStreamId) throw new Error('The opportunity changed Streams after portal creation.')
    await client.updateCall(call.id, call.revision, metadata)
  }
  if (command.action === 'saveForms') {
    for (const form of command.forms) {
      const survey = await client.survey(form.surveyId)
      if (survey.revision !== form.revision) throw new Error('Save or reload the latest form revision first.')
    }
    await client.attachCallForms(call.id, command.forms)
    return { callId: call.id, forms: command.forms, published: false }
  }
  if (command.action === 'saveForm') {
    if (Boolean(command.surveyId) !== Boolean(command.expectedRevision))
      throw new Error('The saved form revision is required when editing.')
    if (command.surveyId && !call.forms.some(form => form.surveyId === command.surveyId))
      throw new Error('Form is not attached to this opportunity.')
    if (!command.surveyId && call.forms.length >= 10)
      throw new Error('An opportunity may have at most ten forms.')
    const survey = command.surveyId
      ? await client.updateSurvey(command.surveyId, command.expectedRevision!, command.definition)
      : await client.createSurvey(command.definition)
    const forms = (await client.structure()).calls.find(item => item.id === call.id)?.forms ?? []
    const next = command.surveyId
      ? forms.map(form => form.surveyId === survey.id ? { surveyId: survey.id, revision: survey.revision } : form)
      : [...forms, { surveyId: survey.id, revision: survey.revision }]
    if (next.length > 10) throw new Error('An opportunity may have at most ten forms.')
    await client.attachCallForms(call.id, next)
    return { survey, attached: true }
  }
  if (call.published) return { callId: call.id, published: true }
  const current = (await client.structure()).calls.find(item => item.id === call.id)
  if (!current?.forms.length) throw new Error('Attach at least one form before publishing.')
  for (const form of current.forms) {
    const survey = await client.survey(form.surveyId)
    if (survey.revision !== form.revision) throw new Error('Save or reload the latest form revision first.')
    const issues = formPublicationIssues(upgradeToAdvancedSurvey(survey.definition))
    if (issues.length) throw new Error(`Complete the English and French form content: ${issues.join(', ')}.`)
  }
  await client.publishCall(call.id)
  return { callId: call.id, published: true }
}
