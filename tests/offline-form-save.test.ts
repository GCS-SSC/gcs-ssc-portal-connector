import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: new Map<string, { id: string; revision: number }>(),
  enqueue: vi.fn(), portal: vi.fn() }))
const query = (id?: string) => ({
  select: () => query(id), selectAll: () => query(id), where: (_column: string, _op: string, value: string) => query(value),
  forUpdate: () => query(id), executeTakeFirst: async () => state.rows.get(id ?? ''),
  execute: async () => undefined
})
const db = {
  selectFrom: () => query(),
  insertInto: () => ({ values: (value: { id: string; revision: number }) => ({ execute: async () => {
    state.rows.set(value.id, { id: value.id, revision: value.revision })
  } }) }),
  updateTable: () => ({ set: (value: { revision: number }) => ({
    where: (_column: string, _op: string, id: string) => ({ where: () => ({ execute: async () => {
      state.rows.set(id, { id, revision: value.revision })
    } }) })
  }) })
}
vi.mock('../server/authorization.ts', () => ({
  agencyIdFromContext: () => '1', authorizedWrite: async (_context: unknown, action: (transaction: typeof db) => Promise<unknown>) => action(db)
}))
vi.mock('../server/db.ts', () => ({ asConnectorDb: () => db }))
vi.mock('../server/portal-context.ts', () => ({ clientForAgency: state.portal }))
vi.mock('../server/operations.ts', () => ({ enqueueForm: state.enqueue }))

import { manageForm } from '../server/forms.ts'

const definition = { schemaVersion: 3, title: { en: 'Application', fr: 'Demande' },
  questions: [{ id: 'question_1', type: 'text', label: { en: 'Name', fr: 'Nom' }, required: false, maxLength: 500 }],
  pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' },
    questionIds: ['question_1'], groups: [], branches: [] }] }
const context = (body: unknown) => ({ params: { agencyId: '1' }, readBody: async () => body }) as never

beforeEach(() => { state.rows.clear(); vi.clearAllMocks() })

describe('offline form save', () => {
  it('creates a local draft record from form details and queues its first complete revision later', async () => {
    const created = await manageForm(context({ action: 'createDraft', title: definition.title,
      introduction: { en: 'Introduction', fr: 'Introduction' } })) as { survey: { id: string; revision: number }; queued: boolean }
    expect(created).toMatchObject({ survey: { revision: 0 }, queued: false })
    expect(state.rows.get(created.survey.id)?.revision).toBe(0)
    expect(state.enqueue).not.toHaveBeenCalled()
    expect(state.portal).not.toHaveBeenCalled()

    const saved = await manageForm(context({ action: 'save', surveyId: created.survey.id,
      expectedRevision: 0, definition })) as { survey: { id: string; revision: number }; queued: boolean }
    expect(saved).toMatchObject({ survey: { id: created.survey.id, revision: 1 }, queued: true })
    expect(state.enqueue).toHaveBeenCalledWith(db, '1', created.survey.id)
  })

  it('requires bilingual details before creating a local draft', async () => {
    await expect(manageForm(context({ action: 'createDraft', title: { en: 'Application', fr: '' } }))).rejects.toThrow()
    await expect(manageForm(context({ action: 'createDraft', title: definition.title,
      introduction: { en: 'Introduction', fr: '' } }))).rejects.toThrow()
    expect(state.rows.size).toBe(0)
    expect(state.enqueue).not.toHaveBeenCalled()
  })

  it('saves and queues a new form without loading a Portal connection', async () => {
    const result = await manageForm(context({ action: 'save', definition })) as { survey: { id: string; revision: number }; queued: boolean }
    expect(result).toMatchObject({ survey: { revision: 1 }, queued: true })
    expect(result.survey.id).toMatch(/^V-[A-HJKMNP-Z2-9]{12}$/)
    expect(state.enqueue).toHaveBeenCalledWith(db, '1', result.survey.id)
    expect(state.portal).not.toHaveBeenCalled()
  })

  it('rejects a stale local revision before adding another queue item', async () => {
    const saved = await manageForm(context({ action: 'save', definition })) as { survey: { id: string } }
    await expect(manageForm(context({ action: 'save', surveyId: saved.survey.id,
      expectedRevision: 2, definition }))).rejects.toThrow('latest saved form revision')
    expect(state.enqueue).toHaveBeenCalledTimes(1)
  })
})
