import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installGcsQueueRegistrar, type GcsQueueHandler } from '@gcs-ssc/extensions/server'
import type { ConnectorDatabase } from '../server/db.ts'
import { drainOperations } from '../server/operations.ts'
import { migrateQueueFixture, resetQueueFixture } from './fixtures/queue-database.ts'

const publishAgreement = vi.hoisted(() => vi.fn(async () => ({ deliveryPayload: { agreement: 'published' } })))
// Agreement publication's network effects are controlled; queue claims and every other delivery are real.
vi.mock('../server/publish-agreement.ts', () => ({
  publishAgreementCore: publishAgreement
}))

let db: Kysely<ConnectorDatabase>
beforeAll(async () => {
  db = new Kysely<ConnectorDatabase>({ dialect: new KyselyPGlite().dialect })
  await migrateQueueFixture(db)
}, 30_000)
beforeEach(async () => {
  vi.stubEnv('GCS_EXTENSION_SECRETS_KEY', 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=')
  await resetQueueFixture(db)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(async () => { await db.destroy() })

const enqueueOperation = async (agencyId: string, path: string, nextAttemptAt = new Date(0)) =>
  db.insertInto('extensions.gcs_ssc_portal_connector_operation').values({
    agency_id: agencyId, kind: 'request', method: 'POST', path, body: {}, form_id: null,
    next_attempt_at: nextAttemptAt, last_error: null, response: null, delivered_at: null
  }).returning('id').executeTakeFirstOrThrow()

describe('Portal delivery batches on a shared queue run', () => {
  it('processes every category up to its bound and leaves future work untouched', async () => {
    const future = new Date(Date.now() + 3_600_000)
    await db.insertInto('extensions.gcs_ssc_portal_connector_verification').values({
      portal_organization_id: 'N-ABCDE', proponent_id: '101', origin_agency_id: '11',
      verification_note: null, verified_by_user_id: null, portal_active: true
    }).execute()
    await sql`INSERT INTO "Funding_Case_Agreement_Claim" VALUES (301,401)`.execute(db)
    for (let index = 0; index < 122; index++) {
      const nextAttemptAt = index === 121 ? future : new Date(0)
      await enqueueOperation('11', `operations/${index}`, nextAttemptAt)
      await db.insertInto('extensions.gcs_ssc_portal_connector_outbox').values({
        agency_id: '11', agreement_id: '201', portal_organization_id: 'N-ABCDE', proponent_id: '101',
        next_attempt_at: nextAttemptAt, last_error: null, delivered_at: null
      }).execute()
      await db.insertInto('extensions.gcs_ssc_portal_connector_receipt').values({
        agency_id: '22', event_id: String(index + 1), submission_id: `submission-${index}`, item_submission_id: `item-${index}`,
        kind: 'submission_item', source_export: {}, gcs_entity_type: 'fundingcaseagreementclaim', gcs_entity_id: '301', state: 'imported'
      }).execute()
    }
    await db.updateTable('extensions.gcs_ssc_portal_connector_outcome_outbox')
      .set({ next_attempt_at: future }).where('id', '=', '122').execute()
    const transport = vi.fn(async (_url: unknown, options?: RequestInit) =>
      Response.json(options?.method === 'GET' ? { outcomes: [] } : { ok: true }))
    vi.stubGlobal('fetch', transport)

    const plugin = (await import('../server/plugins/outbox.ts')).default
    const hook = vi.fn()
    const app = { hooks: { hook } }
    const handlers = new Map<string, GcsQueueHandler>()
    installGcsQueueRegistrar(app, { register: handler => { handlers.set(handler.id, handler) } })
    plugin(app)
    expect([...handlers.keys()]).toEqual([
      'gcs-ssc-portal-connector:deliveries', 'gcs-ssc-portal-connector:imports'
    ])
    expect(hook).not.toHaveBeenCalledWith('gcs-extension:queue-register', expect.anything())
    const handler = handlers.get('gcs-ssc-portal-connector:deliveries')
    if (!handler) throw new Error('Portal delivery handler is not registered')
    await handler.run({
      db,
      createWriteAuthorization: () => { throw new Error('Deliveries must not request host business write access') },
      runForAgency: async (_agencyId, run) => run()
    })

    for (const table of ['outbox', 'outcome_outbox'] as const) {
      const rows = await db.selectFrom(`extensions.gcs_ssc_portal_connector_${table}`)
        .select([sql<string>`id::text`.as('id'), 'state', 'attempts']).orderBy(sql`id::bigint`).execute()
      expect(rows.filter(row => row.state === 'delivered')).toHaveLength(120)
      expect(rows.slice(120)).toEqual([
        { id: '121', state: 'pending', attempts: 0 }, { id: '122', state: 'pending', attempts: 0 }
      ])
    }
    const operations = await db.selectFrom('extensions.gcs_ssc_portal_connector_operation')
      .select([sql<string>`id::text`.as('id'), 'state', 'attempts']).where('agency_id', '=', '11').orderBy(sql`id::bigint`).execute()
    expect(operations.filter(row => row.state === 'delivered')).toHaveLength(120)
    expect(operations.slice(120)).toEqual([
      { id: '121', state: 'pending', attempts: 0 }, { id: '122', state: 'pending', attempts: 0 }
    ])
    for (const table of ['outbox', 'outcome_outbox', 'operation'] as const) {
      await db.updateTable(`extensions.gcs_ssc_portal_connector_${table}`)
        .set({ next_attempt_at: future }).where('id', '=', '121').execute()
    }
    const requests = transport.mock.calls.length
    await handler.run({
      db,
      createWriteAuthorization: () => { throw new Error('Deliveries must not request host business write access') },
      runForAgency: async (_agencyId, run) => run()
    })
    expect(transport).toHaveBeenCalledTimes(requests)
    expect(publishAgreement).toHaveBeenCalledTimes(120)
  }, 30_000)

  it('continues other Agencies after a failure while preserving each Agency order and backoff', async () => {
    await enqueueOperation('11', 'failing-first')
    await enqueueOperation('11', 'blocked-second')
    await enqueueOperation('22', 'ready-first')
    await enqueueOperation('22', 'ready-second')
    await enqueueOperation('22', 'future', new Date(Date.now() + 3_600_000))
    const transport = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith('/failing-first')) throw new Error('Agency 11 is offline')
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', transport)

    expect(await drainOperations(db, 10)).toEqual({ results: [
      { id: '1', delivered: false, error: 'Agency 11 is offline' },
      { id: '3', delivered: true, response: { ok: true } },
      { id: '4', delivered: true, response: { ok: true } }
    ] })
    expect(transport.mock.calls.map(([url]) => url.pathname.split('/').at(-1)))
      .toEqual(['failing-first', 'ready-first', 'ready-second'])
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation')
      .select(['state', 'attempts']).orderBy(sql`id::bigint`).execute()).toEqual([
      { state: 'pending', attempts: 1 }, { state: 'pending', attempts: 0 },
      { state: 'delivered', attempts: 1 }, { state: 'delivered', attempts: 1 }, { state: 'pending', attempts: 0 }
    ])
    expect(await drainOperations(db, 10)).toEqual({ results: [] })
    expect(transport).toHaveBeenCalledTimes(3)
  })
})
