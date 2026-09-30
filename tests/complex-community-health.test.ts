import { describe, expect, it } from 'vitest'
import { computedValue, designerSurveySchema, resolveAdvancedSurvey, validateSurveyAnswers } from '@gcs-ssc/survey'
import { complexCommunityHealthForm, complexCommunityHealthAnswers } from './fixtures/complex-community-health'

const profile = (pathway = 'summary') => ({ project_name: 'Northern Community Health', summary: 'Community-led access to health advice.', contact_email: 'health@example.org', participant_count: '0', start_date: '2026-10-01', pathway, delivery_region: pathway === 'summary' ? 'remote' : 'north', services: '["advice"]', populations: '["youth","seniors"]', declaration: 'confirmed' })
describe('published complex community health fixture', () => {
  it('uses all supported provider types, bilingual catalogs and versioned hierarchy', () => {
    const definition = complexCommunityHealthForm()
    expect(designerSurveySchema.safeParse(definition).success).toBe(true)
    expect([...new Set(definition.questions.map(question => question.type))].sort()).toEqual(['activities', 'budget', 'checkboxes', 'computed', 'date', 'email', 'list', 'multiselect', 'number', 'repeat', 'select', 'table', 'text', 'textarea'])
    expect(definition.attachments?.enabled).toBe(true)
    expect(definition.pages).toHaveLength(4)
    for (const question of definition.questions) expect(question.label.en && question.label.fr).toBeTruthy()
    const table = definition.questions.find(question => question.type === 'table')!
    expect(table.type === 'table' && table.columns.map(column => column.type)).toEqual(['text', 'number', 'date'])
    expect(table.type === 'table' && 'totals' in table && table.totals).toBe('both')
  })
  it('summary pathway skips detailed required pages and preserves valid numeric zero', () => {
    const definition = complexCommunityHealthForm()
    const answers = profile()
    const resolved = resolveAdvancedSurvey(definition, answers)
    expect(resolved.pages.map(page => page.id)).toEqual(['profile', 'confirmation'])
    const validated = validateSurveyAnswers(definition, answers, 'submit')
    expect(validated.errors).toEqual({})
    expect(validated.answers.participant_count).toBe('0')
  })
  it('detailed pathway enforces repeat, table and grant answers; hidden training remains optional', () => {
    const definition = complexCommunityHealthForm()
    const resolved = resolveAdvancedSurvey(definition, profile('full'))
    expect(resolved.pages.map(page => page.id)).toEqual(['profile', 'locations', 'plan', 'confirmation'])
    const validated = validateSurveyAnswers(definition, profile('full'), 'submit')
    for (const id of ['partners', 'sites', 'milestones', 'budget', 'activities']) expect(validated.errors[id]).toBeDefined()
    expect(validated.errors.training_note).toBeUndefined()
  })
  it('submits nested repeated rows and exact grant contributions, then removes skipped evidence on branch change', () => {
    const definition = complexCommunityHealthForm()
    const answers = complexCommunityHealthAnswers()
    const submitted = validateSurveyAnswers(definition, answers, 'submit')
    expect(submitted.errors).toEqual({})
    expect(submitted.answers['clinic_capacity@r_site@r_clinic']).toBe('0')
    expect(submitted.answers.milestones).toContain('"sessions":"0"')
    expect(submitted.answers.project_reference).toBeUndefined()
    const resolved = resolveAdvancedSurvey(definition, answers)
    const active = new Set(resolved.questionIds)
    const questions = new Map(definition.questions.map(question => [question.id, question]))
    const projectReference = questions.get('project_reference')!
    const clinicReference = questions.get('clinic_reference')!
    if (projectReference.type !== 'computed' || clinicReference.type !== 'computed') throw new Error('Fixture computed questions missing')
    expect(computedValue(projectReference, [], answers, active, questions)).toBe('Northern Community Health — 0')
    expect(computedValue(clinicReference, ['r_site', 'r_clinic'], answers, active, questions)).toBe('Northern Community Centre — 2026-10-15')
    const switched = resolveAdvancedSurvey(definition, { ...answers, pathway: 'summary', delivery_region: 'remote' })
    const summary = validateSurveyAnswers(definition, switched.answers, 'submit')
    expect(summary.errors).toEqual({})
    for (const key of ['sites', 'partners', 'budget', 'activities', 'site_name@r_site', 'clinic_date@r_site@r_clinic']) expect(summary.answers[key]).toBeUndefined()
  })

})
