import { z } from 'zod'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { authorizedWrite } from './authorization.ts'
import { formPublicationIssues } from './form-readiness.ts'
import { foreignId } from './form-identity.ts'
import { clientForAgency } from './portal-context.ts'
import { upgradeToAdvancedSurvey } from '@gcs-ssc/survey'
import { intakeDraftSchema } from '../shared/intake.ts'
import { intakeError } from './intake-errors.ts'

const portalCode = z.string().regex(/^[A-Z]-[A-HJKMNP-Z2-9]{5,}$/)
const input = z.discriminatedUnion('action', [
  intakeDraftSchema.safeExtend({ action: z.literal('create'), requestKey: z.uuid() }).strict(),
  intakeDraftSchema.safeExtend({ action: z.literal('update'), intakeId: portalCode }).strict(),
  z.object({ action: z.literal('publish'), intakeId: portalCode }).strict(),
  z.object({ action: z.literal('withdraw'), intakeId: portalCode }).strict(),
  z.object({ action: z.literal('delete'), intakeId: portalCode }).strict()
])

type Structure = Awaited<ReturnType<Awaited<ReturnType<typeof clientForAgency>>['client']['structure']>>
export const isIntakeCall = (call: Structure['calls'][number]) =>
  call.sourceSystem === 'gcs-ssc-intake' || call.sourceSystem === 'gcs-ssc-opportunity-shim'

export const requireIntakeCall = (structure: Structure, id: string) => {
  const call = structure.calls.find((item) => item.id === id && isIntakeCall(item))
  if (!call || !structure.streams.some((stream) => stream.id === call.streamId && stream.sourceSystem === 'gcs-ssc'))
    throw intakeError('intakeUnavailable', 404)
  return call
}

export const listIntakes = async (context: GcsExtensionRouteContext) => {
  const { client } = await clientForAgency(context)
  const structure = await client.structure()
  return {
    intakes: structure.calls.filter((call) => isIntakeCall(call)
      && structure.streams.some((stream) => stream.id === call.streamId && stream.sourceSystem === 'gcs-ssc')),
    streams: structure.streams.filter((stream) => stream.sourceSystem === 'gcs-ssc')
  }
}

export const manageIntake = async (context: GcsExtensionRouteContext) => {
  const parsed = input.safeParse(await context.readBody())
  if (!parsed.success) throw intakeError('intakeInvalidInput', 400)
  const command = parsed.data
  const { agencyId, client } = await clientForAgency(context)
  await authorizedWrite(context, async () => undefined)
  const structure = await client.structure()
  if (command.action === 'create' || command.action === 'update') {
    if (!structure.streams.some((stream) => stream.id === command.streamId && stream.sourceSystem === 'gcs-ssc'))
      throw intakeError('intakeInvalidStream', 400)
    const data = { streamId: command.streamId, nameEn: command.nameEn, nameFr: command.nameFr,
      startDate: command.startDate, endDate: command.endDate }
    if (command.action === 'create') {
      const sourceId = foreignId(`intake:${agencyId}:${command.requestKey}`)
      const prior = structure.calls.find((call) => call.sourceSystem === 'gcs-ssc-intake'
        && call.foreignSystemId === sourceId)
      if (prior) {
        if (prior.streamId !== command.streamId) throw intakeError('intakeOtherStream')
        return { intakeId: prior.id }
      }
      const intakeId = await client.createCall({ ...data, sourceSystem: 'gcs-ssc-intake', foreignSystemId: sourceId })
      return { intakeId }
    }
    const call = requireIntakeCall(structure, command.intakeId)
    if (call.published) throw intakeError('intakeWithdrawToEdit')
    if (call.streamId !== command.streamId) throw intakeError('intakeStreamImmutable')
    await client.updateCall(call.id, { ...data, sourceSystem: call.sourceSystem, foreignSystemId: call.foreignSystemId })
    return { intakeId: call.id }
  }
  const call = requireIntakeCall(structure, command.intakeId)
  if (command.action === 'publish') {
    if (call.published) return { intakeId: call.id, published: true }
    if (!call.surveyId || !call.surveyRevision) throw intakeError('intakeSaveFormFirst', 422)
    const survey = await client.survey(call.surveyId)
    if (survey.revision !== call.surveyRevision) throw intakeError('intakeLatestForm', 422)
    const issues = formPublicationIssues(upgradeToAdvancedSurvey(survey.definition))
    if (issues.length) throw intakeError('intakeTranslationsIncomplete', 422)
    await client.publishCall(call.id)
    return { intakeId: call.id, published: true }
  }
  if (call.published && command.action === 'withdraw') {
    await client.withdrawCall(call.id)
    return { intakeId: call.id, published: false }
  }
  if (command.action === 'withdraw') return { intakeId: call.id, published: false }
  if (call.published) throw intakeError('intakeWithdrawToDelete')
  await client.deleteCall(call.id)
  return { intakeId: call.id, deleted: true }
}
