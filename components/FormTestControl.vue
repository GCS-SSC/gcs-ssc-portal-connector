<script setup lang="ts">
import { parseList, parseTable, type ListItem, type TableRow } from '@gcs-ssc/survey'
import type { SurveyField } from '@gcs-ssc/survey/vue'
import { ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionSelect } from '@gcs-ssc/extensions/ui'
const props = defineProps<{ field: SurveyField; locale: 'en' | 'fr' }>()
const tr = (en: string, fr: string) => props.locale === 'fr' ? fr : en
const rows = () => parseList(props.field.value)
const table = () => parseTable(props.field.value)
const id = () => `r_${crypto.randomUUID().replaceAll('-', '_')}`
const updateList = (items: ListItem[]) => props.field.setValue(JSON.stringify(items))
const updateTable = (items: TableRow[]) => props.field.setValue(JSON.stringify(items))
</script>
<template>
  <div class="space-y-2">
    <p v-if="field.question.type === 'computed'" class="text-sm"><strong>{{ field.label }}</strong>: {{ field.value || '—' }}</p>
    <template v-else-if="field.question.type === 'list'">
      <p class="font-medium">{{ field.label }}{{ field.required ? ' *' : '' }}</p>
      <div v-for="(row, index) in rows()" :key="row.id" class="flex items-end gap-2">
        <ExtensionFormField :label="`${field.label} ${index + 1}`" :name="`${field.id}-${row.id}`" required>
          <ExtensionInput :model-value="row.value" :name="`${field.id}-${row.id}`" required
            @update:model-value="updateList(rows().map((item) => item.id === row.id ? { ...item, value: String($event) } : item))" />
        </ExtensionFormField>
        <ExtensionButton @click="updateList(rows().filter((item) => item.id !== row.id))">{{ tr('Remove', 'Retirer') }}</ExtensionButton>
      </div>
      <ExtensionButton :disabled="rows().length >= field.question.maxItems" @click="updateList([...rows(), { id: id(), value: '' }])">
        {{ tr('Add item', 'Ajouter un élément') }}
      </ExtensionButton>
    </template>
    <template v-else-if="field.question.type === 'table'">
      <p class="font-medium">{{ field.label }}{{ field.required ? ' *' : '' }}</p>
      <div v-for="row in table()" :key="row.id" class="grid gap-2 border-b border-default pb-3 sm:grid-cols-2">
        <ExtensionFormField v-for="column in field.question.columns" :key="column.id"
          :label="column.label[locale]" :name="`${field.id}-${row.id}-${column.id}`" :required="column.required">
          <ExtensionInput :model-value="row.cells[column.id] ?? ''" :name="`${field.id}-${row.id}-${column.id}`"
            :required="column.required" @update:model-value="updateTable(table().map((item) => item.id === row.id
              ? { ...item, cells: { ...item.cells, [column.id]: String($event) } } : item))" />
        </ExtensionFormField>
        <ExtensionButton @click="updateTable(table().filter((item) => item.id !== row.id))">{{ tr('Remove row', 'Retirer la ligne') }}</ExtensionButton>
      </div>
      <ExtensionButton :disabled="table().length >= field.question.maxRows" @click="updateTable([...table(), { id: id(), cells: {} }])">
        {{ tr('Add row', 'Ajouter une ligne') }}
      </ExtensionButton>
    </template>
    <ExtensionFormField v-else-if="field.question.type === 'select'" :label="field.label" :name="field.id" :required="field.required"
      :description="field.hint">
      <ExtensionSelect :model-value="field.value" :name="field.id" value-key="value" :required="field.required"
        :items="field.options" :placeholder="tr('Choose', 'Choisir')"
        @update:model-value="field.setValue(String($event))" />
    </ExtensionFormField>
    <ExtensionFormField v-else :label="field.label" :name="field.id" :required="field.required" :description="field.hint">
      <ExtensionInput :model-value="field.value" :name="field.id" :required="field.required"
        :type="['email', 'number', 'date'].includes(field.question.type) ? field.question.type : 'text'"
        @update:model-value="field.setValue(String($event))" />
    </ExtensionFormField>
    <p v-if="field.error" class="text-sm text-error" role="alert">{{ tr('Check this response', 'Vérifiez cette réponse') }} ({{ field.error }})</p>
  </div>
</template>
