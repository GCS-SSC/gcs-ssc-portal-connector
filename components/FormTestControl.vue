<script setup lang="ts">
import { nanoid } from 'nanoid'
import { parseChoices, tableTotals, tableTotalsMode, parseList, parseTable, type ListItem, type TableRow } from '@gcs-ssc/survey'
import type { SurveyField } from '@gcs-ssc/survey/vue'
import { ExtensionButton, ExtensionCheckbox, ExtensionSelectMenu, ExtensionFormField, ExtensionInput, ExtensionSelect, ExtensionTextarea } from '@gcs-ssc/extensions/ui'
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { messages } from '../i18n/messages'
import FormGrantElement from './FormGrantElement.vue'
const props = defineProps<{ field: SurveyField; locale: 'en' | 'fr' }>()
const t = (key: keyof typeof messages.en, values?: Record<string, string | number>) => translateGcsExtensionMessage(messages, props.locale, key, values)
const tr = (en: string, fr: string) => props.locale === 'fr' ? fr : en
const previewLabel = (label: string, required: boolean) => required
  ? `${label} ${tr('(required)', '(obligatoire)')}` : label
const answerText = (value: unknown) => value === null || value === undefined ? '' : String(value)
const rows = () => parseList(props.field.value)
const table = () => parseTable(props.field.value)
const totals = () => props.field.question.type === 'table' ? tableTotals(props.field.question, table()) : { rows: {}, columns: {} }
const totalsMode = () => tableTotalsMode(props.field.question)
const choices = () => parseChoices(props.field.value)
const toggleChoice = (value: string, selected: boolean) => props.field.setValue(JSON.stringify(selected ? [...choices(), value] : choices().filter(item => item !== value)))
const id = () => `r_${nanoid()}`
const updateList = (items: ListItem[]) => props.field.setValue(JSON.stringify(items))
const updateTable = (items: TableRow[]) => props.field.setValue(JSON.stringify(items))
</script>
<template>
  <div :id="field.id" tabindex="-1" class="space-y-2 min-w-0" :data-preview-field="field.id">
    <FormGrantElement v-if="field.question.type === 'budget' || field.question.type === 'activities'" :field="field" :locale="locale" />
    <fieldset v-else-if="field.question.type === 'checkboxes'" :aria-describedby="`${field.id}-choices-help ${field.error ? `${field.id}-error` : ''}`" :aria-invalid="Boolean(field.error)">
      <legend class="font-medium">{{ previewLabel(field.label, field.required) }}</legend>
      <p :id="`${field.id}-choices-help`" class="text-sm text-muted">{{ field.hint }} {{ field.required ? tr('Select at least one option.', 'Sélectionnez au moins une option.') : tr('Select all that apply.', 'Sélectionnez toutes les options applicables.') }}</p>
      <ExtensionCheckbox v-for="option in field.options" :key="option.value" :label="option.label" :name="`${field.id}-${option.value}`" :model-value="choices().includes(option.value)" :disabled="field.disabled" :aria-describedby="`${field.id}-choices-help ${field.error ? `${field.id}-error` : ''}`" @update:model-value="toggleChoice(option.value, Boolean($event))" />
      <p v-if="field.error" :id="`${field.id}-error`" role="alert" class="text-sm text-error">{{ t(`previewError_${field.error}`) }}</p>
    </fieldset>
    <ExtensionFormField v-else-if="field.question.type === 'multiselect'" :label="previewLabel(field.label, field.required)" :name="field.id" :description="field.hint" :error="field.error ? t(`previewError_${field.error}`) : undefined">
      <ExtensionSelectMenu multiple :model-value="choices()" :name="field.id" :id="`${field.id}-control`" value-key="value" :items="field.options" :required="field.required" :aria-required="field.required" :disabled="field.disabled" :aria-invalid="Boolean(field.error)" :placeholder="tr('Choose options', 'Choisir les options')" @update:model-value="field.setValue(JSON.stringify($event ?? []))" />
    </ExtensionFormField>
    <div v-else-if="field.question.type === 'computed'" class="text-sm"><p><strong>{{ field.label }}</strong>: {{ field.value || '—' }}</p><p v-if="field.hint" class="text-muted">{{ field.hint }}</p></div>
    <template v-else-if="field.question.type === 'repeat'">
      <p class="font-medium">{{ field.label }}{{ field.required ? ` ${t('previewRequired')}` : '' }}</p>
      <p v-if="field.hint" class="text-sm text-muted">{{ field.hint }}</p>
      <div v-for="(row, index) in rows()" :key="row.id" class="flex items-center gap-2">
        <span>{{ tr('Entry', 'Entrée') }} {{ index + 1 }}</span>
        <ExtensionButton type="button" color="neutral" variant="outline" :disabled="field.disabled" @click="updateList(rows().filter((item) => item.id !== row.id))">{{ tr('Remove', 'Retirer') }}</ExtensionButton>
      </div>
      <ExtensionButton type="button" color="neutral" variant="outline" :disabled="field.disabled || rows().length >= field.question.maxItems" @click="updateList([...rows(), { id: id(), value: '' }])">
        {{ tr('Add another', 'Ajouter un autre élément') }}
      </ExtensionButton>
    </template>
    <template v-else-if="field.question.type === 'list'">
      <p class="font-medium">{{ field.label }}{{ field.required ? ` ${t('previewRequired')}` : '' }}</p>
      <p v-if="field.hint" class="text-sm text-muted">{{ field.hint }}</p>
      <div v-for="(row, index) in rows()" :key="row.id" class="flex items-end gap-2">
        <ExtensionFormField :label="previewLabel(`${field.label} ${index + 1}`, true)" :name="`${field.id}-${row.id}`">
          <ExtensionInput :model-value="row.value" :name="`${field.id}-${row.id}`" required :disabled="field.disabled"
            @update:model-value="updateList(rows().map((item) => item.id === row.id ? { ...item, value: answerText($event) } : item))" />
        </ExtensionFormField>
        <ExtensionButton type="button" color="neutral" variant="ghost" :disabled="field.disabled" @click="updateList(rows().filter((item) => item.id !== row.id))">{{ tr('Remove', 'Retirer') }}</ExtensionButton>
      </div>
      <ExtensionButton type="button" color="neutral" variant="outline" :disabled="field.disabled || rows().length >= field.question.maxItems" @click="updateList([...rows(), { id: id(), value: '' }])">
        {{ tr('Add item', 'Ajouter un élément') }}
      </ExtensionButton>
    </template>
    <template v-else-if="field.question.type === 'table'">
      <p class="font-medium">{{ field.label }}{{ field.required ? ` ${t('previewRequired')}` : '' }}</p>
      <p v-if="field.hint" class="text-sm text-muted">{{ field.hint }}</p>
      <div v-for="row in table()" :key="row.id" class="grid gap-2 border-b border-default pb-3 sm:grid-cols-2">
        <ExtensionFormField v-for="column in field.question.columns" :key="column.id"
          :label="previewLabel(column.label[locale], column.required)" :name="`${field.id}-${row.id}-${column.id}`">
          <ExtensionInput :model-value="row.cells[column.id] ?? ''" :name="`${field.id}-${row.id}-${column.id}`"
            :required="column.required" :disabled="field.disabled" :type="column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'" @update:model-value="updateTable(table().map((item) => item.id === row.id
              ? { ...item, cells: { ...item.cells, [column.id]: answerText($event) } } : item))" />
        </ExtensionFormField>
        <p v-if="['rows', 'both'].includes(totalsMode())" class="font-medium">{{ tr('Row total', 'Total de la ligne') }}: <output>{{ totals().rows[row.id] ?? '—' }}</output></p>
        <ExtensionButton type="button" color="neutral" variant="ghost" :disabled="field.disabled" @click="updateTable(table().filter((item) => item.id !== row.id))">{{ tr('Remove row', 'Retirer la ligne') }}</ExtensionButton>
      </div>
      <dl v-if="['columns', 'both'].includes(totalsMode())" class="space-y-1">
        <template v-for="column in field.question.columns.filter(item => item.type === 'number')" :key="column.id"><dt>{{ column.label[locale] }} — {{ tr('Column total', 'Total de la colonne') }}</dt><dd><output>{{ totals().columns[column.id] ?? '—' }}</output></dd></template>
      </dl>
      <ExtensionButton type="button" color="neutral" variant="outline" :disabled="field.disabled || table().length >= field.question.maxRows" @click="updateTable([...table(), { id: id(), cells: {} }])">
        {{ tr('Add row', 'Ajouter une ligne') }}
      </ExtensionButton>
    </template>
    <ExtensionFormField v-else-if="field.question.type === 'textarea'" :label="previewLabel(field.label, field.required)" :name="field.id" :description="field.hint" :error="field.error ? t(`previewError_${field.error}`) : undefined">
      <ExtensionTextarea :id="`${field.id}-control`" :model-value="field.value" :name="field.id" :rows="5"
        :required="field.required" :disabled="field.disabled" :maxlength="field.question.maxLength" :aria-invalid="Boolean(field.error)"
        @update:model-value="field.setValue(answerText($event))" />
    </ExtensionFormField>
    <ExtensionFormField v-else-if="field.question.type === 'select'" :label="previewLabel(field.label, field.required)" :name="field.id"
      :description="field.hint" :error="field.error ? t(`previewError_${field.error}`) : undefined">
      <ExtensionSelect :model-value="field.value" :name="field.id" :id="`${field.id}-control`" value-key="value" :required="field.required" :disabled="field.disabled" :aria-invalid="Boolean(field.error)"
        :items="field.options" :placeholder="tr('Choose', 'Choisir')"
        @update:model-value="field.setValue(answerText($event))" />
    </ExtensionFormField>
    <ExtensionFormField v-else :label="previewLabel(field.label, field.required)" :name="field.id" :description="field.hint" :error="field.error ? t(`previewError_${field.error}`) : undefined">
      <ExtensionInput :model-value="field.value" :name="field.id" :id="`${field.id}-control`" :required="field.required" :disabled="field.disabled" :aria-invalid="Boolean(field.error)"
        :maxlength="field.question.type === 'text' ? field.question.maxLength : undefined"
        :type="['email', 'number', 'date'].includes(field.question.type) ? field.question.type : 'text'"
        @update:model-value="field.setValue(answerText($event))" />
    </ExtensionFormField>
    <p v-if="field.error && ['repeat', 'list', 'table'].includes(field.question.type)" :id="`${field.id}-error`" class="text-sm text-error" role="alert">{{ t(`previewError_${field.error}`) }}</p>
  </div>
</template>
