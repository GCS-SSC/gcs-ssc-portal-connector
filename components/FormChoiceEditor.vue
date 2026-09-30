<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue'
import { nanoid } from 'nanoid'
import { ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionModal, ExtensionTable, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'

type Choice = { value: string; label: { en: string; fr: string } }
const props = defineProps<{ options: Choice[]; disabled: boolean; questionId: string }>()
const emit = defineEmits<{ 'update:options': [options: Choice[]] }>()
const { t } = useExtensionI18n(messages)
const draft: Ref<Choice | null> = ref(null)
const removing: Ref<Choice | null> = ref(null)
const isNew: Ref<boolean> = ref(false)
const columns = computed(() => [{ id: 'english', accessorKey: 'english', header: t('formChoiceEnglish') }, { id: 'french', accessorKey: 'french', header: t('formChoiceFrench') }, { id: 'actions', header: t('formChoiceActions') }])
const rows = computed(() => props.options.map(option => ({ ...option, english: option.label.en, french: option.label.fr })))
/**
 * Stage an option; cancel never changes the question.
 * @param choice - Existing option to edit, or omit to add.
 */
const edit = (choice?: Choice) => {
  isNew.value = !choice
  draft.value = choice ? { value: choice.value, label: { ...choice.label } } : { value: `option_${nanoid(12)}`, label: { en: '', fr: '' } }
}
/** Retain stable IDs when renaming a choice. */
const save = () => {
  if (props.disabled || !draft.value?.label.en.trim() || !draft.value.label.fr.trim()) return
  const option = { value: draft.value.value, label: { en: draft.value.label.en.trim(), fr: draft.value.label.fr.trim() } }
  emit('update:options', isNew.value ? [...props.options, option] : props.options.map(item => item.value === option.value ? option : item))
  draft.value = null
}
/** Remove a confirmed option while keeping a usable choice catalog. */
const remove = () => {
  if (!props.disabled && removing.value && props.options.length > 1) emit('update:options', props.options.filter(item => item.value !== removing.value!.value))
  removing.value = null
}
watch(() => props.questionId, () => {
  draft.value = null
  removing.value = null
})
</script>

<template>
  <div class="space-y-3">
    <div class="flex justify-end">
      <ExtensionButton type="button" icon="i-lucide-plus" color="neutral" variant="outline" :disabled="disabled || options.length >= 50" @click="edit()">
        {{ t('formChoiceAdd') }}
      </ExtensionButton>
    </div>
    <ExtensionTable :data="rows" :columns="columns" class="rounded-lg border border-default">
      <template #actions-cell="{ row }">
        <div class="flex justify-end gap-1">
          <ExtensionButton type="button" icon="i-lucide-pencil" color="neutral" variant="ghost" :disabled="disabled" :aria-label="`${t('formChoiceEdit')}: ${row.original.label.en}`" @click="edit(row.original)" />
          <ExtensionButton type="button" icon="i-lucide-trash-2" color="error" variant="ghost" :disabled="disabled || options.length === 1" :aria-label="`${t('formChoiceDelete')}: ${row.original.label.en}`" @click="removing = row.original" />
        </div>
      </template>
    </ExtensionTable>
    <ExtensionModal :open="Boolean(draft)" :title="t(isNew ? 'formChoiceAdd' : 'formChoiceEdit')" @update:open="!$event && (draft = null)">
      <template #body>
        <form v-if="draft" class="space-y-4" @submit.prevent="save">
          <ExtensionFormField :label="t('formChoiceEnglish')" name="choiceEn" required>
            <ExtensionInput v-model="draft.label.en" name="choiceEn" required maxlength="200" :disabled="disabled" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('formChoiceFrench')" name="choiceFr" required>
            <ExtensionInput v-model="draft.label.fr" name="choiceFr" required maxlength="200" :disabled="disabled" />
          </ExtensionFormField>
          <div class="flex justify-end gap-2">
            <ExtensionButton type="button" color="neutral" variant="outline" @click="draft = null">
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
