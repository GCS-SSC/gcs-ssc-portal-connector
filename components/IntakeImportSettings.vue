<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue'
import { ExtensionAlert, ExtensionButton, ExtensionFormField, ExtensionSaveButton, ExtensionSelect,
  useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { intakeSettingsMessages } from '../i18n/intake-settings'
import { usePortalRequest } from './usePortalRequest'

interface IntakeGroup { id: string; nameEn: string; nameFr: string }
interface Settings { groups: IntakeGroup[]; intakeGroupId: string | null; ready: boolean }
const props = defineProps<{ agencyId: string; readOnly?: boolean; disabled?: boolean }>()
const { t, locale } = useExtensionI18n(intakeSettingsMessages)
const api = useExtensionApi('gcs-ssc-portal-connector')
const groups: Ref<IntakeGroup[]> = ref([])
const groupId: Ref<string | null> = ref(null)
const loadRequest = usePortalRequest()
const saveRequest = usePortalRequest()
const loading = loadRequest.pending
const saving = saveRequest.pending
const accepted: Ref<Settings | null> = ref(null)
const loaded = computed(() => accepted.value !== null)
const feedback: Ref<'none' | 'loadFailed' | 'saveFailed' | 'saved'> = ref('none')
const failure = computed(() => feedback.value === 'loadFailed' || feedback.value === 'saveFailed' ? feedback.value : null)
const success = computed(() => feedback.value === 'saved')
const endpoint = computed(() => `/agencies/${props.agencyId}/intake-group-settings`)
const selectedAvailable = computed(() => groupId.value !== null && groups.value.some(group => group.id === groupId.value))
const noGroup = '__none__'
const options = computed(() => [
  { value: noGroup, label: t('none') },
  ...(groupId.value !== null && !selectedAvailable.value ? [{ value: groupId.value, label: t('unavailable') }] : []),
  ...groups.value.map(group => ({ value: group.id, label: /^fr(?:-|$)/i.test(locale.value) ? group.nameFr : group.nameEn }))
])
const updateSelection = (value: unknown) => {
  groupId.value = typeof value === 'string' && value !== '' && value !== noGroup ? value : null
  feedback.value = 'none'
}
const apply = (result: Settings) => {
  groups.value = result.groups
  groupId.value = result.intakeGroupId
  accepted.value = result
}
const load = async () => {
  const request = loadRequest.begin()
  if (!request) return
  saveRequest.invalidate()
  const path = endpoint.value
  feedback.value = 'none'
  try {
    const result = await api.get<Settings>(path)
    if (!loadRequest.isCurrent(request)) return
    apply(result)
    loadRequest.succeed(request)
  } catch {
    if (!loadRequest.isCurrent(request)) return
    feedback.value = 'loadFailed'
    loadRequest.fail(request)
  }
}
const save = async () => {
  if (!loaded.value || props.readOnly || props.disabled || saving.value) return
  const request = saveRequest.begin()
  if (!request) return
  const path = endpoint.value
  const selectedGroup = groupId.value
  feedback.value = 'none'
  try {
    const result = await api.put<Settings>(path, { intakeGroupId: selectedGroup })
    if (!saveRequest.isCurrent(request)) return
    apply(result)
    feedback.value = 'saved'
    saveRequest.succeed(request)
  } catch {
    if (!saveRequest.isCurrent(request)) return
    feedback.value = 'saveFailed'
    saveRequest.fail(request)
  }
}
watch(() => props.agencyId, () => {
  loadRequest.invalidate()
  saveRequest.invalidate()
  groups.value = []
  groupId.value = null
  accepted.value = null
  feedback.value = 'none'
  void load()
}, { immediate: true, flush: 'sync' })
</script>
<template>
  <section :aria-label="t('title')" class="space-y-4" :aria-busy="loading || saving" data-field-scope="extension.gcs-ssc-portal-connector.intake-import-settings">
    <h3 class="text-lg font-semibold">{{ t('title') }}</h3>
    <ExtensionAlert v-if="failure" color="error" :description="t(failure)" />
    <ExtensionButton v-if="failure === 'loadFailed'" :label="t('retry')" :disabled="loading" @click="load" />
    <template v-if="loaded">
      <ExtensionAlert v-if="groupId === null" color="warning" :description="t('prerequisite')" />
      <ExtensionAlert v-else-if="!selectedAvailable" color="warning" :description="t('unavailable')" />
      <ExtensionFormField name="intakeGroupId" :label="t('groupLabel')" :description="t('groupHint')" :required="false">
        <ExtensionSelect
          :model-value="groupId ?? noGroup" name="intakeGroupId" :items="options" :aria-label="t('groupLabel')"
          :disabled="readOnly || disabled || loading || saving" @update:model-value="updateSelection" />
      </ExtensionFormField>
      <ExtensionSaveButton
        v-if="!readOnly" :label="t('save')" :loading="saving" :disabled="disabled || loading || saving"
        @click="save" />
      <ExtensionAlert v-if="success" color="success" :description="t('saved')" />
    </template>
  </section>
</template>
