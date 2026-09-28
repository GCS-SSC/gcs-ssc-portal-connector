import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ authorized: vi.fn(), portal: vi.fn() }))
vi.mock('../server/authorization.ts', () => ({ authorizedWrite: state.authorized }))
vi.mock('../server/portal-context.ts', () => ({ clientForAgency: state.portal }))

import { listIntakes, manageIntake } from '../server/intakes.ts'

const stream = { id: 'S-ABCDE', sourceSystem: 'gcs-ssc', nameEn: 'Stream', nameFr: 'Volet' }
const otherStream = { id: 'S-BCDEF', sourceSystem: 'other', nameEn: 'Other', nameFr: 'Autre' }
const draft = { id: 'D-ABCDE', streamId: stream.id, nameEn: 'Apply', nameFr: 'Demande',
  startDate: '2027-01-01', endDate: '2027-12-31', sourceSystem: 'gcs-ssc-intake',
  foreignSystemId: '123', published: false, surveyId: null, surveyRevision: null }
const client = {
  structure: vi.fn(), surveys: vi.fn(), survey: vi.fn(), createCall: vi.fn(), updateCall: vi.fn(),
  attachCallSurvey: vi.fn(), publishCall: vi.fn(), withdrawCall: vi.fn(), deleteCall: vi.fn()
}
const context = (body: unknown) => ({ params: { agencyId: '1' }, readBody: async () => body }) as never
const input = { streamId: stream.id, nameEn: 'Apply', nameFr: 'Demande',
  startDate: '2027-01-01', endDate: '2027-12-31' }

beforeEach(() => {
  vi.clearAllMocks()
  state.authorized.mockResolvedValue(undefined)
  state.portal.mockResolvedValue({ agencyId: '1', client })
  client.structure.mockResolvedValue({ streams: [stream, otherStream], calls: [draft] })
  client.surveys.mockResolvedValue({ surveys: [] })
  client.createCall.mockResolvedValue('D-NEWAB')
  client.updateCall.mockResolvedValue('D-ABCDE')
  client.survey.mockResolvedValue({ revision: 1, definition: {
    schemaVersion: 1, title: { en: 'Application', fr: 'Demande' },
    questions: [{ id: 'name', type: 'text', label: { en: 'Name', fr: 'Nom' }, required: true, maxLength: 200 }]
  } })
})

describe('intake opportunity management', () => {
  it('lists only intake calls in GCS streams', async () => {
    client.structure.mockResolvedValue({ streams: [stream, otherStream], calls: [draft,
      { ...draft, id: 'D-BCDEF', sourceSystem: 'other' },
      { ...draft, id: 'D-CDEFG', streamId: otherStream.id }] })
    expect((await listIntakes(context(null))).intakes.map((item) => item.id)).toEqual([draft.id])
  })

  it('creates a draft with a stable idempotency identity and reuses it on retry', async () => {
    const body = { action: 'create', requestKey: '99734eac-0cd1-4136-9134-d07af2bfb256', ...input }
    expect(await manageIntake(context(body))).toEqual({ intakeId: 'D-NEWAB' })
    const created = client.createCall.mock.calls[0]![0]
    expect(created).toMatchObject({ ...input, sourceSystem: 'gcs-ssc-intake' })
    expect(created.foreignSystemId).toMatch(/^[1-9]\d+$/)
    client.structure.mockResolvedValue({ streams: [stream], calls: [{ ...draft, foreignSystemId: created.foreignSystemId }] })
    expect(await manageIntake(context(body))).toEqual({ intakeId: draft.id })
    expect(client.createCall).toHaveBeenCalledTimes(1)
    client.structure.mockResolvedValue({ streams: [stream, otherStream],
      calls: [{ ...draft, streamId: otherStream.id, foreignSystemId: created.foreignSystemId }] })
    await expect(manageIntake(context(body))).rejects.toThrow('another Stream')
  })

  it('rejects a foreign or published intake before changing it', async () => {
    await expect(manageIntake(context({ action: 'update', intakeId: 'D-BCDEF', ...input })))
      .rejects.toMatchObject({ code: 'GCS_PORTAL_INTAKE_UNAVAILABLE', statusCode: 404,
        localizedMessage: { en: 'The intake opportunity is unavailable in this agency.',
          fr: 'Cet appel de demandes est inaccessible dans cet organisme gouvernemental.' } })
    client.structure.mockResolvedValue({ streams: [stream], calls: [{ ...draft, published: true }] })
    await expect(manageIntake(context({ action: 'update', intakeId: draft.id, ...input })))
      .rejects.toThrow('Withdraw')
    expect(client.updateCall).not.toHaveBeenCalled()
  })

  it('rejects invalid dates and a Stream outside this agency before creating', async () => {
    const base = { action: 'create', requestKey: '99734eac-0cd1-4136-9134-d07af2bfb256', ...input }
    await expect(manageIntake(context({ ...base, endDate: '2026-12-31' })))
      .rejects.toMatchObject({ code: 'GCS_PORTAL_INTAKE_INVALID_INPUT', statusCode: 400,
        localizedMessage: { fr: 'Vérifiez les renseignements de l’appel et réessayez.' } })
    await expect(manageIntake(context({ ...base, startDate: '2027-02-31' }))).rejects.toThrow()
    await expect(manageIntake(context({ ...base, streamId: otherStream.id }))).rejects.toThrow('Choose a GCS stream')
    expect(client.createCall).not.toHaveBeenCalled()
  })

  it('requires a saved form before publishing and withdraws a published intake', async () => {
    await expect(manageIntake(context({ action: 'publish', intakeId: draft.id })))
      .rejects.toThrow('Create and save')
    client.structure.mockResolvedValue({ streams: [stream], calls: [{ ...draft, surveyId: 'V-ABCDE', surveyRevision: 1 }] })
    expect(await manageIntake(context({ action: 'publish', intakeId: draft.id })))
      .toEqual({ intakeId: draft.id, published: true })
    expect(client.publishCall).toHaveBeenCalledWith(draft.id)
    client.structure.mockResolvedValue({ streams: [stream], calls: [{ ...draft, published: true }] })
    expect(await manageIntake(context({ action: 'withdraw', intakeId: draft.id })))
      .toEqual({ intakeId: draft.id, published: false })
    expect(client.withdrawCall).toHaveBeenCalledWith(draft.id)
  })

  it('does not call the portal when current Agency Manager authorization fails', async () => {
    state.authorized.mockRejectedValueOnce(new Error('Forbidden'))
    await expect(manageIntake(context({ action: 'delete', intakeId: draft.id })))
      .rejects.toThrow('Forbidden')
    expect(client.structure).not.toHaveBeenCalled()
    expect(client.deleteCall).not.toHaveBeenCalled()
  })
})
