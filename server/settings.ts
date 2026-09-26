import { sql } from 'kysely'
import { z } from 'zod'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { agencyIdFromContext, authorizedWrite } from './authorization.ts'
import { asConnectorDb } from './db.ts'
import { enqueueAllVerifiedAgreements } from './organizations.ts'

const inputSchema = z.object({
  portalStatusIds: z.array(z.string().regex(/^[1-9]\d{0,18}$/)).max(100),
  pullIntervalMinutes: z.union([z.literal(1), z.literal(5), z.literal(15), z.literal(30), z.literal(60), z.null()])
}).strict()

export const getSettings = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const connection = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_connection')
    .select(['portal_status_ids', 'pull_interval_minutes', 'last_pull_at', 'last_pull_error'])
    .where('agency_id', '=', agencyId).executeTakeFirst()
  const statuses = (await sql<{ id: string; name_en: string; name_fr: string }>`
    SELECT id::text, egcs_cn_name_en AS name_en, egcs_cn_name_fr AS name_fr
    FROM "Common_Status" WHERE egcs_cn_agency=${agencyId}::bigint AND _deleted=false
    ORDER BY egcs_cn_name_en
  `.execute(asConnectorDb(context.db))).rows
  return { statuses, settings: connection ? {
    portalStatusIds: connection.portal_status_ids,
    pullIntervalMinutes: connection.pull_interval_minutes,
    lastPullAt: connection.last_pull_at ? new Date(connection.last_pull_at).toISOString() : null,
    lastPullError: connection.last_pull_error
  } : null }
}

export const saveSettings = async (context: GcsExtensionRouteContext) => {
  const input = inputSchema.parse(await context.readBody())
  const agencyId = agencyIdFromContext(context)
  await authorizedWrite(context, async (transaction) => {
    const connection = await transaction.selectFrom('extensions.gcs_portal_connection')
      .select(['agency_id', 'portal_status_ids']).where('agency_id', '=', agencyId).forUpdate().executeTakeFirst()
    if (!connection) throw new Error('Connect the portal first.')
    const ids = [...new Set(input.portalStatusIds)]
    const available = (await sql<{ id: string }>`SELECT id::text FROM "Common_Status"
      WHERE egcs_cn_agency=${agencyId}::bigint AND id IN (${sql.join(ids.length ? ids.map(id => sql`${id}::bigint`) : [sql`0::bigint`])})
        AND _deleted=false`.execute(transaction)).rows
    if (available.length !== ids.length) throw new Error('One or more statuses are unavailable in this agency.')
    await transaction.updateTable('extensions.gcs_portal_connection').set({
      portal_status_ids: sql`${JSON.stringify(ids)}::jsonb`,
      pull_interval_minutes: input.pullIntervalMinutes,
      updated_at: new Date()
    }).where('agency_id', '=', agencyId).execute()
    if (JSON.stringify([...connection.portal_status_ids].sort()) !== JSON.stringify([...ids].sort())) {
      await enqueueAllVerifiedAgreements(transaction, agencyId)
      await sql`
      INSERT INTO extensions.gcs_portal_outcome_outbox (agency_id,receipt_id,status_id)
      SELECT receipt.agency_id,receipt.id,COALESCE(claim.egcs_fc_status,forecast.egcs_fc_status)
      FROM extensions.gcs_portal_receipt receipt
      LEFT JOIN "Funding_Case_Agreement_Claim" claim
        ON receipt.gcs_entity_type='fundingcaseagreementclaim' AND claim.id=receipt.gcs_entity_id
      LEFT JOIN "Funding_Case_Agreement_Forecast" forecast
        ON receipt.gcs_entity_type='fundingcaseforecast' AND forecast.id=receipt.gcs_entity_id
      WHERE receipt.agency_id=${agencyId}::bigint AND receipt.state='imported'
        AND COALESCE(claim.egcs_fc_status,forecast.egcs_fc_status) IS NOT NULL
      `.execute(transaction)
    }
  })
  return getSettings(context)
}
