<script setup lang="ts">
import { computed } from 'vue'
import type { SurveyCondition } from '@gcs-ssc/survey'
import { ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionSelect, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
const { t } = useExtensionI18n(messages)
type Question = { id: string; label: string; type?: string; options?: { value: string; label: string }[] }
const props = defineProps<{ questions: Question[]; disabled?: boolean; locale: 'en' | 'fr'; purpose?: 'visibility' | 'branch' }>()
const condition = defineModel<SurveyCondition | undefined>({ required: true })
const label = (en: string, fr: string) => props.locale === 'fr' ? fr : en
const operators = computed(() => [
  { value: 'equals', label: label('Equals', 'Égale') },
  { value: 'notEquals', label: label('Does not equal', 'Différente de') },
  { value: 'contains', label: label('Contains', 'Contient') },
  { value: 'greaterThan', label: label('Greater than', 'Supérieure à') },
  { value: 'lessThan', label: label('Less than', 'Inférieure à') },
  { value: 'answered', label: label('Answered', 'Avec réponse') },
  { value: 'notAnswered', label: label('Unanswered', 'Sans réponse') }
])
const source = (id: string) => props.questions.find((question) => question.id === id)
const operatorItems = (id: string) => operators.value.filter((item) => {
  const type = source(id)?.type
  if (type === 'budget' || type === 'activities') return item.value === 'answered' || item.value === 'notAnswered'
  if (type === 'checkboxes' || type === 'multiselect') return ['contains', 'answered', 'notAnswered'].includes(item.value)
  if (item.value === 'contains') return type === 'text' || type === 'textarea' || type === 'list' || !type
  if (item.value === 'greaterThan' || item.value === 'lessThan') return type === 'number' || !type
  return true
})
const add = () => {
  if (!props.questions.length) return
  condition.value = {
    match: condition.value?.match ?? 'all',
    conditions: [...condition.value?.conditions ?? [], { questionId: props.questions[0]!.id, operator: 'answered' }]
  }
}
const update = (index: number, key: 'questionId' | 'operator' | 'value', value: string) => {
  if (!condition.value) return
  const rows = [...condition.value.conditions]
  const current = rows[index]!
  const next: { questionId: string; operator: string; value?: string } = { ...current, [key]: value }
  if (key === 'questionId') { next.operator = 'answered'; delete next.value }
  if (key === 'operator') {
    if (value === 'answered' || value === 'notAnswered') delete next.value
    else next.value = source(current.questionId)?.options
      ? source(current.questionId)?.options?.[0]?.value ?? ''
      : 'value' in current ? current.value : ''
  }
  rows[index] = next as SurveyCondition['conditions'][number]
  condition.value = { ...condition.value, conditions: rows }
}
const remove = (index: number) => {
  if (!condition.value) return
  const rows = condition.value.conditions.filter((_, row) => row !== index)
  condition.value = rows.length ? { ...condition.value, conditions: rows } : undefined
}
</script>

<template>
  <div class="condition-editor">
    <p v-if="!condition?.conditions.length" class="text-sm text-muted">{{ t(purpose === 'branch' ? 'designConditionBranchEmpty' : 'designConditionAlways') }}</p>
    <p v-if="!questions.length" class="text-sm text-muted">{{ t('designConditionEmpty') }}</p>
    <p v-if="condition && condition.conditions.length > 1" class="text-sm text-muted">{{ t('designConditionMatchHelp') }}</p>
    <ExtensionFormField v-if="condition && condition.conditions.length > 1" :label="label('Match', 'Correspondance')" name="conditionMatch">
      <ExtensionSelect :model-value="condition.match" name="conditionMatch" value-key="value" :disabled="disabled"
        :items="[{ value: 'all', label: label('All rules', 'Toutes les règles') }, { value: 'any', label: label('Any rule', 'Une règle') }]"
        @update:model-value="condition = { ...condition!, match: $event as 'all' | 'any' }" />
    </ExtensionFormField>
    <div v-for="(row, index) in condition?.conditions ?? []" :key="index" class="condition-row">
      <ExtensionFormField :label="label('If the answer to', 'Si la réponse à')" :name="`conditionQuestion${index}`">
        <ExtensionSelect :model-value="row.questionId" :name="`conditionQuestion${index}`" value-key="value"
          :items="questions.map((item) => ({ value: item.id, label: item.label }))" :disabled="disabled"
          @update:model-value="update(index, 'questionId', String($event))" />
      </ExtensionFormField>
      <ExtensionFormField :label="label('Is', 'Est')" :name="`conditionOperator${index}`">
        <ExtensionSelect :model-value="row.operator" :name="`conditionOperator${index}`" value-key="value"
          :items="operatorItems(row.questionId)" :disabled="disabled" @update:model-value="update(index, 'operator', String($event))" />
      </ExtensionFormField>
      <ExtensionFormField v-if="'value' in row" :label="label('This answer', 'Cette réponse')" :name="`conditionValue${index}`" required>
        <ExtensionSelect v-if="source(row.questionId)?.options" :model-value="row.value" :name="`conditionValue${index}`"
          value-key="value" :items="source(row.questionId)?.options ?? []" :disabled="disabled" required
          @update:model-value="update(index, 'value', String($event))" />
        <ExtensionInput v-else :model-value="row.value" :name="`conditionValue${index}`" :type="source(row.questionId)?.type === 'number' ? 'number' : 'text'" required :disabled="disabled"
          @update:model-value="update(index, 'value', String($event))" />
      </ExtensionFormField>
      <div class="condition-actions">
        <ExtensionButton color="error" variant="outline" icon="i-lucide-trash-2" :disabled="disabled" @click="remove(index)">{{ label('Remove rule', 'Retirer la règle') }}</ExtensionButton>
      </div>
    </div>
    <div class="condition-actions">
    <ExtensionButton color="neutral" variant="outline" icon="i-lucide-plus" :disabled="disabled || !questions.length || (condition?.conditions.length ?? 0) >= 20" @click="add">
      {{ label('Add rule', 'Ajouter une règle') }}
    </ExtensionButton>
    </div>
  </div>
</template>

<style scoped>
.condition-editor { display: grid; gap: 1rem; min-width: 0; }
.condition-row { display: grid; gap: 1rem; border-top: 1px solid var(--ui-border); padding-top: 1rem; min-width: 0; }
.condition-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .75rem; }
</style>
