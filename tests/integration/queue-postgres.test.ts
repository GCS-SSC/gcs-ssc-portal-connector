import { randomUUID } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorDatabase } from '../../server/db.ts'
import { drainOperations } from '../../server/operations.ts'
import { migrateQueueFixture, resetQueueFixture } from '../fixtures/queue-database.ts'

const databaseName = `portal_queue_${randomUUID().replaceAll('-', '')}_test`
let administration: Pool | undefined
let first: Kysely<ConnectorDatabase>
let second: Kysely<ConnectorDatabase>
let created = false

beforeAll(async () => {
  const configured = process.env.GCS_PORTAL_POSTGRES_TEST_URL
  if (!configured) throw new Error('GCS_PORTAL_POSTGRES_TEST_URL must name an explicitly disposable *_test PostgreSQL database.')
  const url = new URL(configured)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.endsWith('_test')) {
    throw new Error('GCS_PORTAL_POSTGRES_TEST_URL must name an explicitly disposable *_test PostgreSQL database.')
  }
  administration = new Pool({ connectionString: configured, max: 1 })
  await administration.query(`CREATE DATABASE "${databaseName}"`)
  created = true
  url.pathname = `/${databaseName}`
  const connect = () => new Kysely<ConnectorDatabase>({ dialect: new PostgresDialect({ pool: new Pool({
    connectionString: url.toString(), max: 1, options: '-c statement_timeout=10000 -c lock_timeout=5000'
  }) }) })
  first = connect()
  second = connect()
  await migrateQueueFixture(first)
}, 30_000)
beforeEach(async () => {
  vi.stubEnv('GCS_EXTENSION_SECRETS_KEY', 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=')
  await resetQueueFixture(first)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(async () => {
  try {
    await Promise.all([first?.destroy(), second?.destroy()])
    if (created) await administration?.query(`DROP DATABASE "${databaseName}"`)
  } finally { await administration?.end() }
})

const enqueue = async (agencyId: string, path: string) => first.insertInto('extensions.gcs_ssc_portal_connector_operation')
  .values({ agency_id: agencyId, kind: 'request', method: 'POST', path, body: {}, form_id: null,
    last_error: null, response: null, delivered_at: null }).execute()
const deferred = () => {
  let resolve = () => {}
  const promise = new Promise<void>(complete => { resolve = complete })
  return { promise, resolve }
}

describe('Portal queue PostgreSQL claims', () => {
  it('claims only the operation being executed and permits another Agency to progress without duplicate delivery', async () => {
    await enqueue('11', 'held')
    await enqueue('11', 'ordered-next')
    await enqueue('22', 'independent')
    const entered = deferred()
    const release = deferred()
    const transport = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith('/held')) { entered.resolve(); await release.promise }
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', transport)
    const active = drainOperations(first, 2)
    try {
      await entered.promise
      expect((await second.selectFrom('extensions.gcs_ssc_portal_connector_operation')
        .select(['state', 'attempts']).orderBy('id').execute())).toEqual([
        { state: 'leased', attempts: 1 }, { state: 'pending', attempts: 0 }, { state: 'pending', attempts: 0 }
      ])
      expect(await drainOperations(second, 2)).toEqual({ results: [{ id: '3', delivered: true, response: { ok: true } }] })
      release.resolve()
      expect((await active).results.map(row => row.id)).toEqual(['1', '2'])
      expect(transport.mock.calls.map(([url]) => url.pathname.split('/').at(-1)))
        .toEqual(['held', 'independent', 'ordered-next'])
      expect(await second.selectFrom('extensions.gcs_ssc_portal_connector_operation')
        .select(['state', 'attempts']).orderBy('id').execute()).toEqual([
        { state: 'delivered', attempts: 1 }, { state: 'delivered', attempts: 1 }, { state: 'delivered', attempts: 1 }
      ])
    } finally { release.resolve(); await active }
  }, 15_000)

  it('reclaims an expired lease and ignores stale completion after the replacement finishes', async () => {
    await enqueue('11', 'replayed')
    const entered = deferred()
    const release = deferred()
    const transport = vi.fn(async (_url: unknown, _options?: RequestInit) => {
      if (transport.mock.calls.length === 1) { entered.resolve(); await release.promise }
      return Response.json({ version: transport.mock.calls.length })
    })
    vi.stubGlobal('fetch', transport)
    const stale = drainOperations(first, 1)
    try {
      await entered.promise
      await sql`UPDATE extensions.gcs_ssc_portal_connector_operation SET next_attempt_at=now()-interval '1 minute'`.execute(second)
      expect(await drainOperations(second, 1)).toMatchObject({ results: [{ id: '1', delivered: true }] })
      const replacement = await second.selectFrom('extensions.gcs_ssc_portal_connector_operation').selectAll().executeTakeFirstOrThrow()
      expect(replacement).toMatchObject({ state: 'delivered', attempts: 2 })
      release.resolve()
      expect(await stale).toEqual({ results: [{ id: '1', delivered: false, error: 'Portal operation lease expired.' }] })
      expect(await second.selectFrom('extensions.gcs_ssc_portal_connector_operation').selectAll().executeTakeFirstOrThrow())
        .toEqual(replacement)
      expect(await drainOperations(second, 1)).toEqual({ results: [] })
      const keys = transport.mock.calls.map(([, options]) => new Headers(options?.headers).get('Idempotency-Key'))
      expect(keys).toEqual([replacement.idempotency_key, replacement.idempotency_key])
      expect(transport.mock.calls.map(([, options]) => options?.body)).toEqual(['{}', '{}'])
    } finally { release.resolve(); await stale }
  }, 15_000)
})
