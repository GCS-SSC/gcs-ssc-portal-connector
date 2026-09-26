import { afterEach, describe, expect, it, vi } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import { drainOutbox } from '../server/outbox.ts'
import { drainOutcomeOutbox } from '../server/outcomes.ts'
import { pullDueAgencies } from '../server/pull.ts'

const connectorKey = 'gcs-ssc-portal-connector'

const disabledAgencyDatabase = () => {
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = []
  const client = {
    query: async (sql: string, parameters: readonly unknown[]) => {
      queries.push({ sql, parameters })
      // The eligibility subquery finds no active enablement row for this agency.
      return { command: 'UPDATE', rowCount: 0, rows: [] }
    },
    release: () => undefined
  }
  const pool = { connect: async () => client, end: async () => undefined }
  const db = new Kysely<never>({ dialect: new PostgresDialect({ pool: pool as never }) })
  return { db, queries }
}

const expectEnabledAgencyLease = (query: { sql: string; parameters: readonly unknown[] }, table: string) => {
  expect(query.sql).toContain('extensions.agency_enablement AS enablement')
  expect(query.sql).toContain('JOIN "Agency_Profile" AS agency')
  expect(query.sql).toContain(`"extensions"."${table}"."agency_id"`)
  expect(query.sql).toContain('enablement.enabled = true')
  expect(query.sql).toContain('enablement._deleted = false')
  expect(query.sql).toContain('agency._deleted = false')
  expect(query.parameters).toContain(connectorKey)
}

afterEach(() => vi.unstubAllGlobals())

describe('disabled Agency background work', () => {
  it('does not poll or lease outbound Agreement/status work without current enablement', async () => {
    const { db, queries } = disabledAgencyDatabase()
    const transport = vi.fn(async () => Response.json({}))
    vi.stubGlobal('fetch', transport)

    try {
      expect(await pullDueAgencies(db as never)).toEqual({ results: [] })
      expect(await drainOutbox(db as never, 1)).toEqual({ results: [] })
      expect(await drainOutcomeOutbox(db as never, 1)).toEqual({ results: [] })

      expect(queries).toHaveLength(3)
      expectEnabledAgencyLease(queries[0]!, 'gcs_portal_connection')
      expectEnabledAgencyLease(queries[1]!, 'gcs_portal_outbox')
      expectEnabledAgencyLease(queries[2]!, 'gcs_portal_outcome_outbox')
      expect(transport).not.toHaveBeenCalled()
    } finally {
      await db.destroy()
    }
  })
})
