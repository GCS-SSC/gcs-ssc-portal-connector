import { describe, expect, it } from 'vitest'
import { claimItemSchema, forecastItemSchema, submissionSchema } from '../shared/portal-contract.ts'

const claim = (amount: unknown, currency: string) => ({
  kind: 'claim', itemSubmissionId: 'claim-1', mappingComplete: true,
  claim: {
    agreementId: '1', applicantRecipientId: '2', streamId: '3', fiscalYearId: '4',
    isFinalForYear: false, periodStart: 0, periodEnd: 1, receivedDate: '2026-01-01T00:00:00.000Z',
    lineItems: [{ budgetLineItemId: '5', submittedCostCategory: null, submittedCostSubsection: null,
      submittedLineItem: null, description: 'Cost', amount, currency }]
  }
})
const forecast = (amount: unknown, currency: string) => ({
  kind: 'forecast', itemSubmissionId: 'forecast-1', mappingComplete: true,
  forecast: { agreementId: '1', header: { egcs_fc_fiscalyear: '4' }, lineItems: [{
    egcs_fc_fundingagreementbudgetlineitem: '5', egcs_fc_month: 0, egcs_fc_amount: amount, egcs_fc_currency: currency
  }] }
})

describe('Portal minor-unit money wire contract', () => {
  it('requires the clean version 2 submission wire', () => {
    const value = { schemaVersion: 2, submissionId: 's1', organizationId: 'o1', agreementReference: null, items: [{ kind: 'claim', itemSubmissionId: 'i1' }] }
    expect(submissionSchema.parse(value)).toEqual(value)
    expect(submissionSchema.safeParse({ ...value, schemaVersion: 1 }).success).toBe(false)
  })
  it.each(['JPY', 'CAD', 'KWD', 'CLF', 'MGA'])('retains one %s minor unit without decimal reinterpretation', currency => {
    const amount = { amount: '1', currency }
    expect(claimItemSchema.parse(claim(amount, currency)).claim.lineItems[0]?.amount).toEqual(amount)
    expect(forecastItemSchema.parse(forecast(amount, currency)).forecast.lineItems[0]?.egcs_fc_amount).toEqual(amount)
  })
  it.each(['0.01', 1, { amount: '0.1', currency: 'CAD' }, { amount: 1, currency: 'CAD' },
    { amount: '1', currency: 'JPY' }, { amount: '1', currency: 'XDR' },
    { amount: '100000000000000000000000000000000000000', currency: 'CAD' }])('rejects obsolete, mismatched or invalid money %j', amount => {
    expect(claimItemSchema.safeParse(claim(amount, 'CAD')).success).toBe(false)
    expect(forecastItemSchema.safeParse(forecast(amount, 'CAD')).success).toBe(false)
  })
  it('preserves adjacent large minor-unit amounts exactly', () => {
    for (const amount of ['9007199254740993001', '9007199254740993002']) {
      expect(claimItemSchema.parse(claim({ amount, currency: 'KWD' }, 'KWD')).claim.lineItems[0]?.amount.amount).toBe(amount)
    }
  })
})
