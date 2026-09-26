import { sql } from 'kysely'
import { readPortalCredentialFromDb } from './connection.ts'
import { asConnectorDb, type ConnectorDb } from './db.ts'
import { createPortalClient } from './portal-client.ts'

interface DueConnection { agency_id: string; portal_agency_id: string; portal_url: string }

/** Poll only agencies whose configured interval has elapsed; no portal event is consumed here. */
export const pullDueAgencies = async (db: ConnectorDb) => {
  const results: Array<{ agencyId: string; found: number; error?: string }> = []
  for (let index = 0; index < 20; index++) {
    const connection = (await sql<DueConnection>`
      UPDATE extensions.gcs_portal_connection SET last_pull_at=now(), last_pull_error=NULL,
        pull_lease_until=now() + interval '10 minutes'
      WHERE agency_id=(
        SELECT agency_id FROM extensions.gcs_portal_connection
        WHERE pull_interval_minutes IS NOT NULL AND
          (pull_lease_until IS NULL OR pull_lease_until <= now()) AND (
          last_pull_at IS NULL OR last_pull_at <= now() - (pull_interval_minutes || ' minutes')::interval
        ) ORDER BY last_pull_at NULLS FIRST, agency_id FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING agency_id::text, portal_agency_id, portal_url
    `.execute(db)).rows[0]
    if (!connection) break
    try {
      const client = createPortalClient({
        portalUrl: connection.portal_url, portalAgencyId: connection.portal_agency_id,
        key: await readPortalCredentialFromDb(asConnectorDb(db), connection.agency_id)
      })
      let after: string | undefined
      let found = 0
      for (let page = 0; page < 4; page++) {
        const batch = await client.updates(after)
        for (const event of batch.updates) {
          await db.insertInto('extensions.gcs_portal_inbox').values({
            agency_id: connection.agency_id, event_id: event.eventId,
            kind: event.kind, submission_id: event.submissionId,
            item_submission_id: event.itemSubmissionId,
            created_at: new Date(event.createdAt)
          }).onConflict((conflict) => conflict.columns(['agency_id', 'event_id']).doNothing()).execute()
          found++
        }
        if (!batch.nextCursor) break
        after = batch.nextCursor
      }
      results.push({ agencyId: connection.agency_id, found })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Portal pull failed'
      await db.updateTable('extensions.gcs_portal_connection').set({ last_pull_error: message, pull_lease_until: null })
        .where('agency_id', '=', connection.agency_id).execute()
      results.push({ agencyId: connection.agency_id, found: 0, error: message })
    }
  }
  return { results }
}

export const releasePullLease = async (db: ConnectorDb, agencyId: string) => {
  await db.updateTable('extensions.gcs_portal_connection').set({ pull_lease_until: null })
    .where('agency_id', '=', agencyId).execute()
}
