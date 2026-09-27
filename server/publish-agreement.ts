import { createHash } from 'node:crypto'
import { sql } from 'kysely'
import { z } from 'zod'
import { defineGcsExtensionRouteHandler, type GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { projectAgreement } from './agreement-projection.ts'
import { agencyIdFromContext, authorizedWrite } from './authorization.ts'
import { readPortalCredentialFromDb } from './connection.ts'
import { asConnectorDb, type ConnectorDb } from './db.ts'
import { createPortalClient } from './portal-client.ts'

const publicationInput = z.object({
  agreementId: z.string().regex(/^[1-9]\d{0,18}$/),
  proponentId: z.string().regex(/^[1-9]\d{0,18}$/),
  portalOrganizationId: z.string().regex(/^N-[A-HJKMNP-Z2-9]{5,}$/)
}).strict()

const stable = (value: unknown): string => JSON.stringify(value, (_key, child: unknown) => {
  if (child && typeof child === 'object' && !Array.isArray(child))
    return Object.fromEntries(Object.entries(child).sort(([left], [right]) => left.localeCompare(right)))
  return child
})

/** Staff chooses an Agreement/recipient pair; GCS remains the source of the published budget. */
export const publishAgreement = async (context: GcsExtensionRouteContext) => {
  const input = publicationInput.parse(await context.readBody())
  const agencyId = agencyIdFromContext(context)
  await authorizedWrite(context, async (transaction) => {
    const identity = await transaction.selectFrom('extensions.gcs_portal_identity').select('proponent_id')
      .where('agency_id', '=', agencyId).where('portal_organization_id', '=', input.portalOrganizationId)
      .executeTakeFirst()
    if (!identity || identity.proponent_id !== input.proponentId)
      throw new Error('Verify the portal organization and recipient before publishing.')
    const activeLink = await transaction.selectFrom('extensions.gcs_portal_verification')
      .select('portal_organization_id').where('portal_organization_id', '=', input.portalOrganizationId)
      .where('proponent_id', '=', input.proponentId).where('portal_active', '=', true).executeTakeFirst()
    if (!activeLink) throw new Error('The linked Portal organization is inactive.')
    const agreement = await projectAgreement(transaction, agencyId, input.agreementId, input.proponentId)
    const authorizeAgreement = context.writeAuthorization?.lockAndAuthorizeAgreement
    if (!authorizeAgreement || !(await authorizeAgreement(transaction, {
      agreementId: input.agreementId, streamId: agreement.agreement.stream_id, action: 'update'
    }))) throw new Error('Agreement publication requires current assigned Contributor access.')
  })
  return publishAgreementCore(asConnectorDb(context.db), agencyId, input)
}

export const publishAgreementCore = async (
  db: ConnectorDb, agencyId: string, input: z.infer<typeof publicationInput>
) => {
  const activeLink = await db.selectFrom('extensions.gcs_portal_verification')
    .select('portal_organization_id').where('portal_organization_id', '=', input.portalOrganizationId)
    .where('proponent_id', '=', input.proponentId).where('portal_active', '=', true).executeTakeFirst()
  if (!activeLink) throw new Error('The linked Portal organization is inactive.')
  const connection = await db.selectFrom('extensions.gcs_portal_connection').selectAll()
    .where('agency_id', '=', agencyId).executeTakeFirst()
  if (!connection) throw new Error('Connect an organization portal before publishing.')
  const client = createPortalClient({
    portalUrl: connection.portal_url, portalAgencyId: connection.portal_agency_id,
    key: await readPortalCredentialFromDb(asConnectorDb(db), agencyId)
  })
  const source = await projectAgreement(db, agencyId, input.agreementId, input.proponentId)
  const { agreement, fiscalYears, lines } = source
  const structure = await client.structure()
  const programId = structure.programs.find((program) => program.sourceSystem === 'gcs-ssc'
    && program.foreignSystemId === agreement.program_id)?.id
    ?? await client.createProgram({
      agencyId: connection.portal_agency_id,
      nameEn: agreement.program_name_en, nameFr: agreement.program_name_fr,
      sourceSystem: 'gcs-ssc', foreignSystemId: agreement.program_id
    })
  const streamId = structure.streams.find((stream) => stream.sourceSystem === 'gcs-ssc'
    && stream.foreignSystemId === agreement.stream_id)?.id
    ?? await client.createStream({
      programId,
      nameEn: agreement.stream_name_en, nameFr: agreement.stream_name_fr,
      sourceSystem: 'gcs-ssc', foreignSystemId: agreement.stream_id
    })
  const candidates = await client.agreements()
  const previous = candidates.agreements.find((entry) => entry.config.sourceSystem === 'gcs-ssc'
    && entry.config.foreignSystemId === agreement.agreement_id)
  const priorLines = previous?.config.budgetLines ?? []
  const config = {
    sourceSystem: 'gcs-ssc', foreignSystemId: agreement.agreement_id,
    externalStreamId: agreement.stream_id,
    externalApplicantRecipientId: previous?.config.externalApplicantRecipientId ?? input.proponentId,
    claimInstruction: previous?.config.claimInstruction ?? null,
    forecastInstruction: previous?.config.forecastInstruction ?? null,
    fiscalYears: fiscalYears.map((year) => ({
      id: year.id, startYear: year.start_year, foreignSystemId: year.id
    })),
    budgetLines: lines.map((line) => {
      const old = priorLines.find((entry) => entry.id === line.id)
      const sameBudget = old?.budgetedAmount === line.program_funding
      return {
        nameEn: line.name_en, nameFr: line.name_fr,
        id: line.id, fiscalYearId: line.fiscal_year_id, foreignSystemId: line.id,
        costCategory: line.category_en, costSubsection: line.subsection,
        budgetedAmount: line.program_funding,
        balance: sameBudget ? old.balance ?? null : null,
        claimedAmount: sameBudget ? old.claimedAmount ?? null : null,
        forecastAmount: sameBudget ? old.forecastAmount ?? null : null,
        balanceAsOf: sameBudget ? old.balanceAsOf ?? null : null,
        currency: line.currency
      }
    })
  }
  const status = agreement.status_id && connection.portal_status_ids.includes(agreement.status_id)
    && agreement.status_name_en && agreement.status_name_fr
    && agreement.status_colour && /^#[0-9a-fA-F]{6}$/.test(agreement.status_colour)
    ? { en: agreement.status_name_en, fr: agreement.status_name_fr, colour: agreement.status_colour }
    : null
  const value = {
    organizationId: previous?.organizationId ?? input.portalOrganizationId,
    streamId,
    nameEn: agreement.title_en, nameFr: agreement.title_fr,
    agreementNumber: agreement.agreement_number,
    active: agreement.terminal !== true, status, config
  }
  let portalAgreementId: string
  let revision: number
  let agreementAction: 'created' | 'updated' | 'unchanged'
  if (previous) {
    if (previous.streamId !== streamId) throw new Error('The published Agreement has a different Stream.')
    portalAgreementId = previous.id
    const currentValue = {
      organizationId: previous.organizationId, streamId: previous.streamId,
      nameEn: previous.nameEn, nameFr: previous.nameFr,
      agreementNumber: previous.agreementNumber, active: previous.active,
      status: previous.status ?? null, config: previous.config
    }
    if (stable(currentValue) !== stable(value)) {
      const updated = z.object({ agreement: z.object({ revision: z.number().int() }) })
        .parse(await client.updateAgreement(previous.id, { expectedRevision: previous.revision, value }))
      revision = updated.agreement.revision
      agreementAction = 'updated'
    } else {
      revision = previous.revision
      agreementAction = 'unchanged'
    }
  } else {
    portalAgreementId = await client.createAgreement(value)
    revision = 1
    agreementAction = 'created'
  }
  await client.linkOrganization(portalAgreementId, {
    organizationId: input.portalOrganizationId,
    foreignApplicantRecipientId: input.proponentId
  })
  const existingSets = (await client.sets()).sets.filter((item) =>
    item.organizationId === input.portalOrganizationId && item.agreementId === portalAgreementId
    && item.sourceSystem === 'gcs-ssc-portal-connector')
  const publishedSetIds: string[] = []
  for (const year of fiscalYears) for (const kind of ['claim', 'forecast'] as const) {
    const matches = existingSets.filter((set) => set.items.some((item) =>
      item.kind === kind && item.fiscalYearId === year.id))
    const matching = matches.find((set) => set.published &&
      z.object({ agreement: z.object({ revision: z.number().int() }) }).safeParse(set.snapshot).data?.agreement.revision === revision)
    if (matching) {
      publishedSetIds.push(matching.id)
      continue
    }
    for (const old of matches.filter((set) => set.published)) await client.withdrawSet(old.id, old.revision)
    const set = await client.createSet({
      organizationId: input.portalOrganizationId,
      agencyId: connection.portal_agency_id,
      agreementId: portalAgreementId,
      nameEn: `${kind === 'claim' ? 'Claim' : 'Forecast'} ${agreement.agreement_number} ${year.start_year}`,
      nameFr: `${kind === 'claim' ? 'Réclamation' : 'Prévision'} ${agreement.agreement_number} ${year.start_year}`,
      sourceSystem: 'gcs-ssc-portal-connector', foreignSystemId: null,
      items: [{ id: `${kind}-${year.id}`, kind, fiscalYearId: year.id }]
    })
    await client.publishSet(set.id, set.revision)
    publishedSetIds.push(set.id)
  }
  const digest = createHash('sha256').update(stable({ source, organizationId: input.portalOrganizationId })).digest('hex')
  await db.transaction().execute(async (transaction) => {
    await transaction.insertInto('extensions.gcs_portal_publication').values({
      agency_id: agencyId,
      gcs_agreement_id: input.agreementId,
      portal_organization_id: input.portalOrganizationId,
      portal_agreement_id: portalAgreementId,
      portal_agreement_revision: revision,
      portal_set_ids: sql`${JSON.stringify(publishedSetIds)}::jsonb`,
      source_digest: digest
    }).onConflict((conflict) => conflict.columns([
      'agency_id', 'gcs_agreement_id', 'portal_organization_id', 'source_digest'
    ]).doNothing()).execute()
  })
  return {
    agreementId: portalAgreementId, revision, organizationId: input.portalOrganizationId, setIds: publishedSetIds,
    deliveryPayload: {
      agreementAction,
      agreement: value,
      organizationLink: { organizationId: input.portalOrganizationId, foreignApplicantRecipientId: input.proponentId },
      publishedSetIds
    }
  }
}

export const publicationRoute = defineGcsExtensionRouteHandler(publishAgreement)
