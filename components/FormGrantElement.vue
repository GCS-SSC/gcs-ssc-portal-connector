<script setup lang="ts">
import { computed } from 'vue'
import { nanoid } from 'nanoid'
import { fundingFields, type ActivityRow, type BudgetRow, type GrantQuestion } from '@gcs-ssc/survey'
import { useGrantElement, type SurveyField } from '@gcs-ssc/survey/vue'
import { ExtensionButton, ExtensionCheckbox } from '@gcs-ssc/extensions/ui'
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { messages } from '../i18n/messages'
import FormGrantInput from './FormGrantInput.vue'

const props = defineProps<{ field: SurveyField; locale: 'en' | 'fr' }>()
const t = (key: string, values?: Record<string, string | number>) => translateGcsExtensionMessage(messages, props.locale, key as keyof typeof messages.en, values)
const question = computed(() => props.field.question as GrantQuestion)
const editor = useGrantElement({ question, value: () => props.field.value, locale: () => props.locale,
  showErrors: () => Boolean(props.field.error), disabled: () => props.field.disabled,
  createId: () => `r_${nanoid()}`, onChange: value => props.field.setValue(value) })
const rowId = (id: string, path: string) => `${props.field.id}-${id}-${path.replaceAll('.', '-')}`
const budgetRow = (row: BudgetRow | ActivityRow) => row as BudgetRow
const activityRow = (row: BudgetRow | ActivityRow) => row as ActivityRow
const configured = computed(() => question.value.type === 'budget'
  ? Boolean(question.value.config.costItems.length && question.value.config.fiscalYears.length)
  : (!question.value.config.requireOutcomes || question.value.config.outcomes.length > 0)
    && (!question.value.config.requireResponsibleParties || question.value.config.responsibleParties.length > 0))
const selections = computed(() => question.value.type !== 'activities'
  ? []
  : [
      { path: 'outcomeIds' as const, label: 'grantOutcomes', options: question.value.config.outcomes, required: question.value.config.requireOutcomes },
      { path: 'responsiblePartyIds' as const, label: 'grantParties', options: question.value.config.responsibleParties, required: question.value.config.requireResponsibleParties }
    ])
const yearLabel = (id: string) => question.value.type === 'budget' ? question.value.config.fiscalYears.find(option => option.id === id)?.label[props.locale] ?? '—' : ''
const categoryLabel = (id?: string) => question.value.type === 'budget' ? question.value.config.categories.find(option => option.id === id)?.label[props.locale] ?? '—' : ''
</script>

<template>
  <fieldset class="min-w-0 space-y-5" :aria-describedby="`${field.id}-instructions`">
    <legend class="text-lg font-semibold">
      {{ field.label }}{{ field.required ? ` ${t('previewRequired')}` : '' }}
    </legend>
    <p :id="`${field.id}-instructions`" class="text-sm text-muted">
      {{ field.hint || t(question.type === 'budget' ? 'grantSummaryHelp' : 'grantActivityHelp') }}
    </p>
    <p v-if="!configured" class="text-sm text-warning">
      {{ t('grantNotConfigured') }}
    </p>
    <p v-if="editor.issues.value.find(issue => !issue.path)" role="alert" class="text-sm text-error">
      {{ t(`grantError_${editor.issues.value.find(issue => !issue.path)!.code}`) }}
    </p>
    <p v-if="!editor.rows.value.length" class="text-sm text-muted">
      {{ t('grantEmpty') }}
    </p>
    <fieldset v-for="(row, index) in editor.rows.value" :key="row.id" class="rounded-lg border border-default p-4 space-y-4">
      <legend class="px-2 font-semibold">
        {{ t(question.type === 'budget' ? 'grantCostEntry' : 'grantActivityEntry', { number: index + 1 }) }}
      </legend>
      <div class="grid gap-4 sm:grid-cols-2">
        <FormGrantInput
          v-for="input in editor.fields(row)" :id="rowId(row.id, input.path)" :key="input.path" :input="input" :disabled="field.disabled" :locale="locale"
          :error="editor.error(index, input.path)" :class="input.type === 'textarea' ? 'grant-wide' : ''" @change="editor.change(row.id, input.path, $event)" />
      </div>
      <template v-if="question.type === 'activities'">
        <fieldset
          v-for="selection in selections" :id="rowId(row.id, selection.path)" :key="selection.path" tabindex="-1" class="space-y-2"
          :aria-describedby="`${rowId(row.id, selection.path)}-hint${editor.error(index, selection.path) ? ` ${rowId(row.id, selection.path)}-error` : ''}`">
          <legend class="font-medium">
            {{ t(selection.label) }}{{ selection.required ? ` ${t('previewRequired')}` : '' }}
          </legend>
          <p :id="`${rowId(row.id, selection.path)}-hint`" class="text-sm text-muted">
            {{ t(selection.required ? 'grantSelectOne' : 'grantSelectOptional') }}
          </p>
          <ExtensionCheckbox
            v-for="option in selection.options" :key="option.id" :label="option.label[locale]" :disabled="field.disabled"
            :aria-describedby="`${rowId(row.id, selection.path)}-hint${editor.error(index, selection.path) ? ` ${rowId(row.id, selection.path)}-error` : ''}`" :model-value="activityRow(row)[selection.path].includes(option.id)" @update:model-value="editor.toggle(row.id, selection.path, option.id, Boolean($event))" />
          <p v-if="editor.error(index, selection.path)" :id="`${rowId(row.id, selection.path)}-error`" role="alert" class="text-sm text-error">
            {{ t(`grantError_${editor.error(index, selection.path)}`) }}
          </p>
        </fieldset>
      </template>
      <div v-else class="space-y-3 border-t border-default pt-4">
        <h5 class="font-medium">
          {{ t('grantOtherFunding') }}
        </h5>
        <fieldset v-for="(source, sourceIndex) in budgetRow(row).otherFunding" :key="source.id" class="rounded-lg border border-default p-3 space-y-3">
          <legend class="px-2 text-sm">
            {{ t('grantFundingSubtype') }} {{ sourceIndex + 1 }}
          </legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <FormGrantInput
              v-for="input in fundingFields(question.config, source, locale)" :id="rowId(source.id, input.path)" :key="input.path" :input="input" :disabled="field.disabled" :locale="locale"
              :error="editor.error(index, `otherFunding.${sourceIndex}.${input.path}`)" @change="editor.changeFunding(row.id, source.id, input.path, $event)" />
          </div>
          <ExtensionButton type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :disabled="field.disabled" @click="editor.removeFunding(row.id, source.id)">
            {{ t('grantRemoveFunding') }}
          </ExtensionButton>
        </fieldset>
        <ExtensionButton v-if="question.config.fundingSubtypes.length" type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="field.disabled || budgetRow(row).otherFunding.length >= 50" @click="editor.addFunding(row.id)">
          {{ t('grantAddFunding') }}
        </ExtensionButton>
      </div>
      <ExtensionButton type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :disabled="field.disabled" @click="editor.remove(row.id)">
        {{ t('grantRemoveEntry') }}
      </ExtensionButton>
    </fieldset>
    <ExtensionButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="field.disabled || !configured || editor.rows.value.length >= question.config.maxRows" @click="editor.add">
      {{ t(question.type === 'budget' ? 'grantAddBudget' : 'grantAddActivity') }}
    </ExtensionButton>
    <section v-if="editor.totals.value.length" class="space-y-4 border-t border-default pt-5" aria-live="polite">
      <h4 class="font-semibold">
        {{ t('grantSummary') }}
      </h4>
      <div v-for="total in editor.totals.value" :key="`${total.fiscalYearId}:${total.currency}`" class="space-y-2">
        <h5 class="text-sm font-semibold">
          {{ yearLabel(total.fiscalYearId) }} · {{ total.currency }}
        </h5>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
          <template v-for="[label, value] in [[t('grantTotalCost'), total.totalCost], [t('grantProgramFunding'), total.programFunding], [t('grantOtherFunding'), total.otherFunding], [t('grantGap'), total.gap], [t('grantStackingTotal'), total.stacking], [t('grantCostSharingTotal'), total.costSharing]]" :key="label">
            <dt class="text-muted">
              {{ label }}
            </dt><dd class="text-right font-medium">
              {{ value }}
            </dd>
          </template>
        </dl>
      </div>
      <details>
        <summary class="text-sm font-medium">
          {{ t('grantCategoryTotals') }}
        </summary>
        <dl class="mt-3 grid grid-cols-2 gap-2 text-sm tabular-nums">
          <template v-for="total in editor.categoryTotals.value" :key="`${total.fiscalYearId}:${total.currency}:${total.categoryId}`">
            <dt>{{ categoryLabel(total.categoryId) }} · {{ yearLabel(total.fiscalYearId) }} · {{ total.currency }}</dt><dd class="text-right">
              {{ total.totalCost }}
            </dd>
          </template>
        </dl>
      </details>
    </section>
  </fieldset>
</template>

<style scoped>
.grant-wide { grid-column: 1 / -1; }
</style>
