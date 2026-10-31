import { describe, expect, it } from 'vitest'
import { forecastItemSchema } from '../shared/portal-contract.ts'

const forecastItem = () => ({
  kind: 'forecast', itemSubmissionId: 'forecast-submission', mappingComplete: true,
  forecast: {
    agreementId: '33', header: { egcs_fc_fiscalyear: '77' },
    lineItems: [{ egcs_fc_fundingagreementbudgetlineitem: '66', egcs_fc_month: 0,
      egcs_fc_amount: { amount: '100000', currency: 'CAD' }, egcs_fc_currency: 'CAD' }]
  }
})

describe('Portal forecast import contract', () => {
  it('accepts monthly amounts without a caller assigned version', () => {
    expect(forecastItemSchema.parse(forecastItem())).toEqual(forecastItem())
  })

  it('rejects obsolete fixed-zero line versions', () => {
    const obsolete = forecastItem()
    Object.assign(obsolete.forecast.lineItems[0]!, { egcs_fc_version: '0' })
    expect(forecastItemSchema.safeParse(obsolete).success).toBe(false)
  })

  it('rejects invented line versions and caller assigned header versions', () => {
    const lineVersion = forecastItem()
    Object.assign(lineVersion.forecast.lineItems[0]!, { egcs_fc_version: '1' })
    expect(forecastItemSchema.safeParse(lineVersion).success).toBe(false)
    const headerVersion = forecastItem()
    Object.assign(headerVersion.forecast.header, { egcs_fc_version: '1' })
    expect(forecastItemSchema.safeParse(headerVersion).success).toBe(false)
  })
})
