import { sql } from 'kysely'
import { readPortalCredentialFromDb } from './connection.ts'
import { asConnectorDb, type ConnectorDb } from './db.ts'
import { enabledPortalAgency } from './enablement.ts'
import { retryDelaySeconds } from './retry.ts'
import { queuePortalClient } from './operations.ts'

interface LeasedOutcome { id: string; agency_id: string; receipt_id: string; attempts: number }
interface OutcomeSource {
  submission_id: string
  item_submission_id: string
  gcs_entity_id: string
  gcs_entity_type: string
  portal_url: string
  portal_agency_id: string
  entity_status_ids: { claim: string[]; forecast: string[]; funding_application: string[]; other_form: string[] }
  status_id: string | null
  status_en: string | null
  status_fr: string | null
  status_colour: string | null
}

export const drainOutcomeOutbox = async (db: ConnectorDb, limit: number, agencyId?: string) => {
  const results: Array<{ id: string; delivered: boolean; error?: string }> = []
  for (let index = 0; index < limit; index++) {
    const row = (await sql<LeasedOutcome>`
      UPDATE extensions.gcs_portal_outcome_outbox SET state='leased', attempts=attempts+1,
        next_attempt_at=now()+interval '2 minutes', updated_at=now()
      WHERE id=(SELECT id FROM extensions.gcs_portal_outcome_outbox
        WHERE state <> 'delivered' AND next_attempt_at <= now()
          AND ${enabledPortalAgency('extensions.gcs_portal_outcome_outbox.agency_id')}
          AND (${agencyId ?? null}::bigint IS NULL OR agency_id=${agencyId ?? null}::bigint)
        ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id::text,agency_id::text,receipt_id::text,attempts
    `.execute(db)).rows[0]
    if (!row) break
    try {
      const source = (await sql<OutcomeSource>`
        SELECT receipt.submission_id,receipt.item_submission_id,
          receipt.gcs_entity_id::text,receipt.gcs_entity_type,
          connection.portal_url,connection.portal_agency_id,connection.entity_status_ids,
          status.id::text AS status_id,status.egcs_cn_name_en AS status_en,
          status.egcs_cn_name_fr AS status_fr,status.egcs_cn_color AS status_colour
        FROM extensions.gcs_portal_receipt receipt
        JOIN extensions.gcs_portal_connection connection ON connection.agency_id=receipt.agency_id
        LEFT JOIN "Funding_Case_Agreement_Claim" claim
          ON receipt.gcs_entity_type='fundingcaseagreementclaim' AND claim.id=receipt.gcs_entity_id
        LEFT JOIN "Funding_Case_Agreement_Forecast" forecast
          ON receipt.gcs_entity_type='fundingcaseforecast' AND forecast.id=receipt.gcs_entity_id
        LEFT JOIN "Funding_Case_Intake_Profile" intake
          ON receipt.gcs_entity_type='fundingcaseintake' AND intake.id=receipt.gcs_entity_id
        LEFT JOIN "Common_Status" status
          ON status.id=COALESCE(claim.egcs_fc_status,forecast.egcs_fc_status,intake.egcs_fi_status) AND status._deleted=false
        WHERE receipt.id=${row.receipt_id}::bigint AND receipt.state='imported'
      `.execute(db)).rows[0]
      if (!source?.gcs_entity_id) throw new Error('The imported GCS item is unavailable.')
      const selectedIds = source.gcs_entity_type === 'fundingcaseagreementclaim'
        ? source.entity_status_ids.claim : source.gcs_entity_type === 'fundingcaseintake'
          ? source.entity_status_ids.funding_application : source.entity_status_ids.forecast
      const visible = source.status_id && selectedIds.includes(source.status_id)
        && source.status_en && source.status_fr && source.status_colour
        && /^#[0-9a-fA-F]{6}$/.test(source.status_colour)
      const status = visible ? { en: source.status_en!, fr: source.status_fr!, colour: source.status_colour! } : null
      const client = queuePortalClient(db, row.agency_id, { portalUrl: source.portal_url,
        portalAgencyId: source.portal_agency_id,
        key: await readPortalCredentialFromDb(asConnectorDb(db), row.agency_id) })
      await client.publishItemStatus(source.submission_id, source.item_submission_id,
        source.gcs_entity_id, status)
      await sql`UPDATE extensions.gcs_portal_outcome_outbox SET state='delivered', delivered_at=now(),
        updated_at=now(),last_error=NULL WHERE id=${row.id}::bigint
        AND state='leased' AND attempts=${row.attempts}`.execute(db)
      results.push({ id: row.id, delivered: true })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Outcome delivery failed'
      const seconds = retryDelaySeconds(row.attempts)
      await sql`UPDATE extensions.gcs_portal_outcome_outbox SET state='pending',last_error=${message},
        next_attempt_at=now()+(${seconds} || ' seconds')::interval,updated_at=now()
        WHERE id=${row.id}::bigint AND state='leased' AND attempts=${row.attempts}`.execute(db)
      results.push({ id: row.id, delivered: false, error: message })
    }
    if (index < limit - 1) await new Promise(resolve => setTimeout(resolve, 500))
  }
  return { results }
}
