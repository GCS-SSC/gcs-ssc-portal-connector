import { expect, test, type APIResponse } from '@playwright/test'
import { nanoid } from 'nanoid'

const EXTENSION = 'gcs-ssc-portal-connector'
const option = (id: string, name: string) => ({ id, label: { en: name, fr: name } })
const currencies = [
  { code: 'JPY', value: '1', invalid: '0.1' },
  { code: 'KWD', value: '0.001', invalid: '0.0001' },
  { code: 'CLF', value: '0.0001', invalid: '0.00001' },
  { code: 'MGA', value: '0.2', invalid: '0.1' }
]
const definition = () => ({
  schemaVersion: 4,
  title: { en: 'Currency grant browser check', fr: 'Vérification des devises' },
  questions: currencies.map(({ code }) => ({
    id: `${code.toLowerCase()}budget`, type: 'budget', required: true,
    label: { en: `${code} budget`, fr: `Budget ${code}` },
    config: {
      source: { mode: 'custom' }, maxRows: 3, currencies: [code],
      categories: [option('costs', 'Costs')], fiscalYears: [option('year', '2028–2029')],
      costItems: [{ ...option('cost', 'Cost'), categoryId: 'costs', calculation: {
        mode: 'manual', sourceCategoryId: null, percentage: null, allowOverride: false
      } }], fundingTypes: [], fundingSubtypes: []
    }
  })),
  pages: [{ id: 'budgetpage', title: { en: 'Budget', fr: 'Budget' },
    questionIds: currencies.map(({ code }) => `${code.toLowerCase()}budget`), groups: [], branches: [] }]
})
const expectOk = async (response: APIResponse, operation: string) =>
  expect(response.ok(), `${operation}: ${response.status()} ${await response.text()}`).toBe(true)

test('grant preview accepts real JPY/KWD/CLF/MGA units and recovers from fractional minor units', async ({ page, baseURL }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/en/login')
  await page.getByLabel('Email').fill('root@example.com')
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: /^login$/i }).click()
  await page.waitForURL(url => !url.pathname.endsWith('/login'))
  const headers = { Origin: baseURL!, Referer: `${baseURL}/en/` }
  const token = nanoid(8)
  const agencyResponse = await page.request.post('/api/agency', { headers, data: {
    egcs_ay_gwcoanumber: '113', egcs_ay_agencyfinancialsystemid: `${Date.now()}`,
    egcs_ay_name_en: `Currency Portal ${token}`, egcs_ay_name_fr: `Portail devises ${token}`,
    egcs_ay_abbreviation_en: `CP-${token}`, egcs_ay_abbreviation_fr: `PD-${token}`, egcs_ay_active: true
  } })
  await expectOk(agencyResponse, 'Create the isolated Agency')
  const agencyId = String((await agencyResponse.json()).id)
  await expectOk(await page.request.patch(`/api/extensions/agency/${agencyId}`, { headers,
    data: { extensionKey: EXTENSION, enabled: true, config: {} } }), 'Enable Portal')
  const createForm = await page.request.post(`/api/extensions/${EXTENSION}/agencies/${agencyId}/forms`, {
    headers, data: { action: 'save', definition: definition() }
  })
  await expectOk(createForm, 'Save the local grant form')
  const formId = String((await createForm.json()).survey.id)
  const route = `/en/extension/${EXTENSION}/agencies/${agencyId}/forms/${formId}?view=test`
  await page.goto(route)
  await expect(page.getByRole('heading', { name: 'Currency grant browser check' }).last()).toBeVisible()
  await page.reload()
  for (const { code, value, invalid } of currencies) {
    const group = page.getByRole('group', { name: `${code} budget (required)`, exact: true })
    await group.getByRole('button', { name: 'Add a cost', exact: true }).click()
    await group.getByRole('combobox', { name: /Cost category \/ line item/ }).click()
    await page.getByRole('option', { name: /Costs \/ Cost/ }).click()
    await group.getByLabel(/Cost subsection/).fill('Delivery')
    await group.getByLabel(/Cost description/).fill(`${code} smallest unit`)
    await group.getByLabel(/Total cost/).fill(value)
    const requested = group.getByLabel(/Requested program funding/)
    await requested.fill(invalid)
    await page.getByRole('button', { name: 'Check', exact: true }).click()
    await expect(group.getByText('Enter an amount using the selected currency’s smallest unit.', { exact: true })).toBeVisible()
    await requested.fill(value)
    await requested.blur()
    await expect(group.getByText('Enter an amount using the selected currency’s smallest unit.', { exact: true })).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.getByText('Responses are valid.', { exact: true })).toBeVisible()
  await expect(page.getByText('This test is complete. Go back to try different answers.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Français', exact: true }).click()
  await expect(page.getByText('Ce test est terminé. Revenez en arrière pour essayer d’autres réponses.', { exact: true })).toBeVisible()
  const saved = await page.request.get(`/api/extensions/${EXTENSION}/agencies/${agencyId}/forms/${formId}`)
  await expectOk(saved, 'Read the saved grant definition')
  expect((await saved.json()).survey.definition.questions.map((question: { config: { currencies: string[] } }) => question.config.currencies))
    .toEqual(currencies.map(({ code }) => [code]))
  expect(errors).toEqual([])
})
