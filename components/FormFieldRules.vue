<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import type { FieldRule, SurveyCondition } from '@gcs-ssc/survey'
import { ExtensionButton, ExtensionCheckbox, ExtensionFormField, ExtensionInput, ExtensionSelect, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import { comparisonCompatible, fieldRuleCeiling, fieldRuleError, type RuleSourceQuestion, type RuleSubject } from '../shared/field-rules'
import FormCondition from './FormCondition.vue'

const props = defineProps<{ question: RuleSubject; questions: RuleSourceQuestion[]; repeatQuestions?: RuleSourceQuestion[]; scope?: 'question' | 'column'; locale: 'en' | 'fr'; disabled?: boolean }>()
const rules = defineModel<FieldRule[] | undefined>({ required: true })
const { t } = useExtensionI18n(messages)
const editorId = useId()
const ruleList = ref<HTMLOListElement | null>(null)
const addControls = ref<HTMLDivElement | null>(null)
const focusControl = (element: Element | null | undefined) => element?.querySelector<HTMLElement>('input:not([type="hidden"]):not([hidden]):not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus()
const fieldName = (index: number, part: string) => `${editorId}-rule-${index}-${part}`
const compareSources = computed(() => props.questions.filter(source => comparisonCompatible(props.question.type, source.type)))
const groupSources = computed(() => [{ id: props.question.id, label: props.question.label[props.locale] || t('formUntitled'), type: props.question.type },
  ...props.questions.filter(source => source.type !== 'computed')])
const columns = computed(() => props.question.type === 'table' ? props.question.columns.map(column => ({ id: column.id, label: column.label[props.locale], type: column.type })) : [])
const kinds = computed(() => [
  ...(['text', 'textarea', 'email', 'number', 'date'].includes(props.question.type) ? [{ value: 'compare', label: t('fieldRuleCompare') }] : []),
  ...(['text', 'textarea'].includes(props.question.type) ? [{ value: 'length', label: t('fieldRuleLength') }] : []),
  ...(props.question.type === 'number' ? [{ value: 'precision', label: t('fieldRulePrecision') }] : []),
  ...(['checkboxes', 'multiselect', 'list', 'repeat', 'table', 'budget', 'activities'].includes(props.question.type)
    ? [{ value: 'count', label: t('fieldRuleCount') }] : []),
  ...(['text', 'textarea'].includes(props.question.type) ? [{ value: 'format', label: t('fieldRuleFormat') }] : []),
  ...(props.scope !== 'column' ? [
    ...(!props.question.required && props.questions.length ? [{ value: 'required', label: t('fieldRuleRequired') }] : []),
    ...(['select', 'checkboxes', 'multiselect'].includes(props.question.type) ? [{ value: 'choice', label: t('fieldRuleChoice') }] : []),
    ...(groupSources.value.length > 1 ? [{ value: 'group', label: t('fieldRuleGroup') }] : []),
    ...(props.question.type === 'list' || props.question.type === 'table' || props.question.type === 'repeat' && props.repeatQuestions?.length
      ? [{ value: 'unique', label: t('fieldRuleUnique') }] : []),
    ...(columns.value.some(column => column.type === 'number') ? [{ value: 'total', label: t('fieldRuleTotal') }] : [])
  ] : [])
])
const selectedKind = ref<FieldRule['kind']>('compare')
watch([() => props.question.id, kinds], () => {
  if (!kinds.value.some(kind => kind.value === selectedKind.value)) selectedKind.value = kinds.value[0]?.value as FieldRule['kind'] ?? 'required'
}, { immediate: true })
const operators = computed<{ value: Extract<FieldRule, { kind: 'compare' }>['operator']; label: string }[]>(() => {
  const date = props.question.type === 'date'
  return [
    { value: 'equals', label: t(date ? 'fieldRuleDateEquals' : 'fieldRuleEquals') },
    { value: 'notEquals', label: t(date ? 'fieldRuleDateNotEquals' : 'fieldRuleNotEquals') },
    ...(['date', 'number'].includes(props.question.type) ? [
      { value: 'greaterThan' as const, label: t(date ? 'fieldRuleDateGreaterThan' : 'fieldRuleGreaterThan') },
      { value: 'greaterThanOrEqual' as const, label: t(date ? 'fieldRuleDateGreaterThanOrEqual' : 'fieldRuleGreaterThanOrEqual') },
      { value: 'lessThan' as const, label: t(date ? 'fieldRuleDateLessThan' : 'fieldRuleLessThan') },
      { value: 'lessThanOrEqual' as const, label: t(date ? 'fieldRuleDateLessThanOrEqual' : 'fieldRuleLessThanOrEqual') }
    ] : [])
  ]
})
const fixedTarget = '__fixed_value__'
const todayTarget = '__today__'
const targetItems = computed(() => [{ value: fixedTarget, label: t('fieldRuleFixedValue') }, ...compareSources.value.map(source => ({
  value: source.id, label: t('fieldRuleEarlierAnswer', { label: source.label })
})), ...(props.scope !== 'column' && props.question.type === 'date' ? [{ value: todayTarget, label: t('fieldRuleToday') }] : [])])
const totalTargets = computed(() => [{ value: fixedTarget, label: t('fieldRuleFixedValue') }, ...props.questions.filter(source => source.type === 'number').map(source => ({
  value: source.id, label: t('fieldRuleEarlierAnswer', { label: source.label })
}))])
const formatItems = computed(() => [
  { value: 'url', label: t('fieldRuleFormatUrl') }, { value: 'postalCode', label: t('fieldRuleFormatPostalCode') },
  { value: 'phone', label: t('fieldRuleFormatPhone') }, { value: 'identifier', label: t('fieldRuleFormatIdentifier') }
])
const groupModes = computed(() => [
  { value: 'atLeastOne', label: t('fieldRuleGroupAtLeastOne') }, { value: 'exactlyOne', label: t('fieldRuleGroupExactlyOne') },
  { value: 'all', label: t('fieldRuleGroupAll') }, { value: 'allOrNone', label: t('fieldRuleGroupAllOrNone') }
])
const formatHelp = (format: Extract<FieldRule, { kind: 'format' }>['format']) => t(format === 'url' ? 'fieldRuleFormatUrlHelp'
  : format === 'postalCode' ? 'fieldRuleFormatPostalCodeHelp' : format === 'phone' ? 'fieldRuleFormatPhoneHelp' : 'fieldRuleFormatIdentifierHelp')
const replace = (index: number, rule: FieldRule) => {
  if (props.disabled) return
  rules.value = (rules.value ?? []).map((current, currentIndex) => currentIndex === index ? rule : current)
}
const add = async () => {
  if (props.disabled || !kinds.value.some(kind => kind.value === selectedKind.value) || (rules.value?.length ?? 0) >= 20) return
  const kind = selectedKind.value
  const rule: FieldRule = kind === 'compare' ? { kind, operator: 'equals', target: { kind: 'value', value: '' } }
    : kind === 'precision' ? { kind, decimalPlaces: 0 }
      : kind === 'required' ? { kind, when: { match: 'all', conditions: [{ questionId: props.questions[0]!.id, operator: 'answered' }] } }
        : kind === 'format' ? { kind, format: 'url' }
          : kind === 'choice' ? { kind, value: 'options' in props.question ? props.question.options[0]?.value ?? '' : '' }
            : kind === 'group' ? { kind, mode: 'atLeastOne', questionIds: groupSources.value.slice(0, 2).map(source => source.id) }
              : kind === 'unique' ? props.question.type === 'repeat' ? { kind, questionIds: [props.repeatQuestions![0]!.id] } : { kind }
                : kind === 'total' ? { kind, columnIds: columns.value.filter(column => column.type === 'number').map(column => column.id), operator: 'equals', target: { kind: 'value', value: '' } }
                  : { kind, min: 1 }
  rules.value = [...rules.value ?? [], rule]
  await nextTick()
  focusControl(ruleList.value?.lastElementChild)
}
const remove = async (index: number) => {
  if (props.disabled) return
  const remaining = (rules.value ?? []).filter((_, current) => index !== current)
  rules.value = remaining.length ? remaining : undefined
  await nextTick()
  focusControl(ruleList.value?.children[Math.min(index, remaining.length - 1)] ?? addControls.value)
}
const updateBound = (index: number, rule: Extract<FieldRule, { kind: 'length' | 'count' }>, bound: 'min' | 'max', value: string) => {
  const next = { ...rule }
  if (value === '') delete next[bound]
  else next[bound] = Number(value)
  replace(index, next)
}
const summary = (rule: FieldRule) => {
  if (rule.kind === 'compare') {
    const target = rule.target.kind === 'value' ? rule.target.value || t('fieldRuleMissingValue')
      : rule.target.kind === 'today' ? t('fieldRuleToday')
        : t('fieldRuleEarlierAnswer', { label: props.questions.find(source => source.id === (rule.target.kind === 'question' ? rule.target.questionId : rule.target.kind === 'column' ? rule.target.columnId : ''))?.label ?? t('fieldRuleMissingValue') })
    const offset = (rule.target.kind === 'today' || rule.target.kind === 'question') && rule.target.offsetDays ? ` (${t('fieldRuleOffsetSummary', { count: rule.target.offsetDays })})` : ''
    return `${operators.value.find(operator => operator.value === rule.operator)?.label ?? rule.operator} ${target}${offset}`
  }
  if (rule.kind === 'format') return formatItems.value.find(item => item.value === rule.format)?.label ?? ''
  if (rule.kind === 'choice') return t('fieldRuleChoiceSummary', { label: 'options' in props.question ? props.question.options.find(option => option.value === rule.value)?.label[props.locale] ?? t('fieldRuleMissingValue') : '' })
  if (rule.kind === 'group') return `${groupModes.value.find(mode => mode.value === rule.mode)?.label}: ${groupSources.value.filter(source => rule.questionIds.includes(source.id)).map(source => source.label).join(', ')}`
  if (rule.kind === 'unique') return t('fieldRuleUnique')
  if (rule.kind === 'total') return t('fieldRuleTotalSummary', { columns: columns.value.filter(column => rule.columnIds.includes(column.id)).map(column => column.label).join(', '),
    operator: t(rule.operator === 'equals' ? 'fieldRuleEquals' : 'fieldRuleLessThanOrEqual'), target: rule.target.kind === 'value' ? rule.target.value || t('fieldRuleMissingValue')
      : props.questions.find(source => rule.target.kind === 'question' && source.id === rule.target.questionId)?.label ?? t('fieldRuleMissingValue') })
  if (rule.kind === 'precision') return rule.decimalPlaces < 0 ? t('fieldRulePrecision') : rule.decimalPlaces === 0 ? t('fieldRuleWholeNumbers') : t('fieldRulePrecisionSummary', { count: rule.decimalPlaces })
  if (rule.kind === 'required') return t('fieldRuleConditionSummary', { count: rule.when.conditions.length })
  return t(rule.kind === 'length' ? 'fieldRuleLengthSummary' : 'fieldRuleCountSummary', {
    min: rule.min ?? 0, max: rule.max ?? fieldRuleCeiling(props.question)
  })
}
const errorFor = (rule: FieldRule) => {
  const key = fieldRuleError(props.question, rule, props.questions, props.repeatQuestions)
  return key ? t(key) : undefined
}
const conditionUpdate = (index: number, when: SurveyCondition | undefined) => replace(index, {
  kind: 'required', when: when ?? { match: 'all', conditions: [] }
})
const compareTarget = (rule: Extract<FieldRule, { kind: 'compare' }>) => rule.target.kind === 'value' ? fixedTarget : rule.target.kind === 'today' ? todayTarget
  : rule.target.kind === 'question' ? rule.target.questionId : rule.target.columnId
const updateTarget = (index: number, rule: Extract<FieldRule, { kind: 'compare' }>, value: string) => replace(index, {
  ...rule, target: value === fixedTarget ? { kind: 'value', value: '' } : value === todayTarget ? { kind: 'today' }
    : props.scope === 'column' ? { kind: 'column', columnId: value } : { kind: 'question', questionId: value }
})
const updateOffset = (index: number, rule: Extract<FieldRule, { kind: 'compare' }>, value: string) => {
  if (rule.target.kind !== 'question' && rule.target.kind !== 'today') return
  const target = { ...rule.target }
  if (value === '') delete target.offsetDays
  else target.offsetDays = Number(value)
  replace(index, { ...rule, target })
}
const selectedIds = (rule: Extract<FieldRule, { kind: 'group' | 'unique' | 'total' }>) => rule.kind === 'group' ? rule.questionIds
  : rule.kind === 'total' ? rule.columnIds : props.question.type === 'repeat' ? rule.questionIds ?? [] : rule.columnIds ?? columns.value.map(column => column.id)
const selectionSources = (rule: Extract<FieldRule, { kind: 'group' | 'unique' | 'total' }>) => rule.kind === 'group' ? groupSources.value
  : rule.kind === 'total' ? columns.value.filter(column => column.type === 'number') : props.question.type === 'repeat' ? props.repeatQuestions ?? [] : columns.value
const updateSelection = (index: number, rule: Extract<FieldRule, { kind: 'group' | 'unique' | 'total' }>, id: string, checked: boolean) => {
  const selected = checked ? [...selectedIds(rule), id] : selectedIds(rule).filter(value => value !== id)
  if (rule.kind === 'group') replace(index, { ...rule, questionIds: selected })
  else if (rule.kind === 'total') replace(index, { ...rule, columnIds: selected })
  else replace(index, props.question.type === 'repeat' ? { ...rule, questionIds: selected } : { ...rule, columnIds: selected })
}
</script>

<template>
  <div class="field-rules">
    <p class="text-sm text-muted">{{ t('fieldRulesHelp') }}</p>
    <p v-if="question.type === 'date'" class="text-sm text-muted">{{ t('fieldRulesDateHelp') }}</p>
    <p v-if="question.type === 'number'" class="text-sm text-muted">{{ t('fieldRulesNumberHelp') }}</p>
    <p v-if="!rules?.length" class="text-sm text-muted">{{ t('fieldRulesEmpty') }}</p>
    <ol ref="ruleList" class="field-rule-list">
      <li v-for="(rule, index) in rules ?? []" :key="index" class="field-rule">
        <p class="text-sm font-semibold">{{ index + 1 }}. {{ summary(rule) }}</p>
        <template v-if="rule.kind === 'compare'">
          <p class="text-sm text-muted">{{ t(scope === 'column' ? 'fieldRulesEarlierColumns' : 'fieldRulesEarlier') }}</p>
          <div class="field-rule-grid">
            <ExtensionFormField :label="t('fieldRuleOperator')" :name="fieldName(index, 'operator')" required>
              <ExtensionSelect :model-value="rule.operator" :name="fieldName(index, 'operator')" value-key="value" :items="operators"
                required :disabled="disabled" @update:model-value="replace(index, { ...rule, operator: $event as typeof rule.operator })" />
            </ExtensionFormField>
            <ExtensionFormField :label="t('fieldRuleTarget')" :name="fieldName(index, 'target')" required>
              <ExtensionSelect :model-value="compareTarget(rule)" :name="fieldName(index, 'target')"
                value-key="value" :items="targetItems" required :disabled="disabled"
                :aria-invalid="(rule.target.kind === 'question' || rule.target.kind === 'column') && Boolean(errorFor(rule))" :aria-describedby="errorFor(rule) ? fieldName(index, 'error') : undefined"
                @update:model-value="updateTarget(index, rule, String($event))" />
            </ExtensionFormField>
          </div>
          <ExtensionFormField v-if="rule.target.kind === 'value'" :label="t('fieldRuleValue')" :name="fieldName(index, 'value')"
            :description="question.type === 'number' ? t('fieldRuleNumberInputHelp') : undefined" required>
            <ExtensionInput :model-value="rule.target.value" :name="fieldName(index, 'value')"
              :type="question.type === 'date' ? 'date' : question.type === 'email' ? 'email' : 'text'" :inputmode="question.type === 'number' ? 'decimal' : undefined"
              required :disabled="disabled" :aria-invalid="Boolean(errorFor(rule))" :aria-describedby="errorFor(rule) ? fieldName(index, 'error') : undefined"
              @update:model-value="replace(index, { ...rule, target: { kind: 'value', value: String($event) } })" />
          </ExtensionFormField>
          <ExtensionFormField v-if="question.type === 'date' && (rule.target.kind === 'question' || rule.target.kind === 'today')"
            :label="t('fieldRuleOffset')" :name="fieldName(index, 'offset')" :description="t('fieldRuleOffsetHelp')" :required="false">
            <ExtensionInput :model-value="rule.target.offsetDays ?? ''" :name="fieldName(index, 'offset')" type="number" min="-36500" max="36500" step="1"
              :required="false" :disabled="disabled" :aria-invalid="Boolean(errorFor(rule))" :aria-describedby="errorFor(rule) ? fieldName(index, 'error') : undefined"
              @update:model-value="updateOffset(index, rule, String($event))" />
          </ExtensionFormField>
        </template>
        <template v-else-if="rule.kind === 'length' || rule.kind === 'count'">
          <p :id="fieldName(index, 'bound-help')" class="text-sm text-muted">{{ t('fieldRuleOptionalBound') }} {{ t('fieldRuleCeiling', { max: fieldRuleCeiling(question) }) }}</p>
          <div class="field-rule-grid">
            <ExtensionFormField v-for="bound in (['min', 'max'] as const)" :key="bound"
              :label="t(bound === 'min' ? 'fieldRuleMinimum' : 'fieldRuleMaximum')" :name="fieldName(index, bound)" :required="false">
              <ExtensionInput :model-value="rule[bound] ?? ''" :name="fieldName(index, bound)" type="number" min="0" :max="fieldRuleCeiling(question)" step="1"
                :required="false" :disabled="disabled" :aria-invalid="Boolean(errorFor(rule))"
                :aria-describedby="`${fieldName(index, 'bound-help')}${errorFor(rule) ? ` ${fieldName(index, 'error')}` : ''}`"
                @update:model-value="updateBound(index, rule, bound, String($event))" />
            </ExtensionFormField>
          </div>
        </template>
        <ExtensionFormField v-else-if="rule.kind === 'precision'" :label="t('fieldRuleDecimals')" :name="fieldName(index, 'precision')" :description="t('fieldRuleIntegerHelp')" required>
          <ExtensionInput :model-value="rule.decimalPlaces === -1 ? '' : rule.decimalPlaces" :name="fieldName(index, 'precision')" type="number" min="0" max="20" step="1"
            required :disabled="disabled" :aria-invalid="Boolean(errorFor(rule))" :aria-describedby="errorFor(rule) ? fieldName(index, 'error') : undefined"
            @update:model-value="replace(index, { ...rule, decimalPlaces: $event === '' ? -1 : Number($event) })" />
        </ExtensionFormField>
        <ExtensionFormField v-else-if="rule.kind === 'format'" :label="t('fieldRuleFormat')" :name="fieldName(index, 'format')" :description="formatHelp(rule.format)" required>
          <ExtensionSelect :model-value="rule.format" :name="fieldName(index, 'format')" value-key="value" :items="formatItems" required :disabled="disabled"
            @update:model-value="replace(index, { ...rule, format: $event as typeof rule.format })" />
        </ExtensionFormField>
        <ExtensionFormField v-else-if="rule.kind === 'choice'" :label="t('fieldRuleChoice')" :name="fieldName(index, 'choice')" :description="t('fieldRuleChoiceHelp')" required>
          <ExtensionSelect :model-value="rule.value" :name="fieldName(index, 'choice')" value-key="value"
            :items="'options' in question ? question.options.map(option => ({ value: option.value, label: option.label[locale] })) : []"
            required :disabled="disabled" :aria-invalid="Boolean(errorFor(rule))" :aria-describedby="errorFor(rule) ? fieldName(index, 'error') : undefined"
            @update:model-value="replace(index, { ...rule, value: String($event) })" />
        </ExtensionFormField>
        <template v-else-if="rule.kind === 'required'">
          <FormCondition :model-value="rule.when" :questions="questions" :locale="locale" :disabled="disabled" purpose="required" :name-prefix="fieldName(index, 'condition')"
            :error-id="errorFor(rule) ? fieldName(index, 'error') : undefined"
            @update:model-value="conditionUpdate(index, $event)" />
        </template>
        <template v-else-if="rule.kind === 'group' || rule.kind === 'unique' || rule.kind === 'total'">
          <ExtensionFormField v-if="rule.kind === 'group'" :label="t('fieldRuleGroupMode')" :name="fieldName(index, 'group-mode')" required>
            <ExtensionSelect :model-value="rule.mode" :name="fieldName(index, 'group-mode')" value-key="value" :items="groupModes" required :disabled="disabled"
              @update:model-value="replace(index, { ...rule, mode: $event as typeof rule.mode })" />
          </ExtensionFormField>
          <p v-if="rule.kind === 'unique'" class="text-sm text-muted">{{ t(question.type === 'list' ? 'fieldRuleUniqueListHelp' : 'fieldRuleUniqueHelp') }}</p>
          <fieldset v-if="rule.kind !== 'unique' || question.type !== 'list'" class="field-rule-selections"
            :aria-invalid="Boolean(errorFor(rule))" :aria-describedby="`${fieldName(index, 'selection-help')}${errorFor(rule) ? ` ${fieldName(index, 'error')}` : ''}`">
            <legend class="text-sm font-semibold">{{ t(rule.kind === 'group' ? 'fieldRuleGroupFields' : rule.kind === 'unique' && question.type === 'repeat' ? 'fieldRuleUniqueFields' : 'fieldRuleColumns') }}</legend>
            <p :id="fieldName(index, 'selection-help')" class="text-sm text-muted">{{ t(rule.kind === 'group' ? 'fieldRuleGroupHelp' : 'fieldRuleSelectFields') }}</p>
            <ExtensionCheckbox v-for="source in selectionSources(rule)" :key="source.id" :label="source.label" :model-value="selectedIds(rule).includes(source.id)"
              :disabled="disabled || rule.kind === 'group' && source.id === question.id || selectedIds(rule).length >= 20 && !selectedIds(rule).includes(source.id)" :required="false"
              @update:model-value="updateSelection(index, rule, source.id, Boolean($event))" />
          </fieldset>
          <template v-if="rule.kind === 'total'">
            <div class="field-rule-grid">
              <ExtensionFormField :label="t('fieldRuleTotalOperator')" :name="fieldName(index, 'total-operator')" required>
                <ExtensionSelect :model-value="rule.operator" :name="fieldName(index, 'total-operator')" value-key="value"
                  :items="[{ value: 'equals', label: t('fieldRuleEquals') }, { value: 'lessThanOrEqual', label: t('fieldRuleLessThanOrEqual') }]"
                  required :disabled="disabled" @update:model-value="replace(index, { ...rule, operator: $event as typeof rule.operator })" />
              </ExtensionFormField>
              <ExtensionFormField :label="t('fieldRuleTarget')" :name="fieldName(index, 'total-target')" required>
                <ExtensionSelect :model-value="rule.target.kind === 'question' ? rule.target.questionId : fixedTarget" :name="fieldName(index, 'total-target')"
                  value-key="value" :items="totalTargets" required :disabled="disabled"
                  @update:model-value="replace(index, { ...rule, target: $event === fixedTarget ? { kind: 'value', value: '' } : { kind: 'question', questionId: String($event) } })" />
              </ExtensionFormField>
            </div>
            <ExtensionFormField v-if="rule.target.kind === 'value'" :label="t('fieldRuleValue')" :name="fieldName(index, 'total-value')" :description="t('fieldRuleNumberInputHelp')" required>
              <ExtensionInput :model-value="rule.target.value" :name="fieldName(index, 'total-value')" type="text" inputmode="decimal" required :disabled="disabled"
                :aria-invalid="Boolean(errorFor(rule))" :aria-describedby="errorFor(rule) ? fieldName(index, 'error') : undefined"
                @update:model-value="replace(index, { ...rule, target: { kind: 'value', value: String($event) } })" />
            </ExtensionFormField>
          </template>
        </template>
        <p v-if="errorFor(rule)" :id="fieldName(index, 'error')" class="text-sm text-error" role="alert">{{ errorFor(rule) }}</p>
        <div class="field-rule-actions">
          <ExtensionButton color="error" variant="outline" icon="i-lucide-trash-2" :disabled="disabled" @click="remove(index)">
            {{ t('fieldRuleRemove', { number: index + 1 }) }}
          </ExtensionButton>
        </div>
      </li>
    </ol>
    <p v-if="scope !== 'column' && question.required" class="text-sm text-muted">{{ t('fieldRuleAlwaysRequired') }}</p>
    <p v-else-if="scope !== 'column' && !questions.length" class="text-sm text-muted">{{ t('fieldRuleNoConditions') }}</p>
    <div v-if="kinds.length" ref="addControls" class="field-rule-add">
      <ExtensionFormField :label="t('fieldRuleKind')" :name="`${editorId}-kind`" required>
        <ExtensionSelect v-model="selectedKind" :name="`${editorId}-kind`" value-key="value" :items="kinds" required :disabled="disabled" />
      </ExtensionFormField>
      <ExtensionButton color="neutral" variant="outline" icon="i-lucide-plus" :disabled="disabled || (rules?.length ?? 0) >= 20" @click="add">{{ t('fieldRuleAdd') }}</ExtensionButton>
    </div>
  </div>
</template>

<style scoped>
.field-rules, .field-rule-list, .field-rule { display: grid; gap: 1rem; min-width: 0; }
.field-rule { border-top: 1px solid var(--ui-border); padding-top: 1rem; }
.field-rule > p { overflow-wrap: anywhere; }
.field-rule-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 1rem; min-width: 0; }
.field-rule-grid > *, .field-rule-add > * { min-width: 0; }
.field-rule-selections { display: grid; gap: .6rem; min-width: 0; }
.field-rule-add { display: flex; align-items: flex-end; flex-wrap: wrap; gap: .75rem; }
.field-rule-add > :first-child { flex: 1 1 15rem; }
.field-rule-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: .75rem; }
</style>
