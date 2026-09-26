/** Bounded exponential retry with at most 30 seconds of positive jitter. */
export const retryDelaySeconds = (attempts: number, random = Math.random()): number => {
  const base = Math.min(1800, 30 * 2 ** Math.min(Math.max(attempts - 1, 0), 6))
  return base + Math.floor(Math.max(0, Math.min(random, 0.999999)) * Math.min(base, 30))
}
