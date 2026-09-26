import { sql } from 'kysely'
import { z } from 'zod'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { agencyIdFromContext, authorizedWrite } from './authorization.ts'
import { readPortalCredential } from './connection.ts'
import { asConnectorDb, type ConnectorDb } from './db.ts'
import { enqueueAgreement } from './outbox.ts'
import { createPortalClient } from './portal-client.ts'

const inputSchema = z.object({
  organizationId: z.string().regex(/^N-[A-HJKMNP-Z2-9]{5,}$/),
  proponentId: z.string().regex(/^[1-9]\d{0,18}$/)
}).strict()

const portalClient = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const connection = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_connection')
    .selectAll().where('agency_id', '=', agencyId).executeTakeFirst()
  if (!connection) throw new Error('Connect the portal first.')
  return createPortalClient({ portalUrl: connection.portal_url,
    portalAgencyId: connection.portal_agency_id,
    key: await readPortalCredential(context, agencyId) })
}

export const listOrganizations = async (context: GcsExtensionRouteContext) =>
  (await portalClient(context)).organizations()

export const verifyOrganization = async (context: GcsExtensionRouteContext) => {
  const input = inputSchema.parse(await context.readBody())
  const agencyId = agencyIdFromContext(context)
  const db = asConnectorDb(context.db)
  const proponent = (await sql<{ id: string }>`
    SELECT id::text FROM "Applicant_Recipient_Profile"
    WHERE id=${input.proponentId}::bigint AND _deleted=false
      AND egcs_ar_leadagency=${agencyId}::bigint
  `.execute(db)).rows[0]
  if (!proponent) throw new Error('The selected recipient does not belong to this agency.')
  const client = await portalClient(context)
  await authorizedWrite(context, async (transaction) => {
    const existing = await transaction.selectFrom('extensions.gcs_portal_identity')
      .select('proponent_id').where('agency_id', '=', agencyId)
      .where('portal_organization_id', '=', input.organizationId).forUpdate().executeTakeFirst()
    if (existing && existing.proponent_id !== input.proponentId)
      throw new Error('This organization is already linked to another recipient.')
    const other = await transaction.selectFrom('extensions.gcs_portal_identity')
      .select('portal_organization_id').where('agency_id', '=', agencyId)
      .where('proponent_id', '=', input.proponentId).executeTakeFirst()
    if (other && other.portal_organization_id !== input.organizationId)
      throw new Error('This recipient is already linked to another portal organization.')
  })
  await client.verifyOrganization(input.organizationId, input.proponentId)
  let queued = 0
  await authorizedWrite(context, async (transaction) => {
    await transaction.insertInto('extensions.gcs_portal_identity').values({
      agency_id: agencyId, portal_organization_id: input.organizationId, proponent_id: input.proponentId
    }).onConflict((conflict) => conflict.columns(['agency_id', 'portal_organization_id']).doNothing()).execute()
    const agreements = (await sql<{ id: string }>`
      SELECT agreement.id::text FROM "Funding_Case_Agreement_Profile" agreement
      JOIN "Funding_Case_Agreement_Applicant_Recipient" recipient
        ON recipient.egcs_fc_fundingagreement=agreement.id AND recipient._deleted=false
      JOIN "Transfer_Payment_Stream" stream ON stream.id=agreement.egcs_fc_transferpaymentstream
      JOIN "Transfer_Payment_Profile" program ON program.id=stream.egcs_tp_transferpaymentprofile
      WHERE program.egcs_tp_agency=${agencyId}::bigint
        AND recipient.egcs_fc_applicantrecipient=${input.proponentId}::bigint
        AND agreement._deleted=false AND stream._deleted=false AND program._deleted=false
    `.execute(transaction)).rows
    for (const agreement of agreements) {
      await enqueueAgreement(transaction, agencyId, agreement.id, input.organizationId, input.proponentId)
      queued++
    }
  })
  return { verified: true, queued }
}

export const enqueueAllVerifiedAgreements = async (transaction: ConnectorDb, agencyId: string) => {
    const result = await sql<{ count: string }>`
      WITH queued AS (
        INSERT INTO extensions.gcs_portal_outbox
          (agency_id, agreement_id, portal_organization_id, proponent_id)
        SELECT identity.agency_id, agreement.id, identity.portal_organization_id, identity.proponent_id
        FROM extensions.gcs_portal_identity identity
        JOIN "Funding_Case_Agreement_Applicant_Recipient" recipient
          ON recipient.egcs_fc_applicantrecipient=identity.proponent_id AND recipient._deleted=false
        JOIN "Funding_Case_Agreement_Profile" agreement
          ON agreement.id=recipient.egcs_fc_fundingagreement AND agreement._deleted=false
        JOIN "Transfer_Payment_Stream" stream ON stream.id=agreement.egcs_fc_transferpaymentstream
        JOIN "Transfer_Payment_Profile" program ON program.id=stream.egcs_tp_transferpaymentprofile
        WHERE identity.agency_id=${agencyId}::bigint AND program.egcs_tp_agency=identity.agency_id
          AND stream._deleted=false AND program._deleted=false
        RETURNING id
      ) SELECT count(*)::text AS count FROM queued
    `.execute(transaction)
    return { queued: Number(result.rows[0]?.count ?? 0) }
}

export const enqueueInitialSync = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  return authorizedWrite(context, async (transaction) => {
    return enqueueAllVerifiedAgreements(transaction, agencyId)
  })
}
