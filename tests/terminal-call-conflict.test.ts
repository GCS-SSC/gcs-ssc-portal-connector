import { afterEach, expect, it, vi } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'

vi.mock('../server/connection.ts', () => ({ readPortalCredentialFromDb: async () => `gcs_${'a'.repeat(43)}` }))

import migration0010 from '../server/migrations/0010_portal_operations.ts'
import migration0011 from '../server/migrations/0011_terminal_call_conflicts.ts'
import { queuePortalClient } from '../server/operations.ts'
import { PortalRequestError } from '../server/portal-client.ts'

afterEach(() => vi.unstubAllGlobals())

it('retains a rejected call update without blocking later portal operations', async () => {
  const db = new Kysely<unknown>({ dialect: new KyselyPGlite().dialect })
  try {
    await sql`CREATE SCHEMA extensions`.execute(db)
    await sql`CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
    await sql`INSERT INTO "Agency_Profile" (id) VALUES (1)`.execute(db)
    await sql`CREATE TABLE extensions.agency_enablement (
      agency_id bigint, extension_key text, enabled boolean, _deleted boolean)`.execute(db)
    await sql`INSERT INTO extensions.agency_enablement VALUES (1, 'gcs-ssc-portal-connector', true, false)`.execute(db)
    await sql`CREATE TABLE extensions.gcs_portal_connection (
      agency_id bigint PRIMARY KEY, portal_url text, portal_agency_id text)`.execute(db)
    await sql`INSERT INTO extensions.gcs_portal_connection VALUES (1, 'https://portal.example/', 'G-ABCDE')`.execute(db)
    await migration0010.up(db)
    await migration0011.up(db)
    const transport = vi.fn(async () => transport.mock.calls.length === 1
      ? Response.json({ data: { code: 'REVISION_CONFLICT' } }, { status: 409 })
      : Response.json({ id: 'D-BCDEF' }))
    vi.stubGlobal('fetch', transport)
    const client = queuePortalClient(db as never, '1', {
      portalUrl: 'https://portal.example/', portalAgencyId: 'G-ABCDE', key: `gcs_${'a'.repeat(43)}`
    })
    await expect(client.updateCall('D-ABCDE', 1, { nameEn: 'A' }))
      .rejects.toBeInstanceOf(PortalRequestError)
    expect((await sql<{ state: string }>`SELECT state FROM extensions.gcs_portal_operation ORDER BY id`.execute(db)).rows)
      .toEqual([{ state: 'failed' }])
    expect(await client.createCall({ nameEn: 'B' })).toBe('D-BCDEF')
    expect((await sql<{ state: string }>`SELECT state FROM extensions.gcs_portal_operation ORDER BY id`.execute(db)).rows)
      .toEqual([{ state: 'failed' }, { state: 'delivered' }])
  } finally { await db.destroy() }
}, 30_000)
