<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { nanoid } from 'nanoid'
import type { ActivityConfig, AdvancedQuestion, BudgetConfig, GrantOption } from '@gcs-ssc/survey'
import { ExtensionButton, ExtensionCheckbox, ExtensionFormField, ExtensionInput, ExtensionSelect, useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import GrantOptionEditor from './GrantOptionEditor.vue'

const props = defineProps<{ agencyId: string; streamId?: string; disabled: boolean }>()
const question = defineModel<Extract<AdvancedQuestion, { type: 'budget' | 'activities' }>>('question', { required: true })
const emit = defineEmits<{ configure: [config: BudgetConfig | ActivityConfig] }>()
const { t, locale } = useExtensionI18n(messages)
const api = useExtensionApi('gcs-ssc-portal-connector')
const streams: Ref<Array<{ id: string; label: { en: string; fr: string } }>> = ref([])
const stream: Ref<string> = ref(question.value.config.source.streamId ?? props.streamId ?? '')
const busy: Ref<boolean> = ref(false)
const error: Ref<string> = ref('')
const locked = computed(() => props.disabled || busy.value || question.value.config.source.mode === 'stream')
const budget = computed(() => question.value.type === 'budget' ? question.value.config : null)
const activities = computed(() => question.value.type === 'activities' ? question.value.config : null)
const items = (options: GrantOption[]) => options.map(option => ({ value: option.id, label: option.label[locale.value === 'fr' ? 'fr' : 'en'] }))
const uid = () => `custom_${nanoid(10)}`
const base = (): GrantOption => ({ id: uid(), label: { en: 'New option', fr: 'Nouveau choix' } })
let request = 0
let alive = true
onBeforeUnmount(() => {
  alive = false
  request++
})
watch(() => props.agencyId, async agencyId => {
  const current = ++request
  streams.value = []
  try {
    const result = await api.get<{ streams: typeof streams.value }>(`/agencies/${agencyId}/form-options`)
    if (current === request) streams.value = result.streams
  } catch { if (current === request) error.value = t('grantLoadFailed') }
}, { immediate: true })
/**
 * Copies a stream snapshot into this question after checking the request identity.
 */
const sync = async () => {
  if (!stream.value || props.disabled || busy.value) return
  const agencyId = props.agencyId, questionId = question.value.id, streamId = stream.value
  busy.value = true
  error.value = ''
  try {
    const result = await api.get<{ budget: BudgetConfig; activities: ActivityConfig }>(`/agencies/${agencyId}/form-options/${streamId}`)
    if (!alive || props.agencyId !== agencyId || question.value.id !== questionId || stream.value !== streamId) return
    if (question.value.type === 'budget') emit('configure', { ...result.budget,
      maxRows: question.value.config.maxRows, currencies: question.value.config.currencies })
    else emit('configure', { ...question.value.config, source: result.activities.source, outcomes: result.activities.outcomes })
  } catch {
    if (alive && props.agencyId === agencyId && question.value.id === questionId) error.value = t('grantLoadFailed')
  } finally { busy.value = false }
}
type Catalog = 'categories' | 'fiscalYears' | 'costItems' | 'fundingTypes' | 'fundingSubtypes' | 'outcomes' | 'responsibleParties'
/**
 * Updates the selected authoring catalog.
 * @param catalog - Catalog containing the authored choice.
 */
const add = (catalog: Catalog) => {
  if (locked.value) return
  if (budget.value) {
    if (catalog === 'categories' || catalog === 'fiscalYears') budget.value[catalog].push(base())
    if (catalog === 'costItems') budget.value.costItems.push({ ...base(), categoryId: budget.value.categories[0]?.id ?? '',
      calculation: { mode: 'manual', sourceCategoryId: null, percentage: null, allowOverride: false } })
    if (catalog === 'fundingTypes' && budget.value.fundingTypes.length < 100) budget.value.fundingTypes.push({ ...base(), stacking: false, costSharing: false })
    if (catalog === 'fundingSubtypes') budget.value.fundingSubtypes.push({ ...base(), typeId: budget.value.fundingTypes[0]?.id ?? '' })
  } else if (activities.value && (catalog === 'outcomes' || catalog === 'responsibleParties')) activities.value[catalog].push(base())
}
/**
 * Updates the selected authoring catalog.
 * @param catalog - Catalog containing the authored choice.
 * @param id - Stable option identity.
 */
const remove = (catalog: Catalog, id: string) => {
  if (locked.value) return
  const hasDependents = budget.value && ((catalog === 'categories' && budget.value.costItems.some(item => item.categoryId === id || item.calculation.sourceCategoryId === id))
    || (catalog === 'fundingTypes' && budget.value.fundingSubtypes.some(item => item.typeId === id)))
  if (hasDependents) {
    error.value = t('grantRemoveBlocked')
    return
  }
  const config = question.value.config as unknown as Record<string, GrantOption[]>
  config[catalog] = config[catalog]!.filter(option => option.id !== id)
  error.value = ''
}
const costItem = (id: string) => budget.value!.costItems.find(item => item.id === id)!
const fundingType = (id: string) => budget.value!.fundingTypes.find(item => item.id === id)!
const fundingSubtype = (id: string) => budget.value!.fundingSubtypes.find(item => item.id === id)!
/**
 * Initializes consistent defaults when changing a calculation mode.
 * @param id - Stable option identity.
 * @param mode - Program funding calculation mode.
 */
const setMode = (id: string, mode: 'manual' | 'category' | 'all_other') => {
  const item = costItem(id)
  item.calculation = mode === 'manual'
    ? { mode, percentage: null, sourceCategoryId: null, allowOverride: false }
    : { mode, percentage: 10, sourceCategoryId: mode === 'category'
        ? budget.value!.categories.find(category => category.id !== item.categoryId
          && !budget.value!.costItems.some(other => other.categoryId === category.id && other.calculation.mode !== 'manual'))?.id ?? null
        : null, allowOverride: false }
}
const sourceCategories = (id: string) => budget.value!.categories.filter(category => category.id !== costItem(id).categoryId
  && !budget.value!.costItems.some(item => item.categoryId === category.id && item.calculation.mode !== 'manual'))
</script>

<template>
  <div class="space-y-4 border-t border-default pt-4">
    <h4 class="font-semibold">
      {{ t('grantSetup') }}
    </h4>
    <p class="text-sm text-muted">
      {{ t('grantSetupHelp') }}
    </p>
    <ExtensionFormField :label="t('grantStream')" :name="`${question.id}-stream`">
      <ExtensionSelect v-model="stream" :name="`${question.id}-stream`" :items="items(streams)" value-key="value" :disabled="disabled || busy" :placeholder="t('grantChoose')" />
    </ExtensionFormField>
    <div class="flex flex-wrap gap-2">
      <ExtensionButton type="button" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :disabled="disabled || busy || !stream" :loading="busy" @click="sync">
        {{ t('grantSync') }}
      </ExtensionButton>
      <ExtensionButton v-if="question.config.source.mode === 'stream'" type="button" color="neutral" variant="ghost" :disabled="disabled || busy" @click="question.config.source.mode = 'custom'">
        {{ t('grantCustom') }}
      </ExtensionButton>
    </div>
    <p class="text-xs text-muted">
      {{ t('grantSyncHelp') }}
    </p>
    <p v-if="question.config.source.capturedAt" class="text-sm text-muted">
      {{ t('grantCaptured', { date: new Date(question.config.source.capturedAt).toLocaleString(locale) }) }}
    </p>
    <p class="text-xs text-muted">
      {{ t('grantSnapshot') }}
    </p>
    <p v-if="error" role="alert" class="text-sm text-error">
      {{ error }}
    </p>
    <ExtensionFormField :label="t('grantMaxRows')" :name="`${question.id}-maxRows`" required>
      <ExtensionInput
        :model-value="question.config.maxRows" :name="`${question.id}-maxRows`" type="number" min="1" max="100" required :disabled="disabled"
        @update:model-value="question.config.maxRows = Number($event)" />
    </ExtensionFormField>
    <p class="text-sm text-muted">
      {{ t('grantMappingHelp') }}
    </p>
    <template v-if="budget">
      <fieldset class="space-y-2">
        <legend class="text-sm font-medium">
          {{ t('grantCurrencies') }}
        </legend>
        <p class="text-xs text-muted">
          {{ t('grantSelectOne') }}
        </p>
        <div class="flex flex-wrap gap-3">
          <ExtensionCheckbox
            v-for="currency in ['CAD', 'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD'] as const" :key="currency" :label="currency" :disabled="disabled"
            :model-value="budget.currencies.includes(currency)" @update:model-value="budget.currencies = $event ? [...budget.currencies, currency] : budget.currencies.filter(item => item !== currency)" />
        </div>
      </fieldset>
      <GrantOptionEditor :title="t('grantCategories')" :options="budget.categories" :prefix="`${question.id}-categories`" :disabled="locked" @add="add('categories')" @remove="remove('categories', $event)" />
      <GrantOptionEditor :title="t('grantYears')" :options="budget.fiscalYears" :prefix="`${question.id}-years`" :disabled="locked" @add="add('fiscalYears')" @remove="remove('fiscalYears', $event)" />
      <p class="text-sm text-muted">
        {{ t('grantCalculationHelp') }}
      </p>
      <GrantOptionEditor :title="t('grantCostItems')" :options="budget.costItems" :prefix="`${question.id}-costs`" :disabled="locked" @add="add('costItems')" @remove="remove('costItems', $event)">
        <template #default="{ option }">
          <ExtensionFormField :label="t('grantCategory')" :name="`${question.id}-${option.id}-category`" required>
            <ExtensionSelect v-model="costItem(option.id).categoryId" :name="`${question.id}-${option.id}-category`" :items="items(budget.categories)" value-key="value" required :disabled="locked" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('grantRatio')" :name="`${question.id}-${option.id}-ratio`">
            <ExtensionInput
              :model-value="costItem(option.id).costSharingRatio ?? ''" :name="`${question.id}-${option.id}-ratio`" type="number" step="0.01" min="-999.99" max="999.99" :disabled="locked"
              @update:model-value="costItem(option.id).costSharingRatio = $event === '' || $event == null ? null : Number($event)" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('grantMode')" :name="`${question.id}-${option.id}-mode`" required>
            <ExtensionSelect
              :model-value="costItem(option.id).calculation.mode" :name="`${question.id}-${option.id}-mode`" required :disabled="locked" value-key="value"
              :items="[{ value: 'manual', label: t('grantManual') }, { value: 'category', label: t('grantCategoryPercentage') }, { value: 'all_other', label: t('grantAllOther') }]"
              @update:model-value="setMode(option.id, $event)" />
          </ExtensionFormField>
          <template v-if="costItem(option.id).calculation.mode !== 'manual'">
            <ExtensionFormField v-if="costItem(option.id).calculation.mode === 'category'" :label="t('grantSourceCategory')" :name="`${question.id}-${option.id}-source`" required>
              <ExtensionSelect v-model="costItem(option.id).calculation.sourceCategoryId" :name="`${question.id}-${option.id}-source`" required :disabled="locked" value-key="value" :items="items(sourceCategories(option.id))" />
            </ExtensionFormField>
            <ExtensionFormField :label="t('grantPercentage')" :name="`${question.id}-${option.id}-percentage`" required>
              <ExtensionInput
                :model-value="costItem(option.id).calculation.percentage ?? ''" :name="`${question.id}-${option.id}-percentage`" required type="number" min="0" max="100" step="0.01" :disabled="locked"
                @update:model-value="costItem(option.id).calculation.percentage = $event === '' || $event == null ? null : Number($event)" />
            </ExtensionFormField>
            <ExtensionCheckbox v-model="costItem(option.id).calculation.allowOverride" :label="t('grantOverride')" :disabled="locked" />
          </template>
        </template>
      </GrantOptionEditor>
      <p class="text-sm text-muted">
        {{ t('grantFundingHelp') }}
      </p>
      <GrantOptionEditor :title="t('grantFundingTypes')" :options="budget.fundingTypes" :prefix="`${question.id}-types`" :disabled="locked" @add="add('fundingTypes')" @remove="remove('fundingTypes', $event)">
        <template #default="{ option }">
          <ExtensionCheckbox v-model="fundingType(option.id).stacking" :label="t('grantStacking')" :disabled="locked" />
          <ExtensionCheckbox v-model="fundingType(option.id).costSharing" :label="t('grantCostSharing')" :disabled="locked" />
        </template>
      </GrantOptionEditor>
      <GrantOptionEditor :title="t('grantFundingSubtypes')" :options="budget.fundingSubtypes" :prefix="`${question.id}-subtypes`" :disabled="locked" @add="add('fundingSubtypes')" @remove="remove('fundingSubtypes', $event)">
        <template #default="{ option }">
          <ExtensionFormField :label="t('grantFundingType')" :name="`${question.id}-${option.id}-type`" required>
            <ExtensionSelect v-model="fundingSubtype(option.id).typeId" :name="`${question.id}-${option.id}-type`" value-key="value" required :disabled="locked" :items="items(budget.fundingTypes)" />
          </ExtensionFormField>
        </template>
      </GrantOptionEditor>
    </template>
    <template v-if="activities">
      <ExtensionCheckbox v-model="activities.requireOutcomes" :label="t('grantRequireOutcomes')" :disabled="disabled" />
      <ExtensionCheckbox v-model="activities.requireResponsibleParties" :label="t('grantRequireParties')" :disabled="disabled" />
      <ExtensionCheckbox v-model="activities.bilingual" :label="t('grantBilingual')" :disabled="disabled" />
      <p class="text-sm text-muted">
        {{ t('grantBilingualHelp') }}
      </p>
      <GrantOptionEditor :title="t('grantOutcomes')" :options="activities.outcomes" :prefix="`${question.id}-outcomes`" :disabled="locked" @add="add('outcomes')" @remove="remove('outcomes', $event)" />
      <p class="text-sm text-muted">
        {{ t('grantPartyHelp') }}
      </p>
      <GrantOptionEditor :title="t('grantParties')" :options="activities.responsibleParties" :prefix="`${question.id}-parties`" :disabled="disabled" @add="activities.responsibleParties.push(base())" @remove="activities.responsibleParties = activities.responsibleParties.filter(option => option.id !== $event)" />
    </template>
    <p v-if="!locked && question.config.source.capturedAt" class="text-xs text-muted">
      {{ t('grantCustomEdit') }}
    </p>
  </div>
</template>
