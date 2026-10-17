import { describe, expect, it } from 'vitest'
import { formatSurveyDecimal } from '../shared/format-decimal'

describe('exact localized survey totals', () => {
  it('retains fractions and large integer precision in both languages', () => {
    expect(formatSurveyDecimal('9007199254740993.123456789', 'en')).toBe('9,007,199,254,740,993.123456789')
    expect(formatSurveyDecimal('9007199254740993.123456789', 'fr')).toBe('9 007 199 254 740 993,123456789')
    expect(formatSurveyDecimal('-0.25', 'fr')).toBe('-0,25')
    expect(formatSurveyDecimal(null, 'fr')).toBe('—')
  })
})
