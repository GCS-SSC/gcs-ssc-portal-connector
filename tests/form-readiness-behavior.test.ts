import { describe, expect, it } from 'vitest'
import type { AdvancedSurvey } from '@gcs-ssc/survey'
import { formPublicationIssues } from '../server/form-readiness.ts'
import { activityConfig, budgetConfig } from './fixtures/grant-forms.ts'

const bilingual = { en: 'Project', fr: 'Projet' }
const survey = (): AdvancedSurvey => ({ schemaVersion: 4, title: { ...bilingual },
  questions: [{ id: 'name', type: 'text', label: { ...bilingual }, required: false, maxLength: 100 }],
  pages: [{ id: 'page', title: { ...bilingual }, questionIds: ['name'], groups: [], branches: [] }] })
const withQuestions = (questions: AdvancedSurvey['questions']): AdvancedSurvey => ({ ...survey(), questions })

describe('publication readiness at authoring boundaries', () => {
  it('allows omitted or empty optional introductions and help text', () => {
    const form = survey()
    expect(formPublicationIssues(form)).toEqual([])
    form.description = { en: ' ', fr: '\n' }
    form.questions[0]!.hint = { en: '', fr: '' }
    form.pages[0]!.description = { en: '', fr: '' }
    expect(formPublicationIssues(form)).toEqual([])
  })

  it('requires a bilingual title, page heading, question label and at least one question', () => {
    const form = survey()
    form.title.en = ' '
    form.pages[0]!.title.fr = ' '
    form.questions[0]!.label.fr = ''
    expect(formPublicationIssues(form)).toEqual(['Form title', 'Page heading', 'Question label'])
    form.questions = []
    expect(formPublicationIssues(form)).toEqual(['Form title', 'At least one question', 'Page heading'])
  })

  it('checks nested section headings and instructions and deduplicates repeated issues', () => {
    const form = survey()
    form.pages[0]!.groups = [{ id: 'outer', title: { en: 'Section', fr: '' },
      description: { en: '', fr: 'Instructions' }, questionIds: [], groups: [
        { id: 'inner', title: { en: '', fr: 'Sous-section' }, description: { en: 'Instructions', fr: '' }, questionIds: ['name'], groups: [] }
      ] }]
    expect(formPublicationIssues(form)).toEqual(['Section heading', 'Section instructions'])
    form.pages[0]!.groups = [{ id: 'ready', title: { ...bilingual }, description: { en: '', fr: '' }, questionIds: ['name'], groups: [] }]
    expect(formPublicationIssues(form)).toEqual([])
  })

  it.each([
    { costItems: [], fiscalYears: budgetConfig().fiscalYears },
    { costItems: budgetConfig().costItems, fiscalYears: [] },
    { costItems: [], fiscalYears: [] }
  ])('requires selectable cost items and fiscal years before publishing a budget', partial => {
    const form = withQuestions([{ id: 'budget', type: 'budget', label: { ...bilingual }, required: true,
      config: { ...budgetConfig(), ...partial } }])
    expect(formPublicationIssues(form)).toEqual(['Budget cost items and fiscal years'])
  })

  it('accepts a budget with cost items and fiscal years', () => {
    expect(formPublicationIssues(withQuestions([{ id: 'budget', type: 'budget', label: { ...bilingual }, required: true,
      config: budgetConfig() }]))).toEqual([])
  })

  it.each([
    { requireOutcomes: true, requireResponsibleParties: false },
    { requireOutcomes: false, requireResponsibleParties: true },
    { requireOutcomes: true, requireResponsibleParties: true }
  ])('requires available choices for each mandatory activity selection: %j', flags => {
    expect(formPublicationIssues(withQuestions([{ id: 'activities', type: 'activities', label: { ...bilingual }, required: true,
      config: { ...activityConfig(), ...flags, outcomes: [], responsibleParties: [] } }]))).toEqual(['Activity selection options'])
  })

  it('allows empty activity selections when optional and accepts required selections when configured', () => {
    expect(formPublicationIssues(withQuestions([{ id: 'activities', type: 'activities', label: { ...bilingual }, required: false,
      config: { ...activityConfig(), requireOutcomes: false, requireResponsibleParties: false, outcomes: [], responsibleParties: [] } }]))).toEqual([])
    expect(formPublicationIssues(withQuestions([{ id: 'activities', type: 'activities', label: { ...bilingual }, required: true,
      config: { ...activityConfig(), requireOutcomes: true, requireResponsibleParties: true } }]))).toEqual([])
  })
})
