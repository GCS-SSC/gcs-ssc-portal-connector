import type { AdvancedGroup, AdvancedSurvey, SurveyCondition } from '@gcs-ssc/survey'

type Choice = { value: string; label: { en: string; fr: string } }
/**
 * Update authored choices and remove references that would invalidate the definition.
 * @param definition - Editable form definition.
 * @param questionId - Choice question being edited.
 * @param options - Complete replacement catalog retaining stable IDs.
 */
export const updateFormChoices = (definition: AdvancedSurvey, questionId: string, options: Choice[]) => {
  const question = definition.questions.find(item => item.id === questionId)
  if (!question || !('options' in question)) return
  const removed = new Set(question.options.filter(item => !options.some(option => option.value === item.value)).map(item => item.value))
  question.options = options
  /**
   * Drop predicates referring to removed options, preserving remaining rules.
   * @param condition - Optional visibility or navigation condition.
   * @returns The remaining condition, or undefined when no predicates remain.
   */
  const cleanCondition = (condition?: SurveyCondition): SurveyCondition | undefined => {
    const conditions = condition?.conditions.filter(item => !(item.questionId === question.id && 'value' in item && removed.has(item.value)))
    return conditions?.length ? { ...condition!, conditions } : undefined
  }
  for (const other of definition.questions) {
    other.visibleWhen = cleanCondition(other.visibleWhen)
    if (other.type !== 'select' || !other.dependsOn) continue
    other.dependsOn.optionsByValue = Object.fromEntries(Object.entries(other.dependsOn.optionsByValue).flatMap(([value, mapped]) => {
      if (other.dependsOn!.questionId === question.id && removed.has(value)) return []
      const retained = other.id === question.id ? mapped.flatMap(item => options.find(option => option.value === item.value) ?? []) : mapped
      return retained.length ? [[value, retained]] : []
    }))
  }
  /**
   * Preserve nested groups while cleaning their conditional references.
   * @param groups - Groups in the current page or parent group.
   */
  const cleanGroups = (groups: AdvancedGroup[]) => {
    for (const group of groups) {
      group.visibleWhen = cleanCondition(group.visibleWhen)
      cleanGroups(group.groups)
    }
  }
  for (const page of definition.pages) {
    cleanGroups(page.groups)
    page.branches = page.branches.flatMap(branch => {
      const when = cleanCondition(branch.when)
      return when ? [{ ...branch, when }] : []
    })
  }
}
