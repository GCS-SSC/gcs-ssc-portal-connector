import { describe, expect, it } from 'vitest'
import { foreignId } from '../server/forms.ts'

describe('portal form foreign identity', () => {
  it('preserves the deterministic 60-bit SHA-256 identity for calls and agreement sets', () => {
    expect(foreignId('form-call:V-ABCDE:1')).toBe('161736528191523518')
    expect(foreignId('form-set:V-ABCDE:2:G-ABCDE:N-ABCDE')).toBe('655547621582126624')
    expect(foreignId('form-call:V-ABCDE:1')).toBe(foreignId('form-call:V-ABCDE:1'))
  })
})
