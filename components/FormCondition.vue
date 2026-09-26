<script setup lang="ts">
import { computed } from 'vue'
import type { SurveyCondition } from '@gcs-ssc/survey'
import { ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionSelect } from '@gcs-ssc/extensions/ui'
const props = defineProps<{ questions: { id: string; label: string }[]; disabled?: boolean; locale: 'en' | 'fr' }>()
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
  if (key === 'operator') {
    if (value === 'answered' || value === 'notAnswered') delete next.value
    else next.value = 'value' in current ? current.value : ''
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
  <div class="space-y-3">
    <ExtensionFormField v-if="condition && condition.conditions.length > 1" :label="label('Match', 'Correspondance')" name="conditionMatch">
      <ExtensionSelect :model-value="condition.match" name="conditionMatch" value-key="value" :disabled="disabled"
        :items="[{ value: 'all', label: label('All rules', 'Toutes les règles') }, { value: 'any', label: label('Any rule', 'Une règle') }]"
        @update:model-value="condition = { ...condition!, match: $event as 'all' | 'any' }" />
    </ExtensionFormField>
    <div v-for="(row, index) in condition?.conditions ?? []" :key="index" class="grid gap-2 sm:grid-cols-3">
      <ExtensionFormField :label="label('Question', 'Question')" :name="`conditionQuestion${index}`">
        <ExtensionSelect :model-value="row.questionId" :name="`conditionQuestion${index}`" value-key="value"
          :items="questions.map((item) => ({ value: item.id, label: item.label }))" :disabled="disabled"
          @update:model-value="update(index, 'questionId', String($event))" />
      </ExtensionFormField>
      <ExtensionFormField :label="label('Rule', 'Règle')" :name="`conditionOperator${index}`">
        <ExtensionSelect :model-value="row.operator" :name="`conditionOperator${index}`" value-key="value"
          :items="operators" :disabled="disabled" @update:model-value="update(index, 'operator', String($event))" />
      </ExtensionFormField>
      <ExtensionFormField v-if="'value' in row" :label="label('Value', 'Valeur')" :name="`conditionValue${index}`" required>
        <ExtensionInput :model-value="row.value" :name="`conditionValue${index}`" required :disabled="disabled"
          @update:model-value="update(index, 'value', String($event))" />
      </ExtensionFormField>
      <ExtensionButton :disabled="disabled" @click="remove(index)">{{ label('Remove rule', 'Retirer la règle') }}</ExtensionButton>
    </div>
    <ExtensionButton :disabled="disabled || !questions.length || (condition?.conditions.length ?? 0) >= 20" @click="add">
      {{ label('Add rule', 'Ajouter une règle') }}
    </ExtensionButton>
  </div>
</template>
