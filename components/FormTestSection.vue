<script setup lang="ts">
import { computed } from 'vue'
import { nanoid } from 'nanoid'
import { parseList, type AdvancedGroup, type ResolvedAdvancedGroup } from '@gcs-ssc/survey'
import type { SurveyField } from '@gcs-ssc/survey/vue'
import { ExtensionButton } from '@gcs-ssc/extensions/ui'
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { messages } from '../i18n/messages'
import FormTestControl from './FormTestControl.vue'

const { questionIds, groups, definitionGroups, fields, locale, depth = 0 } = defineProps<{
  questionIds: string[]; groups: ResolvedAdvancedGroup[]; definitionGroups: AdvancedGroup[]
  fields: SurveyField[]; locale: 'en' | 'fr'; depth?: number
}>()
const t = (key: keyof typeof messages.en, values?: Record<string, string | number>) => translateGcsExtensionMessage(messages, locale, key, values)
const fieldFor = (id: string) => fields.find(field => field.id === id)
// Only combine a private repeat source with its single, unconditional direct section.
// Shared, conditional, list-backed, or cross-container sections retain their defined order.
/**
 * Finds a repeat source's single unconditional direct section.
 * @param id The resolved repeat-source key.
 * @returns The section that can be rendered with its source controls.
 */
const repeatGroupFor = (id: string) => {
  const field = fieldFor(id)
  if (field?.question.type !== 'repeat') return undefined
  const candidates = definitionGroups.filter(group => group.repeatFor === field.question.id)
  return candidates.length === 1 && !candidates[0]!.visibleWhen ? candidates[0] : undefined
}
type RepeatField = SurveyField & { question: Extract<SurveyField['question'], { type: 'repeat' }> }
const renderedFields = computed(() => questionIds.filter(id => !repeatGroupFor(id)).map(fieldFor).filter((field): field is SurveyField => Boolean(field)))
const sections = computed(() => definitionGroups.map(group => {
  const sourceId = questionIds.find(id => repeatGroupFor(id)?.id === group.id)
  const field = sourceId ? fieldFor(sourceId) : undefined
  const source = field?.question.type === 'repeat' ? field as RepeatField : undefined
  return { definition: group, source, instances: groups.filter(instance => instance.id === group.id) }
}))
/**
 * Adds one entry while enforcing the repeat limit and disabled state.
 * @param field The resolved repeat source.
 */
const add = (field: SurveyField) => {
  if (field.disabled || field.question.type !== 'repeat') return
  const rows = parseList(field.value)
  if (rows.length < field.question.maxItems) field.setValue(JSON.stringify([...rows, { id: `r_${nanoid()}`, value: '' }]))
}
const remove = (field: SurveyField, instanceId?: string) => {
  if (!field.disabled) field.setValue(JSON.stringify(parseList(field.value).filter(row => row.id !== instanceId)))
}
</script>

<template>
  <div class="space-y-6 min-w-0">
    <FormTestControl v-for="field in renderedFields" :key="field.id" :field="field" :locale="locale" />
    <template v-for="section in sections" :key="section.definition.id">
      <fieldset
        v-if="section.source" :id="section.source.id" tabindex="-1" class="min-w-0 space-y-4 border-t border-default pt-4" data-repeat-set
        :aria-describedby="section.source.error ? `${section.source.id}-repeat-error` : undefined">
        <legend class="px-1 font-semibold">
          {{ section.source.label }}<span v-if="section.source.required" class="ml-1 text-xs font-normal text-muted">{{ t('previewRequired') }}</span>
        </legend>
        <p v-if="section.source.hint" class="text-sm text-muted">
          {{ section.source.hint }}
        </p>
        <p class="text-sm text-muted">
          {{ t('previewEntryCount', { count: parseList(section.source.value).length, max: section.source.question.maxItems }) }}
        </p>
        <section
          v-for="group in section.instances" :key="group.instanceId" class="min-w-0 border-l-2 border-default pl-4 space-y-4" data-repeat-entry
          :aria-label="group.title[locale]">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <component :is="depth ? 'h6' : 'h5'" class="font-semibold">
              {{ group.title[locale] }}
            </component>
            <ExtensionButton
              type="button" color="neutral" variant="ghost" :disabled="section.source.disabled"
              :aria-label="t('previewRemoveEntry', { label: group.title[locale] })" @click="remove(section.source, group.instanceId)">
              {{ t('previewRemove') }}
            </ExtensionButton>
          </div>
          <p v-if="group.description?.[locale]" class="text-sm text-muted whitespace-pre-line">
            {{ group.description[locale] }}
          </p>
          <FormTestSection
            :question-ids="group.questionIds" :groups="group.groups" :definition-groups="section.definition.groups"
            :fields="fields" :locale="locale" :depth="depth + 1" />
        </section>
        <p v-if="section.source.error" :id="`${section.source.id}-repeat-error`" role="alert" class="text-sm text-error">
          {{ t(`previewError_${section.source.error ?? 'unknown'}`) }}
        </p>
        <ExtensionButton type="button" color="neutral" variant="outline" :disabled="section.source.disabled || parseList(section.source.value).length >= section.source.question.maxItems" @click="add(section.source)">
          {{ t('previewAddAnother') }}
        </ExtensionButton>
      </fieldset>
      <template v-else>
        <section
          v-for="group in section.instances" :key="`${group.id}-${group.instanceId ?? 'single'}`"
          class="space-y-4 border-t border-default pt-5" :aria-label="group.title[locale]">
          <component :is="depth ? 'h6' : 'h5'" class="font-semibold">
            {{ group.title[locale] }}
          </component>
          <p v-if="group.description?.[locale]" class="text-sm text-muted whitespace-pre-line">
            {{ group.description[locale] }}
          </p>
          <FormTestSection
            :question-ids="group.questionIds" :groups="group.groups" :definition-groups="section.definition.groups"
            :fields="fields" :locale="locale" :depth="depth + 1" />
        </section>
      </template>
    </template>
  </div>
</template>
