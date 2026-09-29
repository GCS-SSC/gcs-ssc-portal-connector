import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ authorized: vi.fn(), portal: vi.fn() }))
vi.mock('../server/authorization.ts', () => ({ authorizedWrite: state.authorized }))
vi.mock('../server/portal-context.ts', () => ({ clientForAgency: state.portal }))
import { manageOpportunity, listOpportunityForms, getOpportunityForm } from '../server/opportunities.ts'

const projection = { sourceSystem: 'gcs-ssc', foreignSystemId: '44', opportunityId: '44',
  active: true, editable: true, agency: { id: '1', nameEn: 'Agency', nameFr: 'Organisme' },
  program: { id: '2', nameEn: 'Program', nameFr: 'Programme' },
  stream: { id: '3', nameEn: 'Stream', nameFr: 'Volet' },
  nameEn: 'Opportunity', nameFr: 'Occasion', startDate: '2027-01-01', endDate: '2027-12-31' }
const form = { surveyId: 'V-ABCDE', revision: 1 }
const call = { id: 'D-ABCDE', sourceSystem: 'gcs-ssc-opportunity', foreignSystemId: '44',
  streamId: 'S-ABCDE', published: false, forms: [form] }
const client = {
  structure: vi.fn(), surveys: vi.fn(), survey: vi.fn(), createProgram: vi.fn(), createStream: vi.fn(),
  createCall: vi.fn(), updateCall: vi.fn(), createSurvey: vi.fn(), updateSurvey: vi.fn(),
  attachCallForms: vi.fn(), publishCall: vi.fn(), withdrawCall: vi.fn()
}
const context = (body: unknown, agencyId = '1') => ({
  params: { agencyId, streamId: '3', opportunityId: '44', formId: 'V-ABCDE' },
  entity: { agencyId: '1', ownerId: '44', scope: { type: 'entity', agencyId: '1', path: [] } },
  auth: { userAbilities: { authorize: () => true } },
  writeAuthorization: { projectFundingOpportunity: vi.fn().mockResolvedValue(projection) },
  readBody: async () => body
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  state.authorized.mockImplementation(async (input, operation) => await operation({}))
  state.portal.mockResolvedValue({ connection: { portal_agency_id: 'A-ABCDE' }, client })
  client.structure.mockResolvedValue({ programs: [{ id: 'P-ABCDE', sourceSystem: 'gcs-ssc', foreignSystemId: '2' }],
    streams: [{ id: 'S-ABCDE', sourceSystem: 'gcs-ssc', foreignSystemId: '3' }], calls: [call] })
  client.surveys.mockResolvedValue({ surveys: [{ id: 'V-ABCDE', revision: 1,
    title: { en: 'Project', fr: 'Projet' } }] })
  client.survey.mockResolvedValue({ revision: 1, definition: { schemaVersion: 1,
    title: { en: 'Project', fr: 'Projet' }, questions: [{ id: 'name', type: 'text',
      label: { en: 'Name', fr: 'Nom' }, required: true, maxLength: 200 }] } })
})

describe('GCS Funding Opportunity portal forms', () => {
  it('shows only forms attached to the authorized opportunity', async () => {
    expect((await listOpportunityForms(context(null))).forms).toEqual([{ ...form,
      title: { en: 'Project', fr: 'Projet' } }])
    expect((await getOpportunityForm(context(null))).survey.revision).toBe(1)
    await expect(listOpportunityForms(context(null, '2'))).rejects.toThrow('unavailable in this agency')
  })

  it('rejects a sibling form and a mismatched agency before publication', async () => {
    await expect(manageOpportunity(context({ action: 'saveForms', forms: [
      { surveyId: 'V-BCDEF', revision: 1 }
    ] }))).rejects.toThrow('already attached')
    await expect(manageOpportunity(context({ action: 'publish' }, '2')))
      .rejects.toThrow('unavailable in this agency')
    expect(client.attachCallForms).not.toHaveBeenCalled()
    expect(client.publishCall).not.toHaveBeenCalled()
  })

  it('publishes all attached forms only while the GCS opportunity is active', async () => {
    await manageOpportunity(context({ action: 'publish' }))
    expect(client.publishCall).toHaveBeenCalledWith('D-ABCDE')
    const inactive = context({ action: 'publish' }) as unknown as { writeAuthorization: { projectFundingOpportunity: ReturnType<typeof vi.fn> } }
    inactive.writeAuthorization.projectFundingOpportunity.mockResolvedValue({ ...projection, active: false })
    await expect(manageOpportunity(inactive as never)).rejects.toThrow('Activate')
  })
})
