import { sql } from 'kysely'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { agencyIdFromContext, authorizedWrite } from './authorization.ts'
import { asConnectorDb, type ConnectorDb } from './db.ts'
import { enabledPortalAgency } from './enablement.ts'
import { publishAgreementCore } from './publish-agreement.ts'
import { drainOutcomeOutbox } from './outcomes.ts'
import { retryDelaySeconds } from './retry.ts'

interface OutboxRow {
  id: string
  agency_id: string
  agreement_id: string
  portal_organization_id: string
  proponent_id: string
  attempts: number
}

export const enqueueAgreement = async (
  db: ConnectorDb, agencyId: string, agreementId: string, portalOrganizationId: string, proponentId: string
) => {
  await db.insertInto('extensions.gcs_portal_outbox').values({
    agency_id: agencyId, agreement_id: agreementId,
    portal_organization_id: portalOrganizationId, proponent_id: proponentId,
    last_error: null, delivered_at: null
  }).execute()
}

/** Lease one item before network I/O; an expired lease survives a process crash. */
export const drainOutbox = async (db: ConnectorDb, limit: number, agencyId?: string) => {
  const results: Array<{ id: string; delivered: boolean; error?: string }> = []
  for (let index = 0; index < limit; index++) {
    const row = (await sql<OutboxRow>`
      UPDATE extensions.gcs_portal_outbox SET state = 'leased', attempts = attempts + 1,
        next_attempt_at = now() + interval '2 minutes', updated_at = now()
      WHERE id = (
        SELECT id FROM extensions.gcs_portal_outbox
        WHERE state <> 'delivered' AND next_attempt_at <= now()
          AND ${enabledPortalAgency('extensions.gcs_portal_outbox.agency_id')}
          AND (${agencyId ?? null}::bigint IS NULL OR agency_id = ${agencyId ?? null}::bigint)
        ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING id::text, agency_id::text, agreement_id::text,
        portal_organization_id, proponent_id::text, attempts
    `.execute(db)).rows[0]
    if (!row) break
    try {
      await publishAgreementCore(db, row.agency_id, {
        agreementId: row.agreement_id, proponentId: row.proponent_id,
        portalOrganizationId: row.portal_organization_id
      })
      await sql`UPDATE extensions.gcs_portal_outbox SET state='delivered', delivered_at=now(),
        updated_at=now(), last_error=NULL WHERE id=${row.id}::bigint
        AND state='leased' AND attempts=${row.attempts}`.execute(db)
      results.push({ id: row.id, delivered: true })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown delivery error'
      const seconds = retryDelaySeconds(row.attempts)
      await sql`UPDATE extensions.gcs_portal_outbox SET state='pending', last_error=${message},
        next_attempt_at=now() + (${seconds} || ' seconds')::interval,
        updated_at=now() WHERE id=${row.id}::bigint
        AND state='leased' AND attempts=${row.attempts}`.execute(db)
      results.push({ id: row.id, delivered: false, error: message })
    }
    if (index < limit - 1) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return { results }
}

export const listOutbox = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const rows = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_outbox')
    .selectAll().where('agency_id', '=', agencyId)
    .orderBy(sql<number>`CASE WHEN state='delivered' THEN 1 ELSE 0 END`)
    .orderBy('id', 'desc').limit(100).execute()
  const outcomes = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_outcome_outbox as outbox')
    .innerJoin('extensions.gcs_portal_receipt as receipt', 'receipt.id', 'outbox.receipt_id')
    .select(['outbox.id', 'outbox.state', 'outbox.attempts', 'outbox.next_attempt_at',
      'outbox.last_error', 'receipt.submission_id', 'receipt.kind'])
    .where('outbox.agency_id', '=', agencyId)
    .orderBy(sql<number>`CASE WHEN outbox.state='delivered' THEN 1 ELSE 0 END`)
    .orderBy('outbox.id', 'desc').limit(100).execute()
  const inbound = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_inbox as inbox')
    .leftJoin('extensions.gcs_portal_receipt as receipt', (join) => join
      .onRef('receipt.agency_id', '=', 'inbox.agency_id')
      .onRef('receipt.event_id', '=', 'inbox.event_id'))
    .select(['inbox.event_id', 'inbox.kind', 'inbox.submission_id', 'inbox.last_error',
      'receipt.state'])
    .where('inbox.agency_id', '=', agencyId)
    .orderBy(sql<number>`CASE WHEN receipt.state='imported' THEN 1 ELSE 0 END`)
    .orderBy('inbox.created_at', 'desc').limit(100).execute()
  return { outcomes: outcomes.map((row) => ({ id: String(row.id), submissionId: row.submission_id,
    kind: row.kind, state: row.state, attempts: row.attempts,
    nextAttemptAt: new Date(row.next_attempt_at).toISOString(), lastError: row.last_error })),
    inbound: inbound.map((row) => ({ eventId: row.event_id, kind: row.kind,
    submissionId: row.submission_id, state: row.state ?? 'pending', lastError: row.last_error })),
    backlog: rows.map((row) => ({
    id: String(row.id), agreementId: String(row.agreement_id),
    organizationId: row.portal_organization_id, state: row.state,
    attempts: row.attempts, nextAttemptAt: new Date(row.next_attempt_at).toISOString(),
    lastError: row.last_error
  })) }
}

export const pushOutbox = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const { z } = await import('zod')
  const input = z.object({ limit: z.number().int().min(1).max(100) }).strict().parse(await context.readBody())
  await authorizedWrite(context, async () => undefined)
  await sql`
    UPDATE extensions.gcs_portal_outbox SET next_attempt_at=now()
    WHERE id IN (SELECT id FROM extensions.gcs_portal_outbox
      WHERE agency_id=${agencyId}::bigint AND state='pending'
      ORDER BY next_attempt_at, id LIMIT ${input.limit})
  `.execute(asConnectorDb(context.db))
  await sql`
    UPDATE extensions.gcs_portal_outcome_outbox SET next_attempt_at=now()
    WHERE id IN (SELECT id FROM extensions.gcs_portal_outcome_outbox
      WHERE agency_id=${agencyId}::bigint AND state='pending'
      ORDER BY next_attempt_at,id LIMIT ${input.limit})
  `.execute(asConnectorDb(context.db))
  const agreements = await drainOutbox(asConnectorDb(context.db), input.limit, agencyId)
  const outcomes = await drainOutcomeOutbox(asConnectorDb(context.db),
    Math.max(0, input.limit - agreements.results.length), agencyId)
  return { results: [...agreements.results, ...outcomes.results] }
}
