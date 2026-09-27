import { describe, expect, it } from 'vitest'
import type { AdvancedSurvey } from '@gcs-ssc/survey'
import { formPublicationIssues } from '../server/form-readiness.ts'

const readySurvey = (): AdvancedSurvey => ({
  schemaVersion: 3,
  title: { en: 'Report', fr: 'Rapport' },
  description: { en: 'Tell us about the project.', fr: 'Décrivez le projet.' },
  pages: [{ id: 'page_1', title: { en: 'Outcomes', fr: 'Résultats' },
    description: { en: 'This period only.', fr: 'Cette période seulement.' },
    questionIds: ['choice', 'table'], groups: [], branches: [] }],
  questions: [
    { id: 'choice', type: 'select', label: { en: 'Which area?', fr: 'Quel domaine?' },
      hint: { en: 'Choose one.', fr: 'Choisissez une option.' }, required: true,
      options: [{ value: 'health', label: { en: 'Health', fr: 'Santé' } }] },
    { id: 'table', type: 'table', label: { en: 'Expenses', fr: 'Dépenses' },
      required: false, maxRows: 10,
      columns: [{ id: 'amount', label: { en: 'Amount', fr: 'Montant' }, type: 'number', required: true }] }
  ]
})

describe('form publication readiness', () => {
  it('accepts complete bilingual content', () => {
    expect(formPublicationIssues(readySurvey())).toEqual([])
  })

  it('identifies untranslated help, instructions, choices, and table columns', () => {
    const survey = readySurvey()
    survey.description!.fr = ''
    survey.pages[0]!.description!.fr = ''
    survey.questions[0]!.hint!.fr = ''
    if (survey.questions[0]!.type === 'select') survey.questions[0]!.options[0]!.label.fr = ''
    if (survey.questions[1]!.type === 'table') survey.questions[1]!.columns[0]!.label.fr = ''
    expect(formPublicationIssues(survey)).toEqual([
      'Form introduction', 'Page instructions', 'Question help text', 'Choice label', 'Table column heading'
    ])
  })

  it('rejects language-specific prose in a shared calculated value template', () => {
    const survey = readySurvey()
    survey.questions.push({ id: 'computed', type: 'computed', label: { en: 'Total', fr: 'Total' },
      required: false, sourceIds: ['choice'], template: 'Selected: {{choice}}' })
    expect(formPublicationIssues(survey)).toContain('Calculated value template must reference selected fields without untranslated text')
    if (survey.questions[2]!.type === 'computed') survey.questions[2]!.template = '{{choice}} / 2'
    expect(formPublicationIssues(survey)).toEqual([])
  })

  it('requires calculated templates to reference selected source fields', () => {
    const survey = readySurvey()
    survey.questions.push({ id: 'computed', type: 'computed', label: { en: 'Total', fr: 'Total' },
      required: false, sourceIds: ['choice'], template: '42' })
    const issue = 'Calculated value template must reference selected fields without untranslated text'
    expect(formPublicationIssues(survey)).toContain(issue)
    if (survey.questions[2]!.type === 'computed') survey.questions[2]!.template = '{{table}}'
    expect(formPublicationIssues(survey)).toContain(issue)
    if (survey.questions[2]!.type === 'computed') survey.questions[2]!.template = '{{choice}}'
    expect(formPublicationIssues(survey)).toEqual([])
  })
})
