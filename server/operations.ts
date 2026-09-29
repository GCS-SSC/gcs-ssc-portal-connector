import { sql } from 'kysely'
import { surveyV3Schema } from '@gcs-ssc/survey'
import { readPortalCredentialFromDb } from './connection.ts'
import { asConnectorDb, type ConnectorDb } from './db.ts'
import { enabledPortalAgency } from './enablement.ts'
import { createPortalClient, portalRequest, type PortalConnection, type PortalMethod } from './portal-client.ts'
import { retryDelaySeconds } from './retry.ts'

type Operation = {
  id: string; agency_id: string; kind: 'request' | 'form'; method: PortalMethod | null
  path: string | null; body: unknown; form_id: string | null; attempts: number
}

const connectionFor = async (db: ConnectorDb, agencyId: string): Promise<PortalConnection> => {
  const row = await db.selectFrom('extensions.gcs_portal_connection').select(['portal_url', 'portal_agency_id'])
    .where('agency_id', '=', agencyId).executeTakeFirst()
  if (!row) throw new Error('Save a Portal connection to deliver this queued change.')
  return { portalUrl: row.portal_url, portalAgencyId: row.portal_agency_id,
    key: await readPortalCredentialFromDb(asConnectorDb(db), agencyId) }
}

const deliverForm = async (db: ConnectorDb, operation: Operation, connection: PortalConnection) => {
  const form = await db.selectFrom('extensions.gcs_portal_form').selectAll()
    .where('agency_id', '=', operation.agency_id).where('id', '=', operation.form_id!).executeTakeFirstOrThrow()
  const definition = surveyV3Schema.parse(form.definition)
  const client = createPortalClient(connection)
  const survey = form.portal_id
    ? form.revision > (form.portal_revision ?? 0)
      ? await client.updateSurvey(form.portal_id, form.portal_revision!, definition)
      : { id: form.portal_id, revision: form.portal_revision! }
    : await client.createSurvey(definition)
  let update = db.updateTable('extensions.gcs_portal_form').set({ portal_id: survey.id, portal_revision: survey.revision })
    .where('agency_id', '=', operation.agency_id).where('id', '=', form.id)
  update = form.portal_revision === null
    ? update.where('portal_revision', 'is', null)
    : update.where('portal_revision', '=', form.portal_revision)
  await update.execute()
  return survey
}

const deliver = async (db: ConnectorDb, operation: Operation) => {
  try {
    const connection = await connectionFor(db, operation.agency_id)
    const response = operation.kind === 'form'
      ? await deliverForm(db, operation, connection)
      : await portalRequest(connection, operation.path!, operation.method!, operation.body as object | undefined)
    await db.updateTable('extensions.gcs_portal_operation').set({ state: 'delivered', response,
      last_error: null, delivered_at: new Date(), updated_at: new Date() })
      .where('id', '=', operation.id).where('state', '=', 'leased').where('attempts', '=', operation.attempts).execute()
    return { id: operation.id, delivered: true, response }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown Portal delivery error'
    await sql`UPDATE extensions.gcs_portal_operation SET state='pending', last_error=${message},
      next_attempt_at=now() + (${retryDelaySeconds(operation.attempts)} || ' seconds')::interval,
      updated_at=now() WHERE id=${operation.id}::bigint AND state='leased'
      AND attempts=${operation.attempts}`.execute(db)
    return { id: operation.id, delivered: false, error: message }
  }
}

const lease = async (db: ConnectorDb, agencyId?: string, operationId?: string): Promise<Operation | undefined> =>
  (await sql<Operation>`UPDATE extensions.gcs_portal_operation operation
    SET state='leased', attempts=attempts+1, next_attempt_at=now() + interval '2 minutes', updated_at=now()
    WHERE id=(SELECT candidate.id FROM extensions.gcs_portal_operation candidate
      WHERE candidate.state IN ('pending','leased') AND candidate.next_attempt_at<=now()
        AND (${agencyId ?? null}::bigint IS NULL OR candidate.agency_id=${agencyId ?? null}::bigint)
        AND (${operationId ?? null}::bigint IS NULL OR candidate.id=${operationId ?? null}::bigint)
        AND ${enabledPortalAgency('candidate.agency_id')}
        AND NOT EXISTS (SELECT 1 FROM extensions.gcs_portal_operation earlier
          WHERE earlier.agency_id=candidate.agency_id AND earlier.id<candidate.id
            AND earlier.state IN ('pending','leased'))
      ORDER BY candidate.next_attempt_at, candidate.id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id::text, agency_id::text, kind, method, path, body, form_id, attempts`.execute(db)).rows[0]

export const drainOperations = async (db: ConnectorDb, limit: number, agencyId?: string) => {
  const results: Array<{ id: string; delivered: boolean; error?: string }> = []
  for (let index = 0; index < limit; index++) {
    const operation = await lease(db, agencyId)
    if (!operation) break
    const result = await deliver(db, operation)
    results.push(result)
    if (!result.delivered) break
  }
  return { results }
}

export const queuePortalClient = (db: ConnectorDb, agencyId: string, connection: PortalConnection) =>
  createPortalClient(connection, fetch, async (path, method, body) => {
    const inserted = await db.insertInto('extensions.gcs_portal_operation').values({
      agency_id: agencyId, kind: 'request', method, path, body: body ?? null, form_id: null,
      last_error: null, response: null, delivered_at: null
    }).returning('id').executeTakeFirstOrThrow()
    const operation = await lease(db, agencyId, String(inserted.id))
    if (!operation) {
      const delivered = await db.selectFrom('extensions.gcs_portal_operation').select(['state', 'response'])
        .where('id', '=', String(inserted.id)).executeTakeFirst()
      if (delivered?.state === 'delivered') return delivered.response
      throw new Error('Portal operation is queued behind an earlier delivery.')
    }
    const result = await deliver(db, operation)
    if (!result.delivered) throw new Error(result.error)
    return result.response
  })

export const enqueueForm = async (db: ConnectorDb, agencyId: string, formId: string) => {
  await db.insertInto('extensions.gcs_portal_operation').values({
    agency_id: agencyId, kind: 'form', method: null, path: null, body: null,
    form_id: formId, last_error: null, response: null, delivered_at: null
  }).execute()
}
