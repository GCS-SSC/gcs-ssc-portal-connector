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
    agreementId: portalCode, organizationId: portalCode }).strict(),
  z.object({ action: z.literal('publishScope'), surveyId: formCode, revision: z.number().int().positive(),
    scope: z.enum(['program', 'stream']), scopeId: portalCode }).strict(),
  z.object({ action: z.literal('publishOrganization'), surveyId: formCode, revision: z.number().int().positive(),
    organizationId: portalCode }).strict()
])
export const foreignId = (value: string) =>
  (BigInt(`0x${createHash('sha256').update(value).digest('hex').slice(0, 15)}`) + BigInt(1)).toString()

type FormAgreement = { id: string; organizationId: string; streamId: string }
type FormStream = { id: string; programId?: unknown; sourceSystem: string }
type PortalAgreement = Awaited<ReturnType<ReturnType<typeof createPortalClient>['agreements']>>['agreements'][number]
type AgreementPublication = { portal_agreement_id: string; portal_organization_id: string }
/** A Portal Agreement may be linked to a replacement organization beyond its original owner. */
export const publishedAgreementTargets = (
  agreements: PortalAgreement[], publications: AgreementPublication[], verified: Set<string>
): PortalAgreement[] => {
  const agreementsById = new Map(agreements.filter(item => item.active).map(item => [item.id, item]))
  return [...new Map(publications.flatMap(publication => {
    const agreement = agreementsById.get(publication.portal_agreement_id)
    return agreement && verified.has(publication.portal_organization_id)
      ? [[`${agreement.id}:${publication.portal_organization_id}`, {
          ...agreement, organizationId: publication.portal_organization_id
        }] as const] : []
  })).values()]
}
export const agreementTargetsForScope = (
  agreements: FormAgreement[], streams: FormStream[], scope: 'program' | 'stream', scopeId: string
) => {
  const streamIds = new Set(streams.filter((stream) => stream.sourceSystem === 'gcs-ssc'
    && (scope === 'program' ? stream.programId === scopeId : stream.id === scopeId)).map((stream) => stream.id))
  return agreements.filter((agreement) => streamIds.has(agreement.streamId))
    .map((agreement) => ({ agreementId: agreement.id, organizationId: agreement.organizationId }))
}

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
  const [surveys, structure, agreements, publications, identities] = await Promise.all([
    client.surveys(), client.structure(), client.agreements(),
    db.selectFrom('extensions.gcs_portal_publication').select([
      'gcs_agreement_id', 'portal_agreement_id', 'portal_organization_id'
    ]).where('agency_id', '=', agencyId).execute(),
    db.selectFrom('extensions.gcs_portal_identity as identity')
      .innerJoin('extensions.gcs_portal_verification as verification',
        'verification.portal_organization_id', 'identity.portal_organization_id')
      .innerJoin('extensions.gcs_portal_organization as organization', (join) => join
        .onRef('organization.agency_id', '=', 'identity.agency_id')
        .onRef('organization.portal_organization_id', '=', 'identity.portal_organization_id'))
      .select(['identity.portal_organization_id', 'identity.proponent_id', 'organization.name'])
      .where('identity.agency_id', '=', agencyId).where('verification.portal_active', '=', true)
      .where('organization.active', '=', true).execute()
  ])
  const verified = new Set(identities.map(item => item.portal_organization_id))
  const publishedAgreements = publishedAgreementTargets(agreements.agreements, publications, verified)
  return {
    surveys: surveys.surveys,
    programs: structure.programs.filter((item) => item.sourceSystem === 'gcs-ssc')
      .map((item) => ({ id: item.id, nameEn: String(item.nameEn ?? ''), nameFr: String(item.nameFr ?? '') })),
    streams: structure.streams.filter((item) => item.sourceSystem === 'gcs-ssc')
      .map((item) => ({ id: item.id, programId: String(item.programId ?? ''),
        nameEn: item.nameEn, nameFr: item.nameFr })),
    calls: structure.calls,
    organizations: identities.map((item) => ({ id: item.portal_organization_id, proponentId: item.proponent_id,
      name: item.name })),
    agreements: publishedAgreements
      .map((item) => ({ id: item.id, organizationId: item.organizationId, nameEn: item.nameEn,
        nameFr: item.nameFr, agreementNumber: item.agreementNumber, streamId: item.streamId }))
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
  const [identities, publications, agreements, structure, sets] = await Promise.all([
    db.selectFrom('extensions.gcs_portal_identity as identity')
      .innerJoin('extensions.gcs_portal_verification as verification',
        'verification.portal_organization_id', 'identity.portal_organization_id')
      .innerJoin('extensions.gcs_portal_organization as organization', (join) => join
        .onRef('organization.agency_id', '=', 'identity.agency_id')
        .onRef('organization.portal_organization_id', '=', 'identity.portal_organization_id'))
      .select('identity.portal_organization_id').where('identity.agency_id', '=', agencyId)
      .where('verification.portal_active', '=', true).where('organization.active', '=', true).execute(),
    db.selectFrom('extensions.gcs_portal_publication')
      .select(['portal_agreement_id', 'portal_organization_id']).where('agency_id', '=', agencyId).execute(),
    client.agreements(), client.structure(), client.sets()
  ])
  const verified = new Set(identities.map((identity) => identity.portal_organization_id))
  const available = publishedAgreementTargets(agreements.agreements, publications, verified)
  type Target = { agreementId: string | null; organizationId: string }
  let targets: Target[]
  if (command.action === 'publishOrganization') {
    if (!verified.has(command.organizationId)) throw new Error('Choose an active verified organization in this agency.')
    targets = [{ agreementId: null, organizationId: command.organizationId }]
  } else if (command.action === 'publishAgreement') {
    const agreement = available.find((item) => item.id === command.agreementId
      && item.organizationId === command.organizationId)
    if (!agreement) throw new Error('The Agreement and organization must be verified and synced first.')
    targets = [{ agreementId: agreement.id, organizationId: agreement.organizationId }]
  } else {
    const streams = structure.streams.filter((stream) => stream.sourceSystem === 'gcs-ssc')
    if (command.scope === 'program') {
      if (!structure.programs.some((program) => program.id === command.scopeId && program.sourceSystem === 'gcs-ssc'))
        throw new Error('Choose a GCS Program in this agency.')
      targets = agreementTargetsForScope(available, streams, 'program', command.scopeId)
    } else {
      if (!streams.some((stream) => stream.id === command.scopeId)) throw new Error('Choose a GCS Stream in this agency.')
      targets = agreementTargetsForScope(available, streams, 'stream', command.scopeId)
    }
    if (!targets.length) throw new Error('No active, verified, synced Agreements are available in this scope.')
  }
  const published: string[] = []
  for (const target of targets) {
    const sourceId = foreignId(`form-set:${command.surveyId}:${command.revision}:${target.agreementId ?? 'organization'}:${target.organizationId}`)
    const prior = sets.sets.find((item) => item.sourceSystem === 'gcs-ssc-form'
      && item.foreignSystemId === sourceId)
    if (prior?.published) { published.push(prior.id); continue }
    const created = prior ?? await client.createSet({
      agencyId: connection.portal_agency_id, organizationId: target.organizationId,
      agreementId: target.agreementId,
      nameEn: survey.definition.title.en, nameFr: survey.definition.title.fr,
      sourceSystem: 'gcs-ssc-form', foreignSystemId: sourceId,
      items: [{ id: 'form', kind: 'survey', surveyId: command.surveyId, surveyRevision: command.revision }]
    })
    await client.publishSet(created.id, created.revision)
    published.push(created.id)
  }
  return { setIds: published, published: true }
}
