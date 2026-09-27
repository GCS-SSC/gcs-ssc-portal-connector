import { surveyV3Schema, type AdvancedSurvey } from '@gcs-ssc/survey'
import { z } from 'zod'

// A draft may be incomplete and fail publication validation, but it must still be safe to render.
const bilingual = z.object({ en: z.string(), fr: z.string() })
const condition = z.object({ match: z.enum(['all', 'any']), conditions: z.array(z.object({
  questionId: z.string(), operator: z.string(), value: z.string().optional()
})) })
const group: z.ZodType<unknown> = z.lazy(() => z.object({
  id: z.string(), title: bilingual, description: bilingual.optional(), questionIds: z.array(z.string()),
  groups: z.array(group), visibleWhen: condition.optional(), repeatFor: z.string().optional()
}))
const questionBase = z.object({ id: z.string(), label: bilingual, hint: bilingual.optional(),
  required: z.boolean(), visibleWhen: condition.optional() })
const question = z.discriminatedUnion('type', [
  questionBase.extend({ type: z.literal('text'), maxLength: z.number() }),
  questionBase.extend({ type: z.literal('email') }),
  questionBase.extend({ type: z.literal('number') }),
  questionBase.extend({ type: z.literal('date') }),
  questionBase.extend({ type: z.literal('select'), options: z.array(z.object({ value: z.string(), label: bilingual })),
    dependsOn: z.object({ questionId: z.string(), optionsByValue: z.record(z.string(), z.array(z.object({
      value: z.string(), label: bilingual
    }))) }).optional() }),
  questionBase.extend({ type: z.literal('list'), maxItems: z.number() }),
  questionBase.extend({ type: z.literal('table'), maxRows: z.number(), columns: z.array(z.object({
    id: z.string(), label: bilingual, type: z.enum(['text', 'number', 'date']), required: z.boolean()
  })) }),
  questionBase.extend({ type: z.literal('computed'), template: z.string(), sourceIds: z.array(z.string()) })
])
const editableSurvey = z.object({
  schemaVersion: z.literal(3), title: bilingual, description: bilingual.optional(),
  questions: z.array(question), pages: z.array(z.object({
    id: z.string(), title: bilingual, description: bilingual.optional(), questionIds: z.array(z.string()),
    groups: z.array(group), branches: z.array(z.object({ when: condition, destination: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('end') }), z.object({ kind: z.literal('page'), pageId: z.string() })
    ]) })), next: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('end') }), z.object({ kind: z.literal('page'), pageId: z.string() })
    ]).optional()
  })).min(1)
})
const draftTab = z.enum(['edit', 'test', 'settings', 'publish'])
const draftScope = z.enum(['agreement', 'program', 'stream', 'organization'])

export type FormDraftSession = {
  formId: string
  revision: number
  definition: AdvancedSurvey
  saved: string
  selectedContainerId: string
  selectedQuestionId: string
  tab: 'edit' | 'test' | 'settings' | 'publish'
  publicationScope: 'agreement' | 'program' | 'stream' | 'organization'
  agreementId: string
  organizationId: string
  programId: string
  batchStreamId: string
  streamId: string
  startDate: string
  endDate: string
}

const key = (agencyId: string, kind: 'selection' | 'draft') => `gcs-ssc-portal-connector:forms:${agencyId}:${kind}`
const storage = () => {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage }
  catch { return undefined }
}

export const readFormSelection = (agencyId: string) => storage()?.getItem(key(agencyId, 'selection')) ?? null
export const writeFormSelection = (agencyId: string, id: string | null) => {
  try {
    if (id === null) storage()?.removeItem(key(agencyId, 'selection'))
    else storage()?.setItem(key(agencyId, 'selection'), id)
  } catch { /* Session storage may be unavailable in a private browser context. */ }
}
export const clearFormDraft = (agencyId: string) => {
  try { storage()?.removeItem(key(agencyId, 'draft')) }
  catch { /* Editing still works without session storage. */ }
}
export const writeFormDraft = (agencyId: string, draft: FormDraftSession) => {
  try { storage()?.setItem(key(agencyId, 'draft'), JSON.stringify(draft)) }
  catch { /* Editing still works without session storage. */ }
}
export const readFormDraft = (agencyId: string): FormDraftSession | null => {
  try {
    const value = storage()?.getItem(key(agencyId, 'draft'))
    if (!value) return null
    const draft: unknown = JSON.parse(value)
    if (!draft || typeof draft !== 'object') return null
    const record = draft as Partial<FormDraftSession>
    if (typeof record.formId !== 'string' || typeof record.saved !== 'string'
      || typeof record.revision !== 'number' || !record.definition
      || !draftTab.safeParse(record.tab).success || !draftScope.safeParse(record.publicationScope).success) return null
    // Complete saved forms use the authoritative schema. Partially edited drafts use a
    // structural subset that preserves empty fields while rejecting malformed nested data.
    if (!surveyV3Schema.safeParse(record.definition).success && !editableSurvey.safeParse(record.definition).success) return null
    return record as FormDraftSession
  } catch { return null }
}
