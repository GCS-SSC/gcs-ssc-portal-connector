import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ authorized: vi.fn(), portal: vi.fn() }))
vi.mock('../server/authorization.ts', () => ({ authorizedWrite: state.authorized }))
vi.mock('../server/portal-context.ts', () => ({ clientForAgency: state.portal }))

import { manageForm } from '../server/forms.ts'

const call = { id: 'D-ABCDE', streamId: 'S-ABCDE', sourceSystem: 'gcs-ssc-intake',
  published: false, surveyId: null, surveyRevision: null }
const client = {
  structure: vi.fn(), createSurvey: vi.fn(), updateSurvey: vi.fn(), attachCallSurvey: vi.fn(), survey: vi.fn()
}
const definition = { schemaVersion: 3, title: { en: 'Application', fr: 'Demande' },
  questions: [{ id: 'name', type: 'text', label: { en: 'Name', fr: 'Nom' }, required: true, maxLength: 200 }],
  pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' }, questionIds: ['name'], groups: [], branches: [] }] }
const context = (body: unknown) => ({ params: { agencyId: '1' }, readBody: async () => body }) as never

beforeEach(() => {
  vi.clearAllMocks()
  state.authorized.mockResolvedValue(undefined)
  state.portal.mockResolvedValue({ agencyId: '1', connection: {}, client })
  client.structure.mockResolvedValue({ streams: [{ id: 'S-ABCDE', sourceSystem: 'gcs-ssc' }], calls: [call] })
  client.createSurvey.mockResolvedValue({ id: 'V-ABCDE', revision: 1 })
  client.survey.mockResolvedValue({ id: 'V-ABCDE', revision: 1, definition })
})

describe('intake form attachment', () => {
  it('returns the saved form identity when attachment fails, then retries without creating another form', async () => {
    client.attachCallSurvey.mockRejectedValueOnce(new Error('Temporary portal failure'))
    expect(await manageForm(context({ action: 'save', intakeId: call.id, definition })))
      .toEqual({ survey: { id: 'V-ABCDE', revision: 1 }, attached: false })
    expect(client.createSurvey).toHaveBeenCalledTimes(1)
    expect(await manageForm(context({ action: 'attachIntakeForm', intakeId: call.id,
      surveyId: 'V-ABCDE', revision: 1 }))).toEqual({ attached: true })
    expect(client.createSurvey).toHaveBeenCalledTimes(1)
    expect(client.attachCallSurvey).toHaveBeenLastCalledWith(call.id, 'V-ABCDE', 1)
  })

  it('rejects a published intake and an intake outside this agency before saving', async () => {
    client.structure.mockResolvedValueOnce({ streams: [{ id: 'S-ABCDE', sourceSystem: 'gcs-ssc' }],
      calls: [{ ...call, published: true }] })
    await expect(manageForm(context({ action: 'save', intakeId: call.id, definition })))
      .rejects.toThrow('Withdraw')
    await expect(manageForm(context({ action: 'save', intakeId: 'D-BCDEF', definition })))
      .rejects.toThrow('unavailable')
    expect(client.createSurvey).not.toHaveBeenCalled()
  })

  it('refuses to attach a stale revision', async () => {
    client.survey.mockResolvedValueOnce({ id: 'V-ABCDE', revision: 2, definition })
    await expect(manageForm(context({ action: 'attachIntakeForm', intakeId: call.id,
      surveyId: 'V-ABCDE', revision: 1 }))).rejects.toThrow('latest')
    expect(client.attachCallSurvey).not.toHaveBeenCalled()
  })
})
