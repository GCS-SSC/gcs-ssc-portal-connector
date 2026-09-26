import { describe, expect, it } from 'vitest'
import { retryDelaySeconds } from '../server/retry.ts'

describe('outbound retry pacing', () => {
  it('backs off early failures and caps repeated failures so a restart cannot flood the portal', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(attempt => retryDelaySeconds(attempt, 0)))
      .toEqual([30, 60, 120, 240, 480, 960, 1800, 1800])
    expect(retryDelaySeconds(1, 0.999999)).toBe(59)
    expect(retryDelaySeconds(50, 0.999999)).toBe(1829)
  })
})
