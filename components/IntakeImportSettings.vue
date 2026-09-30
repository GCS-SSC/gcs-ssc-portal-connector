<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue'
import { ExtensionAlert, ExtensionButton, ExtensionFormField, ExtensionSaveButton, ExtensionSelect,
  useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { intakeSettingsMessages } from '../i18n/intake-settings'

interface IntakeGroup { id: string; nameEn: string; nameFr: string }
interface Settings { groups: IntakeGroup[]; intakeGroupId: string | null; ready: boolean }
const props = defineProps<{ agencyId: string; readOnly?: boolean; disabled?: boolean }>()
const { t, locale } = useExtensionI18n(intakeSettingsMessages)
const api = useExtensionApi('gcs-ssc-portal-connector')
const groups: Ref<IntakeGroup[]> = ref([])
const groupId: Ref<string | null> = ref(null)
const loading = ref(false)
const saving = ref(false)
const loaded = ref(false)
const failure: Ref<'loadFailed' | 'saveFailed' | null> = ref(null)
const success = ref(false)
let generation = 0
const endpoint = computed(() => `/agencies/${props.agencyId}/intake-group-settings`)
const selectedAvailable = computed(() => groupId.value !== null && groups.value.some(group => group.id === groupId.value))
const noGroup = '__none__'
const options = computed(() => [
  { value: noGroup, label: t('none') },
  ...(groupId.value !== null && !selectedAvailable.value ? [{ value: groupId.value, label: t('unavailable') }] : []),
  ...groups.value.map(group => ({ value: group.id, label: locale.value === 'fr' ? group.nameFr : group.nameEn }))
])
const updateSelection = (value: unknown) => {
  groupId.value = typeof value === 'string' && value !== '' && value !== noGroup ? value : null
  success.value = false
}
const apply = (result: Settings) => {
  groups.value = result.groups
  groupId.value = result.intakeGroupId
  loaded.value = true
}
const load = async () => {
  const current = ++generation
  loading.value = true
  failure.value = null
  try {
    const result = await api.get<Settings>(endpoint.value)
    if (current === generation) apply(result)
  } catch {
    if (current === generation) failure.value = 'loadFailed'
  } finally {
    if (current === generation) loading.value = false
  }
}
const save = async () => {
  if (!loaded.value || props.readOnly || props.disabled || saving.value) return
  const current = generation
  saving.value = true
  failure.value = null
  success.value = false
  try {
    const result = await api.put<Settings>(endpoint.value, { intakeGroupId: groupId.value })
    if (current === generation) { apply(result); success.value = true }
  } catch {
    if (current === generation) failure.value = 'saveFailed'
  } finally {
    if (current === generation) saving.value = false
  }
}
watch(() => props.agencyId, () => {
  groups.value = []
  groupId.value = null
  loaded.value = false
  saving.value = false
  success.value = false
  void load()
}, { immediate: true })
</script>
<template>
  <section :aria-label="t('title')" class="space-y-4" :aria-busy="loading || saving">
    <h3 class="text-lg font-semibold">{{ t('title') }}</h3>
    <ExtensionAlert v-if="failure" color="error" :description="t(failure)" />
    <ExtensionButton v-if="failure === 'loadFailed'" :label="t('retry')" :disabled="loading" @click="load" />
    <template v-if="loaded">
      <ExtensionAlert v-if="groupId === null" color="warning" :description="t('prerequisite')" />
      <ExtensionAlert v-else-if="!selectedAvailable" color="warning" :description="t('unavailable')" />
      <ExtensionFormField name="intakeGroupId" :label="t('groupLabel')" :description="t('groupHint')" :required="false">
        <ExtensionSelect :model-value="groupId ?? noGroup" name="intakeGroupId" :items="options" :aria-label="t('groupLabel')"
          :disabled="readOnly || disabled || loading || saving" @update:model-value="updateSelection" />
      </ExtensionFormField>
      <ExtensionSaveButton v-if="!readOnly" :label="t('save')" :loading="saving" :disabled="disabled || loading || saving"
        @click="save" />
      <ExtensionAlert v-if="success" color="success" :description="t('saved')" />
    </template>
  </section>
</template>
