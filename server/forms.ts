import { createHash } from 'node:crypto'
import { z } from 'zod'
import { surveyV3Schema } from '@gcs-ssc/survey'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { agencyIdFromContext, authorizedWrite } from './authorization.ts'
import { readPortalCredentialFromDb } from './connection.ts'
import { asConnectorDb } from './db.ts'
import { createPortalClient } from './portal-client.ts'

const formCode = z.string().regex(/^V-[A-HJKMNP-Z2-9]{5,}$/)
const portalCode = z.string().regex(/^[A-Z]-[A-HJKMNP-Z2-9]{5,}$/)
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), surveyId: formCode.optional(), expectedRevision: z.number().int().positive().optional(),
    definition: surveyV3Schema }).strict(),
  z.object({ action: z.literal('publishCall'), surveyId: formCode, revision: z.number().int().positive(),
    streamId: portalCode, startDate: z.iso.date(), endDate: z.iso.date() }).strict(),
  z.object({ action: z.literal('publishAgreement'), surveyId: formCode, revision: z.number().int().positive(),
    agreementId: portalCode, organizationId: portalCode }).strict()
])
export const foreignId = (value: string) =>
  (BigInt(`0x${createHash('sha256').update(value).digest('hex').slice(0, 15)}`) + BigInt(1)).toString()

const clientForAgency = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const db = asConnectorDb(context.db)
  const connection = await db.selectFrom('extensions.gcs_portal_connection').selectAll()
    .where('agency_id', '=', agencyId).executeTakeFirst()
  if (!connection) throw new Error('Connect the portal before managing forms.')
  return { agencyId, connection, client: createPortalClient({
    portalUrl: connection.portal_url, portalAgencyId: connection.portal_agency_id,
    key: await readPortalCredentialFromDb(db, agencyId)
  }) }
}

export const listForms = async (context: GcsExtensionRouteContext) => {
  const { agencyId, client } = await clientForAgency(context)
  const db = asConnectorDb(context.db)
  const [surveys, structure, agreements, publications] = await Promise.all([
    client.surveys(), client.structure(), client.agreements(),
    db.selectFrom('extensions.gcs_portal_publication').select([
      'gcs_agreement_id', 'portal_agreement_id', 'portal_organization_id'
    ]).where('agency_id', '=', agencyId).execute()
  ])
  return {
    surveys: surveys.surveys,
    streams: structure.streams.filter((item) => item.sourceSystem === 'gcs-ssc'),
    calls: structure.calls,
    agreements: agreements.agreements.filter((item) => publications.some((publication) =>
      publication.portal_agreement_id === item.id && publication.portal_organization_id === item.organizationId))
      .map((item) => ({ id: item.id, organizationId: item.organizationId, nameEn: item.nameEn,
        nameFr: item.nameFr, agreementNumber: item.agreementNumber }))
  }
}

export const getForm = async (context: GcsExtensionRouteContext) => {
  const { client } = await clientForAgency(context)
  const id = formCode.parse(context.params.formId)
  return { survey: await client.survey(id) }
}

export const manageForm = async (context: GcsExtensionRouteContext) => {
  const command = input.parse(await context.readBody())
  const { agencyId, connection, client } = await clientForAgency(context)
  await authorizedWrite(context, async () => undefined)
  if (command.action === 'save') {
    if (Boolean(command.surveyId) !== Boolean(command.expectedRevision))
      throw new Error('An existing form needs its current revision.')
    const survey = command.surveyId
      ? await client.updateSurvey(command.surveyId, command.expectedRevision!, command.definition)
      : await client.createSurvey(command.definition)
    return { survey }
  }
  const survey = await client.survey(command.surveyId)
  if (survey.revision !== command.revision) throw new Error('Save or reload the latest form revision before publishing.')
  if (command.action === 'publishCall') {
    if (command.endDate < command.startDate) throw new Error('The closing date cannot precede the opening date.')
    const structure = await client.structure()
    if (!structure.streams.some((stream) => stream.id === command.streamId && stream.sourceSystem === 'gcs-ssc'))
      throw new Error('Choose a GCS stream in this agency.')
    const sourceId = foreignId(`form-call:${command.surveyId}:${command.revision}`)
    const prior = structure.calls.find((call) => call.sourceSystem === 'gcs-ssc-opportunity-shim'
      && call.foreignSystemId === sourceId)
    if (prior?.published && prior.surveyId === command.surveyId && prior.surveyRevision === command.revision)
      return { callId: prior.id, published: true }
    if (prior?.published) throw new Error('The published funding call cannot be changed.')
    const callId = prior?.id ?? await client.createCall({
      streamId: command.streamId, nameEn: survey.definition.title.en, nameFr: survey.definition.title.fr,
      startDate: command.startDate, endDate: command.endDate,
      sourceSystem: 'gcs-ssc-opportunity-shim', foreignSystemId: sourceId
    })
    await client.attachCallSurvey(callId, command.surveyId, command.revision)
    await client.publishCall(callId)
    return { callId, published: true }
  }
  const db = asConnectorDb(context.db)
  const identity = await db.selectFrom('extensions.gcs_portal_identity').select('portal_organization_id')
    .where('agency_id', '=', agencyId).where('portal_organization_id', '=', command.organizationId)
    .executeTakeFirst()
  const publication = await db.selectFrom('extensions.gcs_portal_publication').select('gcs_agreement_id')
    .where('agency_id', '=', agencyId).where('portal_agreement_id', '=', command.agreementId)
    .where('portal_organization_id', '=', command.organizationId).executeTakeFirst()
  if (!identity || !publication) throw new Error('The Agreement and organization must be verified and synced first.')
  const agreements = await client.agreements()
  if (!agreements.agreements.some((item) => item.id === command.agreementId
    && item.organizationId === command.organizationId && item.active))
    throw new Error('The portal Agreement is not available to this organization.')
  const sourceId = foreignId(`form-set:${command.surveyId}:${command.revision}:${command.agreementId}:${command.organizationId}`)
  const sets = await client.sets()
  const prior = sets.sets.find((item) => item.sourceSystem === 'gcs-ssc-form'
    && item.foreignSystemId === sourceId)
  if (prior?.published) return { setId: prior.id, published: true }
  const created = prior ?? await client.createSet({
    agencyId: connection.portal_agency_id, organizationId: command.organizationId,
    agreementId: command.agreementId,
    nameEn: survey.definition.title.en, nameFr: survey.definition.title.fr,
    sourceSystem: 'gcs-ssc-form', foreignSystemId: sourceId,
    items: [{ id: 'form', kind: 'survey', surveyId: command.surveyId, surveyRevision: command.revision }]
  })
  await client.publishSet(created.id, created.revision)
  return { setId: created.id, published: true }
}
