import { sql } from 'kysely'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { designerSurveySchema } from '@gcs-ssc/survey'
import { readPortalCredentialFromDb } from './connection.ts'
import { asConnectorDb, type ConnectorDb } from './db.ts'
import { enabledPortalAgency } from './enablement.ts'
import { createPortalClient, PortalRequestError, portalRequest, serializePortalBody, type PortalConnection, type PortalMethod } from './portal-client.ts'
import { retryDelaySeconds } from './retry.ts'

type Operation = {
  id: string; idempotency_key: string; agency_id: string; kind: 'request' | 'form'; method: PortalMethod | null
  path: string | null; body: unknown; form_id: string | null; attempts: number
}

const connectionFor = async (db: ConnectorDb, agencyId: string): Promise<PortalConnection> => {
  const row = await db.selectFrom('extensions.gcs_ssc_portal_connector_connection').select(['portal_url', 'portal_agency_id'])
    .where('agency_id', '=', agencyId).executeTakeFirst()
  if (!row) throw new Error('Save a Portal connection to deliver this queued change.')
  return { portalUrl: row.portal_url, portalAgencyId: row.portal_agency_id,
    key: await readPortalCredentialFromDb(asConnectorDb(db), agencyId) }
}

const formSnapshotSchema = z.object({
  definition: designerSurveySchema,
  revision: z.number().int().positive(),
  request: z.object({ path: z.string(), method: z.enum(['POST', 'PUT']), body: z.record(z.string(), z.unknown()) }).optional()
})

const deliverForm = async (db: ConnectorDb, operation: Operation, connection: PortalConnection) => {
  const snapshot = formSnapshotSchema.parse(operation.body)
  if (!snapshot.request) {
    const form = await db.selectFrom('extensions.gcs_ssc_portal_connector_form').selectAll()
      .where('agency_id', '=', operation.agency_id).where('id', '=', operation.form_id!).executeTakeFirstOrThrow()
    snapshot.request = form.portal_id
      ? { path: `surveys/${encodeURIComponent(form.portal_id)}`, method: 'PUT',
          body: { expectedRevision: form.portal_revision, definition: snapshot.definition } }
      : { path: 'surveys', method: 'POST',
          body: { agencyId: connection.portalAgencyId, definition: snapshot.definition } }
    // Freeze the predecessor's revision before I/O so crash retries replay exactly.
    const frozen = await db.updateTable('extensions.gcs_ssc_portal_connector_operation').set({ body: snapshot })
      .where('id', '=', operation.id).where('state', '=', 'leased')
      .where('attempts', '=', operation.attempts).returning('id').executeTakeFirst()
    if (!frozen) throw new Error('Portal operation lease expired before delivery.')
  }
  const response = await portalRequest(connection, snapshot.request.path, snapshot.request.method,
    snapshot.request.body, fetch, operation.idempotency_key)
  const survey = z.object({ survey: z.object({ id: z.string(), revision: z.number().int().positive() }) })
    .parse(response).survey
  await db.updateTable('extensions.gcs_ssc_portal_connector_form').set({ portal_id: survey.id, portal_revision: survey.revision })
    .where('agency_id', '=', operation.agency_id).where('id', '=', operation.form_id!)
    .where(eb => eb.exists(eb.selectFrom('extensions.gcs_ssc_portal_connector_operation').select('id')
      .where('id', '=', operation.id).where('state', '=', 'leased').where('attempts', '=', operation.attempts)))
    .where(eb => eb.or([eb('portal_revision', 'is', null), eb('portal_revision', '<=', survey.revision)]))
    .execute()
  return survey
}

const deliver = async (db: ConnectorDb, operation: Operation) => {
  try {
    const connection = await connectionFor(db, operation.agency_id)
    const response = operation.kind === 'form'
      ? await deliverForm(db, operation, connection)
      : await portalRequest(connection, operation.path!, operation.method!, operation.body as object | undefined, fetch, operation.idempotency_key)
    const completed = await db.updateTable('extensions.gcs_ssc_portal_connector_operation').set({ state: 'delivered', response,
      last_error: null, delivered_at: new Date(), updated_at: new Date() })
      .where('id', '=', operation.id).where('state', '=', 'leased').where('attempts', '=', operation.attempts).returning('id').executeTakeFirst()
    if (!completed) return { id: operation.id, delivered: false, error: 'Portal operation lease expired.' }
    return { id: operation.id, delivered: true, response }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown Portal delivery error'
    const callConflict = error instanceof PortalRequestError && error.status === 409
      && operation.method === 'PUT' && /^calls\/[^/]+$/.test(operation.path ?? '')
    if (callConflict) {
      await db.updateTable('extensions.gcs_ssc_portal_connector_operation').set({ state: 'failed', last_error: message,
        updated_at: new Date() }).where('id', '=', operation.id)
        .where('state', '=', 'leased').where('attempts', '=', operation.attempts).execute()
      return { id: operation.id, delivered: false, error: message, conflict: true }
    }
    await sql`UPDATE extensions.gcs_ssc_portal_connector_operation SET state='pending', last_error=${message},
      next_attempt_at=now() + (${retryDelaySeconds(operation.attempts)} || ' seconds')::interval,
      updated_at=now() WHERE id=${operation.id}::bigint AND state='leased'
      AND attempts=${operation.attempts}`.execute(db)
    return { id: operation.id, delivered: false, error: message }
  }
}

const lease = async (db: ConnectorDb, agencyId?: string, operationId?: string): Promise<Operation | undefined> =>
  (await sql<Operation>`UPDATE extensions.gcs_ssc_portal_connector_operation operation
    SET state='leased', attempts=attempts+1, next_attempt_at=now() + interval '2 minutes', updated_at=now()
    WHERE id=(SELECT candidate.id FROM extensions.gcs_ssc_portal_connector_operation candidate
      WHERE candidate.state IN ('pending','leased') AND candidate.next_attempt_at<=now()
        AND (${agencyId ?? null}::bigint IS NULL OR candidate.agency_id=${agencyId ?? null}::bigint)
        AND (${operationId ?? null}::bigint IS NULL OR candidate.id=${operationId ?? null}::bigint)
        AND ${enabledPortalAgency('candidate.agency_id')}
        AND NOT EXISTS (SELECT 1 FROM extensions.gcs_ssc_portal_connector_operation earlier
          WHERE earlier.agency_id=candidate.agency_id AND earlier.id<candidate.id
            AND earlier.state IN ('pending','leased'))
      ORDER BY candidate.next_attempt_at, candidate.id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id::text, idempotency_key, agency_id::text, kind, method, path, body, form_id, attempts`.execute(db)).rows[0]

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

export const queuePortalClient = (db: ConnectorDb, agencyId: string, connection: PortalConnection, deliveryScope?: string) =>
  createPortalClient(connection, fetch, async (path, method, body) => {
    const deduplicationKey = deliveryScope ? `${deliveryScope}:${agencyId}:${createHash('sha256')
      .update(serializePortalBody({ path, method, body: body ?? null })).digest('hex')}` : null
    const inserted = await db.insertInto('extensions.gcs_ssc_portal_connector_operation').values({
      agency_id: agencyId, kind: 'request', method, path, body: body ?? null, form_id: null,
      deduplication_key: deduplicationKey,
      last_error: null, response: null, delivered_at: null
    }).onConflict(conflict => conflict.column('deduplication_key').doNothing())
      .returning('id').executeTakeFirst()
    const stored = inserted ?? await db.selectFrom('extensions.gcs_ssc_portal_connector_operation')
      .select('id').where('deduplication_key', '=', deduplicationKey).executeTakeFirstOrThrow()
    const saved = await db.selectFrom('extensions.gcs_ssc_portal_connector_operation').select(['state', 'response'])
      .where('id', '=', String(stored.id)).executeTakeFirstOrThrow()
    if (saved.state === 'delivered') return saved.response
    if (saved.state === 'failed') throw new PortalRequestError(409, path)
    const operation = await lease(db, agencyId, String(stored.id))
    if (!operation) {
      const delivered = await db.selectFrom('extensions.gcs_ssc_portal_connector_operation').select(['state', 'response'])
        .where('id', '=', String(stored.id)).executeTakeFirst()
      if (delivered?.state === 'delivered') return delivered.response
      throw new Error('Portal operation is queued behind an earlier delivery.')
    }
    const result = await deliver(db, operation)
    if ('conflict' in result && result.conflict) throw new PortalRequestError(409, path)
    if (!result.delivered) throw new Error(result.error)
    return result.response
  })

export const enqueueForm = async (db: ConnectorDb, agencyId: string, formId: string) => {
  const form = await db.selectFrom('extensions.gcs_ssc_portal_connector_form').select(['definition', 'revision'])
    .where('agency_id', '=', agencyId).where('id', '=', formId).executeTakeFirstOrThrow()
  await db.insertInto('extensions.gcs_ssc_portal_connector_operation').values({
    agency_id: agencyId, kind: 'form', method: null, path: null,
    body: { definition: designerSurveySchema.parse(form.definition), revision: form.revision },
    form_id: formId, last_error: null, response: null, delivered_at: null
  }).execute()
}
