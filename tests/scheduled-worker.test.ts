import { afterEach, describe, expect, it, vi } from 'vitest'

const drainOutbox = vi.hoisted(() => vi.fn(async () => ({ results: [] })))
const drainOutcomeOutbox = vi.hoisted(() => vi.fn(async () => ({ results: [] })))
const pullDueAgencies = vi.hoisted(() => vi.fn(async (): Promise<{ results: Array<{ agencyId: string; found: number; error?: string }> }> => ({ results: [] })))
const drainOperations = vi.hoisted(() => vi.fn(async () => ({ results: [] })))

const handlers = vi.hoisted(() => new Map<string, { intervalMs: number; run: (context: unknown) => Promise<void> }>())
vi.mock('@gcs-ssc/extensions/server', async importOriginal => ({
  ...await importOriginal<object>(),
  registerGcsExtensionL1QueueHandler: (handler: { id: string; intervalMs: number; run: (context: unknown) => Promise<void> }) => {
    handlers.set(handler.id, handler)
  }
}))

vi.mock('../server/outbox.ts', () => ({ drainOutbox }))
vi.mock('../server/outcomes.ts', () => ({ drainOutcomeOutbox }))
const releasePullLease = vi.hoisted(() => vi.fn())
const syncPortal = vi.hoisted(() => vi.fn())
vi.mock('../server/pull.ts', () => ({ pullDueAgencies, releasePullLease }))
vi.mock('../server/operations.ts', () => ({ drainOperations }))
vi.mock('../server/sync.ts', () => ({ syncPortal }))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('host L1 scheduled portal worker', () => {
  it('registers bounded delivery and import handlers without requiring an HTTP response', async () => {
    handlers.clear()
    const plugin = (await import('../server/plugins/outbox.ts')).default
    plugin({ hooks: { hook: vi.fn() } } as never)
    const database = { source: 'L1 task' }
    expect(handlers.get('deliveries')?.intervalMs).toBe(5000)
    expect(handlers.get('imports')?.intervalMs).toBe(60000)
    await handlers.get('imports')?.run({ db: database, createWriteAuthorization: vi.fn(), runForAgency: vi.fn() })
    expect(pullDueAgencies).toHaveBeenCalledWith(database)
    await handlers.get('deliveries')?.run({ db: database })
    expect(drainOperations).toHaveBeenCalledWith(database, 2)
    expect(drainOutbox).toHaveBeenCalledWith(database, 2)
    expect(drainOutcomeOutbox).toHaveBeenCalledWith(database, 2)
  })

  it('uses the host agency context for imports and releases a failed import lease', async () => {
    const plugin = (await import('../server/plugins/outbox.ts')).default
    plugin({ hooks: { hook: vi.fn() } } as never)
    pullDueAgencies.mockResolvedValueOnce({ results: [{ agencyId: '11', found: 1 }] })
    const database = { source: 'L1 import' }
    const authorization = { source: 'host authorization' }
    const createWriteAuthorization = vi.fn(() => authorization)
    const runForAgency = vi.fn(async (_agencyId: string, run: () => Promise<void>) => run())
    syncPortal.mockRejectedValueOnce(new Error('Import unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await handlers.get('imports')?.run({ db: database, createWriteAuthorization, runForAgency })
      expect(runForAgency).toHaveBeenCalledWith('11', expect.any(Function))
      expect(createWriteAuthorization).toHaveBeenCalledWith('gcs-ssc-portal-connector', '11')
      expect(syncPortal).toHaveBeenCalledWith(expect.objectContaining({ db: database,
        params: { agencyId: '11' }, writeAuthorization: authorization }))
      expect(releasePullLease).toHaveBeenCalledWith(database, '11')
    } finally { log.mockRestore() }
  })
})
