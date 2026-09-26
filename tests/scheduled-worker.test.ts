import { afterEach, describe, expect, it, vi } from 'vitest'

const drainOutbox = vi.hoisted(() => vi.fn(async () => ({ results: [] })))
const drainOutcomeOutbox = vi.hoisted(() => vi.fn(async () => ({ results: [] })))
const pullDueAgencies = vi.hoisted(() => vi.fn(async () => ({ results: [] })))

vi.mock('../server/outbox.ts', () => ({ drainOutbox }))
vi.mock('../server/outcomes.ts', () => ({ drainOutcomeOutbox }))
vi.mock('../server/pull.ts', () => ({ pullDueAgencies, releasePullLease: vi.fn() }))
vi.mock('../server/sync.ts', () => ({ syncPortal: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('headless scheduled portal worker', () => {
  it('primes the outbox timer from a minute task without an HTTP afterResponse event', async () => {
    vi.useFakeTimers()
    const hooks = new Map<string, (payload: never) => Promise<void> | void>()
    const plugin = (await import('../server/plugins/outbox.ts')).default
    plugin({ hooks: { hook: (name: string, callback: (payload: never) => Promise<void> | void) => {
      hooks.set(name, callback)
    } } } as never)
    const database = { source: 'scheduled task' }

    try {
      await hooks.get('gcs-extension:scheduled-minute')?.({
        db: database,
        createWriteAuthorization: vi.fn(),
        runForAgency: vi.fn()
      } as never)
      expect(pullDueAgencies).toHaveBeenCalledWith(database)
      expect(drainOutbox).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(30_000)
      expect(drainOutbox).toHaveBeenCalledWith(database, 2)
      expect(drainOutcomeOutbox).toHaveBeenCalledWith(database, 2)
    } finally {
      await hooks.get('close')?.(undefined as never)
    }
  })
})
