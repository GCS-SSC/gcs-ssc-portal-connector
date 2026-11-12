<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue'
import { nanoid } from 'nanoid'
import { ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionModal, ExtensionTable, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'

type Choice = { value: string; label: { en: string; fr: string } }
type ChoiceSession = { kind: 'closed' } | { kind: 'create'; draft: Choice } | { kind: 'edit'; draft: Choice }
const props = defineProps<{ options: Choice[]; disabled: boolean; questionId: string }>()
const emit = defineEmits<{ 'update:options': [options: Choice[]] }>()
const { locale, t } = useExtensionI18n(messages)
const session: Ref<ChoiceSession> = ref({ kind: 'closed' })
const draft = computed(() => session.value.kind === 'closed' ? null : session.value.draft)
const removing: Ref<Choice | null> = ref(null)
const isNew = computed(() => session.value.kind === 'create')
const close = () => { session.value = { kind: 'closed' } }
const columns = computed(() => [{ id: 'english', accessorKey: 'english', header: t('formChoiceEnglish') }, { id: 'french', accessorKey: 'french', header: t('formChoiceFrench') }, { id: 'actions', header: t('formChoiceActions') }])
const rows = computed(() => props.options.map(option => ({ ...option, english: option.label.en, french: option.label.fr })))
/**
 * Stage an option; cancel never changes the question.
 * @param choice - Existing option to edit, or omit to add.
 */
const edit = (choice?: Choice) => {
  session.value = choice
    ? { kind: 'edit', draft: { value: choice.value, label: { ...choice.label } } }
    : { kind: 'create', draft: { value: `option_${nanoid(12)}`, label: { en: '', fr: '' } } }
}
/** Retain stable IDs when renaming a choice. */
const save = () => {
  const current = session.value
  if (props.disabled || current.kind === 'closed' || !current.draft.label.en.trim() || !current.draft.label.fr.trim()) return
  const option = { value: current.draft.value, label: { en: current.draft.label.en.trim(), fr: current.draft.label.fr.trim() } }
  emit('update:options', current.kind === 'create' ? [...props.options, option] : props.options.map(item => item.value === option.value ? option : item))
  close()
}
/** Remove a confirmed option while keeping a usable choice catalog. */
const remove = () => {
  const selected = removing.value
  if (!props.disabled && selected && props.options.length > 1) emit('update:options', props.options.filter(item => item.value !== selected.value))
  removing.value = null
}
watch(() => props.questionId, () => {
  close()
  removing.value = null
}, { flush: 'sync' })
</script>

<template>
  <div class="space-y-3" data-field-scope="extension.gcs-ssc-portal-connector.form-choice-editor">
    <div class="flex justify-end">
      <ExtensionButton type="button" icon="i-lucide-plus" color="neutral" variant="outline" :disabled="disabled || options.length >= 50" @click="edit()">
        {{ t('formChoiceAdd') }}
      </ExtensionButton>
    </div>
    <ExtensionTable :data="rows" :columns="columns" class="rounded-lg border border-default">
      <template #actions-cell="{ row }">
        <div class="flex justify-end gap-1">
          <ExtensionButton type="button" icon="i-lucide-pencil" color="neutral" variant="ghost" :disabled="disabled" :aria-label="`${t('formChoiceEdit')}: ${row.original.label[locale === 'fr' ? 'fr' : 'en'] || row.original.label.en || row.original.label.fr}`" @click="edit(row.original)" />
          <ExtensionButton type="button" icon="i-lucide-trash-2" color="error" variant="ghost" :disabled="disabled || options.length === 1" :aria-label="`${t('formChoiceDelete')}: ${row.original.label[locale === 'fr' ? 'fr' : 'en'] || row.original.label.en || row.original.label.fr}`" @click="removing = row.original" />
        </div>
      </template>
    </ExtensionTable>
    <ExtensionModal :open="Boolean(draft)" :title="t(isNew ? 'formChoiceAdd' : 'formChoiceEdit')" @update:open="!$event && close()">
      <template #body>
        <form v-if="draft" class="space-y-4" @submit.prevent="save">
          <ExtensionFormField :label="t('formChoiceEnglish')" name="choiceEn" required>
            <ExtensionInput v-model="draft.label.en" name="choiceEn" required maxlength="200" :disabled="disabled" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('formChoiceFrench')" name="choiceFr" required>
            <ExtensionInput v-model="draft.label.fr" name="choiceFr" required maxlength="200" :disabled="disabled" />
          </ExtensionFormField>
          <div class="flex justify-end gap-2">
            <ExtensionButton type="button" color="neutral" variant="outline" @click="close">
              {{ t('formDetailsCancel') }}
            </ExtensionButton><ExtensionButton type="submit" :disabled="disabled || !draft.label.en.trim() || !draft.label.fr.trim()">
              {{ t('formChoiceSave') }}
            </ExtensionButton>
          </div>
        </form>
      </template>
    </ExtensionModal>
    <ExtensionModal :open="Boolean(removing)" :title="t('formChoiceDelete')" @update:open="!$event && (removing = null)">
      <template #body>
        <p>{{ t('formChoiceDeleteConfirm', { choice: removing?.label.en ?? '' }) }}</p><div class="flex justify-end gap-2 pt-4">
          <ExtensionButton type="button" color="neutral" variant="outline" @click="removing = null">
            {{ t('formDetailsCancel') }}
          </ExtensionButton><ExtensionButton type="button" color="error" :disabled="disabled" @click="remove">
            {{ t('formChoiceDelete') }}
          </ExtensionButton>
        </div>
      </template>
    </ExtensionModal>
  </div>
</template>
