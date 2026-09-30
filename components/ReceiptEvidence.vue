<script setup lang="ts">
import { computed } from 'vue'
import { HeadlessSurvey, type SurveyField } from '@gcs-ssc/survey/vue'
import { surveySchema, answersSchema, upgradeToAdvancedSurvey } from '@gcs-ssc/survey'
import { ExtensionButton, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import { receiptAttachmentSchema } from '../shared/receipt-attachments'
import FormTestSection from './FormTestSection.vue'
const props = defineProps<{ source: unknown; agencyId?: string; receiptId?: string }>()
const { locale, t } = useExtensionI18n(messages)
const language = computed(() => locale.value === 'fr' ? 'fr' as const : 'en' as const)
const attachments = computed(() => {
  const source = props.source as { attachments?: unknown[] } | null
  return (Array.isArray(source?.attachments) ? source.attachments : []).flatMap(value => {
    const parsed = receiptAttachmentSchema.safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
})
// Preserve immutable answers while allowing the provider to navigate their saved route.
const readonlyFields = (fields: SurveyField[]): SurveyField[] => fields.map(field => ({ ...field, disabled: true, setValue: () => {} }))
const forms = computed(() => {
  const source = props.source as { items?: unknown[] } | null
  return (source?.items ?? []).filter(item => (item as { kind?: string }).kind === 'survey').map(item => {
    const value = item as { itemSubmissionId: string; definition: unknown; answers: unknown }
    return { id: value.itemSubmissionId, definition: upgradeToAdvancedSurvey(surveySchema.parse(value.definition)),
      answers: answersSchema.parse(value.answers) }
  })
})
</script>

<template>
  <div class="space-y-6">
    <section v-if="attachments.length" class="space-y-2">
      <h3 class="text-base font-semibold">{{ t('receiptAttachments') }}</h3>
      <p class="text-sm text-muted">{{ t('receiptAttachmentsHelp') }}</p>
      <ul class="space-y-2"><li v-for="attachment in attachments" :key="attachment.id" class="flex items-center justify-between gap-3">
        <span class="text-sm">{{ attachment.filename }} · {{ attachment.size }} {{ t('receiptAttachmentBytes') }}</span>
        <ExtensionButton v-if="agencyId && receiptId" icon="i-lucide-download" color="neutral" variant="outline" external
          :href="`/api/extensions/gcs-ssc-portal-connector/agencies/${encodeURIComponent(agencyId)}/receipts/${encodeURIComponent(receiptId)}/attachments/${encodeURIComponent(attachment.id)}`">
          {{ t('receiptAttachmentDownload') }}
        </ExtensionButton>
      </li></ul>
    </section>
    <section v-for="form in forms" :key="form.id" class="space-y-3">
      <h3 class="text-base font-semibold">{{ form.definition.title[language] }}</h3>
      <HeadlessSurvey :definition="form.definition" :model-value="form.answers" :locale="language">
        <template #default="{ fields, page, canBack, isLastPage, next, back, complete }">
          <div v-if="page && !complete" class="space-y-4">
            <h4 class="font-medium">{{ page.title[language] }}</h4>
            <FormTestSection :question-ids="page.questionIds" :groups="'groups' in page ? page.groups : []"
              :definition-groups="form.definition.pages.find(item => item.id === page.id)?.groups ?? []"
              :fields="readonlyFields(fields)" :locale="language" />
            <div class="flex justify-between">
              <ExtensionButton v-if="canBack" color="neutral" variant="outline" @click="back">{{ t('previewPrevious') }}</ExtensionButton>
              <ExtensionButton v-if="!isLastPage" color="neutral" variant="outline" @click="next">{{ t('previewNext') }}</ExtensionButton>
            </div>
          </div>
        </template>
      </HeadlessSurvey>
    </section>
  </div>
</template>
