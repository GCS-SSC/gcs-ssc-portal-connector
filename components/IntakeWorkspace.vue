<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue'
import { ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionSaveButton, ExtensionSelect,
  useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { FetchResponseError } from '@gcs-ssc/extensions'
import { messages } from '../i18n/messages'
import { intakeDraftSchema, type IntakeDraft } from '../shared/intake'
import FormCreator from './FormCreator.vue'

type Intake = IntakeDraft & {
  id: string; revision: number; published: boolean; surveyId: string | null; surveyRevision: number | null
}
type Stream = { id: string; nameEn: string; nameFr: string }
const props = defineProps<{ agencyId: string; disabled?: boolean }>()
const { t, locale } = useExtensionI18n(messages)
const api = useExtensionApi('gcs-ssc-portal-connector')
const endpoint = computed(() => `/agencies/${props.agencyId}/intakes`)
const intakes: Ref<Intake[]> = ref([])
const streams: Ref<Stream[]> = ref([])
const selectedId = ref<string | null>(null)
const selected = computed(() => intakes.value.find((item) => item.id === selectedId.value) ?? null)
const draft: Ref<IntakeDraft | null> = ref(null)
const editingRevision: Ref<number | null> = ref(null)
const revisionConflict = ref(false)
const requestKey = ref('')
const editingForm = ref(false)
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const message = ref('')
const search = ref('')
const fieldErrors: Ref<Partial<Record<keyof IntakeDraft, string>>> = ref({})
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase(locale.value)
  if (!query) return intakes.value
  return intakes.value.filter((item) => [item.nameEn, item.nameFr, item.id]
    .some((value) => value.toLocaleLowerCase(locale.value).includes(query)))
})
const localized = (item: { nameEn: string; nameFr: string }) =>
  locale.value === 'fr' ? item.nameFr || item.nameEn : item.nameEn || item.nameFr
let loadSequence = 0
const load = async () => {
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  try {
    const result = await api.get<{ intakes: Intake[]; streams: Stream[] }>(endpoint.value)
    if (sequence !== loadSequence) return
    intakes.value = result.intakes
    streams.value = result.streams
    if (selected.value?.published) editingForm.value = false
    if (selectedId.value && !result.intakes.some((item) => item.id === selectedId.value)) selectedId.value = null
  } catch {
    if (sequence === loadSequence) error.value = t('intakeLoadFailed')
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
watch(() => props.agencyId, () => {
  ++loadSequence
  intakes.value = []
  streams.value = []
  selectedId.value = null
  draft.value = null
  editingRevision.value = null
  revisionConflict.value = false
  editingForm.value = false
  search.value = ''
  void load()
}, { immediate: true })
const createRequestKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const openCreate = () => {
  selectedId.value = null
  editingForm.value = false
  requestKey.value = createRequestKey()
  fieldErrors.value = {}
  message.value = ''
  editingRevision.value = null
  revisionConflict.value = false
  draft.value = { streamId: '', nameEn: '', nameFr: '', startDate: '', endDate: '' }
}
const openDetails = () => {
  if (!selected.value || selected.value.published) return
  draft.value = { streamId: selected.value.streamId, nameEn: selected.value.nameEn,
    nameFr: selected.value.nameFr, startDate: selected.value.startDate, endDate: selected.value.endDate }
  fieldErrors.value = {}
  message.value = ''
  editingRevision.value = selected.value.revision
  revisionConflict.value = false
}
const acceptLatestRevision = () => {
  if (!selected.value || !draft.value || !revisionConflict.value) return
  editingRevision.value = selected.value.revision
  revisionConflict.value = false
  error.value = ''
}
const save = async () => {
  if (!draft.value || props.disabled || busy.value) return
  if (revisionConflict.value) return
  const parsed = intakeDraftSchema.safeParse(draft.value)
  if (!parsed.success) {
    const errors: Partial<Record<keyof IntakeDraft, string>> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path[0] as keyof IntakeDraft
      if (path && !errors[path]) {
        const value = draft.value[path]
        errors[path] = path === 'endDate' && draft.value.endDate && draft.value.startDate
          && draft.value.endDate < draft.value.startDate
          ? t('intakeDateOrder') : !value.trim() ? t('intakeRequired') : t('intakeInvalidField')
      }
    }
    fieldErrors.value = errors
    return
  }
  busy.value = true
  error.value = ''
  fieldErrors.value = {}
  try {
    const result = await api.post<{ intakeId: string }>(endpoint.value, selected.value
      ? { action: 'update', intakeId: selected.value.id, expectedRevision: editingRevision.value, ...parsed.data }
      : { action: 'create', requestKey: requestKey.value, ...parsed.data })
    selectedId.value = result.intakeId
    draft.value = null
    editingRevision.value = null
    message.value = t('intakeSaved')
    await load()
  } catch (failure) {
    const payload = failure instanceof FetchResponseError ? failure.data : null
    const code = payload && typeof payload === 'object' && 'data' in payload
      ? (payload.data as { code?: unknown } | null)?.code : null
    if (selected.value && failure instanceof FetchResponseError && failure.response.status === 409
      && code === 'GCS_PORTAL_INTAKE_REVISION_CONFLICT') {
      const editedId = selected.value.id
      await load()
      if (selected.value?.id === editedId) {
        revisionConflict.value = true
        error.value = t('intakeRevisionConflict')
      }
    } else error.value = t('intakeSaveFailed')
  }
  finally { busy.value = false }
}
const act = async (action: 'publish' | 'withdraw' | 'delete') => {
  const item = selected.value
  if (!item || props.disabled || busy.value) return
  if (action === 'withdraw' && !confirm(t('intakeWithdrawConfirm'))) return
  if (action === 'delete' && !confirm(t('intakeDeleteConfirm'))) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await api.post(endpoint.value, { action, intakeId: item.id })
    editingForm.value = false
    if (action === 'delete') selectedId.value = null
    message.value = action === 'publish' ? t('intakePublishedNotice')
      : action === 'withdraw' ? t('intakeWithdrawnNotice') : t('intakeDeletedNotice')
    await load()
  } catch { error.value = t('intakeActionFailed') }
  finally { busy.value = false }
}
const returnToList = () => {
  selectedId.value = null
  draft.value = null
  editingRevision.value = null
  revisionConflict.value = false
  editingForm.value = false
  fieldErrors.value = {}
  message.value = ''
}
</script>

<template>
  <section class="space-y-5" :aria-label="t('intakes')">
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}
      <button v-if="!draft" type="button" class="ml-2 underline" @click="load">{{ t('intakeRetry') }}</button>
    </p>
    <p v-if="message" role="status" class="text-sm text-success">{{ message }}</p>
    <p v-if="loading" role="status" class="text-sm text-muted">{{ t('intakes') }}…</p>

    <template v-if="draft">
      <button type="button" class="text-sm text-primary hover:underline" @click="draft = null">← {{ selected ? localized(selected) : t('intakeBack') }}</button>
      <div>
        <h3 class="text-xl font-semibold text-highlighted">{{ selected ? t('intakeEdit') : t('intakeNew') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('intakeHelp') }}</p>
      </div>
      <div v-if="revisionConflict && selected" class="space-y-2 border-l-4 border-warning pl-4">
        <p class="font-semibold">{{ t('intakeLatestDetails') }}</p>
        <p>{{ selected.nameEn }} / {{ selected.nameFr }} · {{ selected.startDate }} — {{ selected.endDate }}</p>
        <p>{{ t('intakeReviewLatest') }}</p>
        <ExtensionButton :disabled="busy || loading" @click="acceptLatestRevision">{{ t('intakeUseLatestRevision') }}</ExtensionButton>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <ExtensionFormField :label="t('intakeNameEn')" name="intakeNameEn" required :error="fieldErrors.nameEn">
          <ExtensionInput v-model="draft.nameEn" name="intakeNameEn" required :disabled="disabled || busy"
            :aria-invalid="Boolean(fieldErrors.nameEn)" />
        </ExtensionFormField>
        <ExtensionFormField :label="t('intakeNameFr')" name="intakeNameFr" required :error="fieldErrors.nameFr">
          <ExtensionInput v-model="draft.nameFr" name="intakeNameFr" required :disabled="disabled || busy"
            :aria-invalid="Boolean(fieldErrors.nameFr)" />
        </ExtensionFormField>
        <ExtensionFormField :label="t('intakeStream')" name="intakeStream" :required="!selected" :error="fieldErrors.streamId">
          <ExtensionSelect v-model="draft.streamId" name="intakeStream" value-key="value" :required="!selected"
            :disabled="disabled || busy || Boolean(selected)" :aria-required="!selected"
            :aria-invalid="Boolean(fieldErrors.streamId)"
            :items="streams.map((item) => ({ value: item.id, label: localized(item) }))" />
        </ExtensionFormField>
        <div />
        <ExtensionFormField :label="t('intakeOpens')" name="intakeStartDate" required :error="fieldErrors.startDate">
          <ExtensionInput v-model="draft.startDate" name="intakeStartDate" type="date" required
            :disabled="disabled || busy" :aria-invalid="Boolean(fieldErrors.startDate)" />
        </ExtensionFormField>
        <ExtensionFormField :label="t('intakeCloses')" name="intakeEndDate" required :error="fieldErrors.endDate">
          <ExtensionInput v-model="draft.endDate" name="intakeEndDate" type="date" required
            :disabled="disabled || busy" :aria-invalid="Boolean(fieldErrors.endDate)" />
        </ExtensionFormField>
      </div>
      <ExtensionSaveButton :label="t('intakeSave')" :disabled="disabled || busy || revisionConflict" :loading="busy" @click="save" />
    </template>

    <template v-else-if="selected">
      <button v-if="!editingForm" type="button" class="text-sm text-primary hover:underline" @click="returnToList">← {{ t('intakeBack') }}</button>
      <div v-if="!editingForm" class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 class="text-xl font-semibold text-highlighted">{{ localized(selected) }}</h3>
          <p class="mt-1 text-sm text-muted">{{ selected.published ? t('intakePublished') : t('intakeDraft') }} · {{ selected.startDate }} — {{ selected.endDate }}</p>
          <p class="mt-1 text-sm text-muted">{{ localized(streams.find((item) => item.id === selected?.streamId) ?? selected) }}</p>
        </div>
        <ExtensionButton v-if="!selected.published && !editingForm" :disabled="disabled || busy" @click="openDetails">{{ t('intakeEdit') }}</ExtensionButton>
      </div>
      <p v-if="selected.published" class="text-sm text-muted">{{ t('intakeFormPinned') }}</p>
      <section v-if="!editingForm" class="space-y-3 border-t border-default pt-4">
        <h4 class="font-semibold text-highlighted">{{ t('intakeForm') }}</h4>
        <p v-if="selected.surveyId && selected.surveyRevision" class="text-sm text-muted">{{ t('intakeFormRevision', { revision: selected.surveyRevision }) }}</p>
        <p v-else class="text-sm text-muted">{{ t('intakeFormMissing') }}</p>
        <ExtensionButton v-if="!selected.published && !editingForm" :disabled="disabled && !selected.surveyId" @click="editingForm = true">
          {{ selected.surveyId ? t('intakeEditForm') : t('intakeCreateForm') }}
        </ExtensionButton>
      </section>
      <FormCreator v-if="editingForm && !selected.published" :key="`${agencyId}:${selected.id}`" :agency-id="agencyId"
        :intake-id="selected.id" :selected-form-id="selected.surveyId ?? undefined"
        :disabled="disabled || selected.published" @close="editingForm = false" @saved="load" />
      <div v-if="!editingForm" class="flex flex-wrap gap-3 border-t border-default pt-4">
        <ExtensionButton v-if="!selected.published" :disabled="disabled || busy || !selected.surveyId"
          :loading="busy" @click="act('publish')">{{ t('intakePublish') }}</ExtensionButton>
        <ExtensionButton v-else :disabled="disabled || busy" :loading="busy" @click="act('withdraw')">{{ t('intakeWithdraw') }}</ExtensionButton>
        <ExtensionButton v-if="!selected.published" :disabled="disabled || busy" @click="act('delete')">{{ t('intakeDelete') }}</ExtensionButton>
      </div>
    </template>

    <template v-else>
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div><h3 class="text-xl font-semibold text-highlighted">{{ t('intakes') }}</h3>
          <p class="mt-1 text-sm text-muted">{{ t('intakeHelp') }}</p></div>
        <ExtensionButton :disabled="disabled" @click="openCreate">{{ t('intakeCreate') }}</ExtensionButton>
      </div>
      <label class="block max-w-md text-sm font-medium text-highlighted">{{ t('intakeSearch') }}
        <input v-model="search" type="search" class="mt-1 w-full rounded border border-default bg-default px-3 py-2" />
      </label>
      <p v-if="!filtered.length" class="text-sm text-muted">{{ intakes.length ? t('intakeNoMatch') : t('intakeEmpty') }}</p>
      <ul v-else class="divide-y divide-default border-y border-default">
        <li v-for="item in filtered" :key="item.id" class="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><button type="button" class="font-semibold text-primary hover:underline" @click="selectedId = item.id">{{ localized(item) }}</button>
            <p class="text-sm text-muted">{{ item.startDate }} — {{ item.endDate }} · {{ item.published ? t('intakePublished') : t('intakeDraft') }}</p></div>
          <span v-if="item.surveyId" class="text-xs text-muted">{{ t('intakeFormRevision', { revision: item.surveyRevision ?? 0 }) }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
