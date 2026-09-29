<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import type { Ref } from 'vue'
import { HeadlessSurvey } from '@gcs-ssc/survey/vue'
import type { SurveyField } from '@gcs-ssc/survey/vue'
import type { AdvancedSurvey, ResolvedAdvancedGroup } from '@gcs-ssc/survey'
import { ExtensionButton } from '@gcs-ssc/extensions/ui'
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { messages } from '../i18n/messages'
import FormTestSection from './FormTestSection.vue'

const props = defineProps<{ definition: AdvancedSurvey; locale: 'en' | 'fr' }>()
const t = (key: keyof typeof messages.en, values?: Record<string, string | number>) => translateGcsExtensionMessage(messages, props.locale, key, values)
const answers: Ref<Record<string, string>> = ref({})
const prefix = useId()
watch(() => props.definition, () => {
  answers.value = {}
}, { deep: true })
/**
 * Moves focus to the new page or validation summary after navigation.
 * @param action The survey navigation action.
 * @returns Completion of the focus update.
 */
const navigate = async (action: (() => boolean) | (() => void)) => {
  const result = action()
  await nextTick()
  document.getElementById(`${prefix}-${result === false ? 'errors' : 'page'}`)?.focus()
}
/**
 * Names an invalid answer with its section and repeated-entry context.
 * @param fields The resolved fields on the current page.
 * @param groups The resolved section hierarchy.
 * @param id The answer instance key.
 * @returns The readable context and question label.
 */
const answerLabel = (fields: SurveyField[], groups: ResolvedAdvancedGroup[], id: string): string => {
  /**
   * Finds the headings enclosing an answer instance.
   * @param items The current section level.
   * @returns The enclosing headings, when an answer is found.
   */
  const context = (items: ResolvedAdvancedGroup[]): string[] | undefined => {
    for (const group of items) {
      if (group.questionIds.includes(id)) return [group.title[props.locale]]
      const nested = context(group.groups)
      if (nested) return [group.title[props.locale], ...nested]
    }
  }
  return [...context(groups) ?? [], fields.find(field => field.id === id)?.label ?? ''].join(' · ')
}
const focusField = (id: string) => (document.getElementById(`${id}-control`) ?? document.getElementById(id))?.focus()
const previous = (back: () => void, complete: boolean, pageIndex: number) => {
  back()
  if (complete && pageIndex > 0) back()
}
</script>

<template>
  <div class="space-y-5">
    <p class="text-sm text-muted">
      {{ t('previewNotice') }}
    </p>
    <HeadlessSurvey v-model="answers" :definition="definition" :locale="locale">
      <template #default="{ fields, page, pageIndex, canBack, isLastPage, complete, errors, next, back }">
        <form class="preview-form space-y-6" novalidate @submit.prevent="navigate(next)">
          <header class="space-y-2 border-b border-default pb-5">
            <h3 class="text-xl font-semibold">
              {{ definition.title[locale] }}
            </h3>
            <p v-if="definition.description?.[locale]" class="text-sm text-muted whitespace-pre-line">
              {{ definition.description[locale] }}
            </p>
          </header>
          <div v-if="Object.keys(errors).length" :id="`${prefix}-errors`" tabindex="-1" role="alert" class="space-y-2 border-l-2 border-error pl-4">
            <p class="font-semibold text-error">
              {{ t('previewErrorTitle') }}
            </p>
            <ul class="space-y-1 text-sm">
              <li v-for="(error, id) in errors" :key="id">
                <a :href="`#${id}`" class="text-error underline" @click.prevent="focusField(String(id))">
                  {{ answerLabel(fields, page && 'groups' in page ? page.groups : [], String(id)) }}: {{ t(`previewError_${error}`) }}
                </a>
              </li>
            </ul>
          </div>
          <div :id="`${prefix}-page`" tabindex="-1" class="space-y-6">
            <div v-if="complete" role="status" class="space-y-2">
              <p class="font-semibold text-success">
                {{ t('previewValid') }}
              </p>
              <p class="text-sm text-muted">
                {{ t('previewComplete') }}
              </p>
            </div>
            <template v-else-if="page && 'groups' in page">
              <header class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wide text-muted">
                  {{ t('previewPage', { number: pageIndex + 1 }) }}
                </p>
                <h4 class="text-lg font-semibold">
                  {{ page.title[locale] }}
                </h4>
                <p v-if="page.description?.[locale]" class="text-sm text-muted whitespace-pre-line">
                  {{ page.description[locale] }}
                </p>
              </header>
              <FormTestSection
                :question-ids="page.questionIds" :groups="page.groups"
                :definition-groups="definition.pages.find(item => item.id === page.id)?.groups ?? []" :fields="fields" :locale="locale" />
            </template>
          </div>
          <div class="flex flex-wrap gap-3 border-t border-default pt-5">
            <ExtensionButton v-if="canBack" type="button" color="neutral" variant="outline" @click="navigate(() => previous(back, complete, pageIndex))">
              {{ t('previewPrevious') }}
            </ExtensionButton>
            <ExtensionButton v-if="!complete" type="submit">
              {{ t(isLastPage ? 'previewCheck' : 'previewNext') }}
            </ExtensionButton>
          </div>
        </form>
      </template>
    </HeadlessSurvey>
  </div>
</template>

<style scoped>
.preview-form { width: 100%; max-width: 48rem; margin-inline: auto; }
</style>
