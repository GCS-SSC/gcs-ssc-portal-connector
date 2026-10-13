import type { AdvancedGroup, AdvancedQuestion, AdvancedSurvey, FieldRule } from '@gcs-ssc/survey'
import { z } from 'zod'
import type { fieldRuleMessages } from '../i18n/field-rules'

export type RuleSourceQuestion = {
  id: string
  label: string
  type: AdvancedQuestion['type']
  options?: { value: string; label: string }[]
}
export type RuleSubject = AdvancedQuestion | Extract<AdvancedQuestion, { type: 'table' }>['columns'][number]
const numericValue = (value: string) => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Number.isFinite(Number(value))
const validSelection = (ids: string[]) => ids.length > 0 && ids.length <= 20 && new Set(ids).size === ids.length

export const repeatFieldRuleSources = (survey: AdvancedSurvey, sourceId: string, locale: 'en' | 'fr'): RuleSourceQuestion[] => {
  const placements: { id: string; scope: string[] }[] = []
  const place = (ids: string[], scope: string[]) => placements.push(...ids.map(id => ({ id, scope })))
  const visit = (groups: AdvancedGroup[], ancestors: string[]) => {
    for (const group of groups) {
      const scope = group.repeatFor ? [...ancestors, group.repeatFor] : ancestors
      place(group.questionIds, scope)
      visit(group.groups, scope)
    }
  }
  for (const page of survey.pages) { place(page.questionIds, []); visit(page.groups, []) }
  const ownerScope = placements.find(item => item.id === sourceId)?.scope
  if (!ownerScope) return []
  // A reused source can appear under another repeat parent; only its own direct repeat scope qualifies.
  const ids = placements.filter(item => item.scope.length === ownerScope.length + 1 && item.scope.at(-1) === sourceId
    && ownerScope.every((part, index) => item.scope[index] === part)).map(item => item.id)
  return survey.questions.filter(question => ids.includes(question.id) && ['text', 'textarea', 'email', 'number', 'date', 'select'].includes(question.type))
    .map(question => ({ id: question.id, type: question.type, label: question.label[locale] || question.id }))
}

export const comparisonCompatible = (type: AdvancedQuestion['type'], sourceType: AdvancedQuestion['type']) =>
  type === 'number' || type === 'date'
    ? sourceType === type
    : ['text', 'textarea', 'email'].includes(type) && ['text', 'textarea', 'email'].includes(sourceType)

export const fieldRuleSupportsType = (rule: FieldRule, type: AdvancedQuestion['type']) => {
  if (rule.kind === 'compare') return ['number', 'date'].includes(type) || ['text', 'textarea', 'email'].includes(type) && ['equals', 'notEquals'].includes(rule.operator)
  if (rule.kind === 'length' || rule.kind === 'format') return type === 'text' || type === 'textarea'
  if (rule.kind === 'precision') return type === 'number'
  if (rule.kind === 'choice') return ['select', 'checkboxes', 'multiselect'].includes(type)
  if (rule.kind === 'count') return ['checkboxes', 'multiselect', 'list', 'repeat', 'table', 'budget', 'activities'].includes(type)
  if (rule.kind === 'unique') return ['list', 'repeat', 'table'].includes(type)
  if (rule.kind === 'total') return type === 'table'
  return type !== 'computed'
}

export const fieldRuleSourceIds = (rule: FieldRule): string[] => {
  if (rule.kind === 'compare' || rule.kind === 'total') return rule.target.kind === 'question' ? [rule.target.questionId] : []
  if (rule.kind === 'required') return rule.when.conditions.map(condition => condition.questionId)
  if (rule.kind === 'group' || rule.kind === 'unique') return rule.questionIds ?? []
  return []
}

export const fieldRuleCeiling = (question: RuleSubject): number => {
  if ((question.type === 'text' || question.type === 'textarea') && 'maxLength' in question) return question.maxLength
  if (question.type === 'text') return 500
  if (question.type === 'checkboxes' || question.type === 'multiselect') return question.options.length
  if (question.type === 'list' || question.type === 'repeat') return question.maxItems
  if (question.type === 'table') return question.maxRows
  if (question.type === 'budget' || question.type === 'activities') return question.config.maxRows
  return 5000
}

export const fieldRuleError = (question: RuleSubject, rule: FieldRule, sources: RuleSourceQuestion[], repeatSources: RuleSourceQuestion[] = []): keyof typeof fieldRuleMessages.en | undefined => {
  if (!fieldRuleSupportsType(rule, question.type)) return 'fieldRuleTypeInvalid'
  if (rule.kind === 'compare') {
    if (rule.target.kind === 'question' || rule.target.kind === 'today') {
      if (rule.target.offsetDays !== undefined && (!Number.isInteger(rule.target.offsetDays) || Math.abs(rule.target.offsetDays) > 36500)) return 'fieldRuleOffsetInvalid'
    }
    if (rule.target.kind === 'today') return question.type === 'date' ? undefined : 'fieldRuleDateInvalid'
    if (rule.target.kind === 'question' || rule.target.kind === 'column') {
      const sourceId = rule.target.kind === 'question' ? rule.target.questionId : rule.target.columnId
      const source = sources.find(item => item.id === sourceId)
      return !source || !comparisonCompatible(question.type, source.type) ? 'fieldRuleSourceInvalid' : undefined
    }
    const value = rule.target.value
    if (!value.trim()) return 'fieldRuleValueRequired'
    if (question.type === 'number' && !numericValue(value)) return 'fieldRuleNumberInvalid'
    if (question.type === 'email' && !z.email().safeParse(value).success) return 'fieldRuleEmailInvalid'
    if (question.type === 'date') {
      const date = new Date(value)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'fieldRuleDateInvalid'
    }
    return undefined
  }
  if (rule.kind === 'format') return undefined
  if (rule.kind === 'choice') return !('options' in question) || !question.options.some(option => option.value === rule.value) ? 'fieldRuleChoiceInvalid' : undefined
  if (rule.kind === 'group') {
    const ids = new Set(rule.questionIds)
    return !validSelection(rule.questionIds) || ids.size < 2 || !ids.has(question.id) || [...ids].some(id => id !== question.id && !sources.some(source => source.id === id && source.type !== 'computed'))
      ? 'fieldRuleGroupInvalid' : undefined
  }
  if (rule.kind === 'unique') {
    if (question.type === 'repeat') return !rule.questionIds || !validSelection(rule.questionIds) || rule.questionIds.some(id => !repeatSources.some(source => source.id === id)) ? 'fieldRuleUniqueInvalid' : undefined
    if (question.type === 'table') return rule.columnIds && (!validSelection(rule.columnIds) || rule.columnIds.some(id => !question.columns.some(column => column.id === id))) ? 'fieldRuleColumnsRequired' : undefined
    return undefined
  }
  if (rule.kind === 'total') {
    if (question.type !== 'table' || !validSelection(rule.columnIds) || rule.columnIds.some(id => !question.columns.some(column => column.id === id && column.type === 'number'))) return 'fieldRuleColumnsRequired'
    const target = rule.target
    if (target.kind === 'question') return !sources.some(source => source.id === target.questionId && source.type === 'number') ? 'fieldRuleSourceInvalid' : undefined
    return !numericValue(target.value) ? 'fieldRuleNumberInvalid' : undefined
  }
  if (rule.kind === 'precision') return !Number.isInteger(rule.decimalPlaces) || rule.decimalPlaces < 0 || rule.decimalPlaces > 20
    ? 'fieldRulePrecisionInvalid' : undefined
  if (rule.kind === 'required') {
    if (!rule.when.conditions.length) return 'fieldRuleConditionRequired'
    return rule.when.conditions.some(condition => {
      const source = sources.find(item => item.id === condition.questionId)
      return !source || ('value' in condition && (!condition.value.trim()
        || (condition.operator === 'greaterThan' || condition.operator === 'lessThan') && (source.type !== 'number' || !numericValue(condition.value))
        || source.options && !source.options.some(option => option.value === condition.value)))
    }) ? 'fieldRuleConditionInvalid' : undefined
  }
  const ceiling = fieldRuleCeiling(question)
  if (rule.min === undefined && rule.max === undefined) return 'fieldRuleBoundsRequired'
  if ([rule.min, rule.max].some(value => value !== undefined && (!Number.isInteger(value) || value < 0 || value > ceiling))) return 'fieldRuleBoundsInvalid'
  return rule.min !== undefined && rule.max !== undefined && rule.min > rule.max ? 'fieldRuleBoundsOrder' : undefined
}
