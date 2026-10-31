import { describe, expect, it } from 'vitest'
import { budgetConfigSchema, budgetTotals, calculateBudget, emptyBudgetConfig, grantIssues, newBudgetRow, normalizeBudgetAnswer, type BudgetConfig, type BudgetRow } from '../vendor/survey/dist/index.js'

const option = (id: string) => ({ id, label: { en: id, fr: id } })
const config = (currency: string): BudgetConfig => ({
  ...emptyBudgetConfig(), currencies: [currency], categories: [option('costs'), option('charges')], fiscalYears: [option('year')],
  costItems: [
    { ...option('cost'), categoryId: 'costs', calculation: { mode: 'manual', percentage: null, sourceCategoryId: null, allowOverride: false } },
    { ...option('charge'), categoryId: 'charges', calculation: { mode: 'category', percentage: 10, sourceCategoryId: 'costs', allowOverride: false } }
  ]
})
const row = (currency: string, amount: string, id = 'r_cost'): BudgetRow => ({
  ...newBudgetRow(id, config(currency)), costItemId: 'cost', subsection: 'Delivery', description: 'Exact currency money',
  totalCost: amount, programFunding: amount
})

describe('vendored survey currency money', () => {
  it.each([['JPY', '1', '2'], ['CAD', '0.01', '0.02'], ['KWD', '0.001', '0.002'], ['CLF', '0.0001', '0.0002'], ['MGA', '0.2', '0.4']])(
    'calculates actual %s minor-unit totals', (currency, unit, total) => {
      const settings = config(currency)
      expect(budgetConfigSchema.safeParse(settings).success).toBe(true)
      const rows = [row(currency, unit), row(currency, unit, 'r_second')]
      expect(grantIssues({ type: 'budget', required: true, config: settings }, JSON.stringify({ version: 1, rows }))).toEqual([])
      expect(budgetTotals(settings, rows)[0]).toMatchObject({ totalCost: total, programFunding: total, gap: '0' })
      expect(normalizeBudgetAnswer(settings, { version: 1, rows }).rows[0]?.programFunding).toBe(unit)
    }
  )
  it.each([['JPY', '0.1'], ['KWD', '0.0001'], ['CLF', '0.00001'], ['MGA', '0.1']])('rejects fractional %s minor units', (currency, amount) => {
    expect(grantIssues({ type: 'budget', required: true, config: config(currency) }, JSON.stringify({ version: 1, rows: [row(currency, amount)] })))
      .toContainEqual({ path: 'rows.0.programFunding', code: 'money' })
    expect(() => budgetTotals(config(currency), [row(currency, amount)])).toThrow()
  })
  it('keeps the explicit whole-major-unit budget percentage rounding rule', () => {
    for (const [currency, basis] of [['KWD', '12.345'], ['MGA', '5']]) {
      const charge = { ...row(currency!, '10', 'r_charge'), costItemId: 'charge', programFunding: '' }
      expect(calculateBudget(config(currency!), [row(currency!, basis!), charge])[1]?.programFunding).toBe('1')
    }
  })
  it('retains adjacent large smallest units and independent currencies', () => {
    const settings = { ...config('KWD'), currencies: ['KWD', 'JPY'] }
    const totals = budgetTotals(settings, [row('KWD', '9007199254740993.001'), row('KWD', '0.001', 'r_second'), row('JPY', '1', 'r_yen')])
    expect(totals.map(total => [total.currency, total.programFunding])).toEqual([['KWD', '9007199254740993.002'], ['JPY', '1']])
  })
  it('does not offer currencies without a settlement subdivision', () => {
    expect(budgetConfigSchema.safeParse(config('XDR')).success).toBe(false)
  })
})
