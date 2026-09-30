import type { AdvancedGroup, AdvancedSurvey } from '@gcs-ssc/survey'
import { computedTemplateReady } from '../shared/form-localization.ts'

type BilingualText = { en: string; fr: string }

const complete = (value: BilingualText) => Boolean(value.en.trim() && value.fr.trim())
const completeIfProvided = (value?: BilingualText) => !value || (
  !value.en.trim() && !value.fr.trim()
) || complete(value)

/** The portal must never receive a newly published form with partial translations. */
export const formPublicationIssues = (survey: AdvancedSurvey): string[] => {
  const issues: string[] = []
  if (!complete(survey.title)) issues.push('Form title')
  if (!completeIfProvided(survey.description)) issues.push('Form introduction')
  if (!survey.questions.length) issues.push('At least one question')

  const visitGroups = (groups: AdvancedGroup[]) => {
    for (const group of groups) {
      if (!complete(group.title)) issues.push('Section heading')
      if (!completeIfProvided(group.description)) issues.push('Section instructions')
      visitGroups(group.groups)
    }
  }
  for (const page of survey.pages) {
    if (!complete(page.title)) issues.push('Page heading')
    if (!completeIfProvided(page.description)) issues.push('Page instructions')
    visitGroups(page.groups)
  }
  for (const question of survey.questions) {
    if (!complete(question.label)) issues.push('Question label')
    if (!completeIfProvided(question.hint)) issues.push('Question help text')
    if (question.type === 'budget' && (!question.config.costItems.length || !question.config.fiscalYears.length)) issues.push('Budget cost items and fiscal years')
    if (question.type === 'activities' && ((question.config.requireOutcomes && !question.config.outcomes.length)
      || (question.config.requireResponsibleParties && !question.config.responsibleParties.length))) issues.push('Activity selection options')
    if (question.type === 'select') {
      for (const option of question.options) if (!complete(option.label)) issues.push('Choice label')
    } else if (question.type === 'table') {
      for (const column of question.columns) if (!complete(column.label)) issues.push('Table column heading')
    } else if (question.type === 'computed' && !computedTemplateReady(question.template, question.sourceIds)) {
      issues.push('Calculated value template must reference selected fields without untranslated text')
    }
  }
  return [...new Set(issues)]
}
