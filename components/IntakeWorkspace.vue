<script setup lang="ts">
import { feedback, useLocalizedFeedback } from './localized-feedback'
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionSaveButton, ExtensionSelect,
  useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { FetchResponseError } from '@gcs-ssc/extensions'
import { messages } from '../i18n/messages'
import { intakeDraftSchema, type IntakeDraft } from '../shared/intake'
import FormCreator from './FormCreator.vue'
import { usePortalRequest } from './usePortalRequest'

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
type EditorState =
  | { kind: 'list' }
  | { kind: 'view'; intakeId: string; section: 'summary' | 'form' }
  | { kind: 'create'; draft: IntakeDraft; requestKey: string }
  | { kind: 'update'; intakeId: string; draft: IntakeDraft; revision: { kind: 'current' | 'conflict'; expected: number } }
const editor: Ref<EditorState> = ref({ kind: 'list' })
const loadRequest = usePortalRequest()
const mutationRequest = usePortalRequest()
const busy = mutationRequest.pending
const loading = loadRequest.pending
const selectedId = computed({
  get: () => editor.value.kind === 'view' || editor.value.kind === 'update' ? editor.value.intakeId : null,
  set: (value: string | null) => {
    mutationRequest.invalidate()
    editor.value = value ? { kind: 'view', intakeId: value, section: 'summary' } : { kind: 'list' }
  }
})
const selected = computed(() => intakes.value.find((item) => item.id === selectedId.value) ?? null)
const draft = computed({
  get: () => editor.value.kind === 'create' || editor.value.kind === 'update' ? editor.value.draft : null,
  set: (value: IntakeDraft | null) => {
    if (value !== null) return
    mutationRequest.invalidate()
    editor.value = editor.value.kind === 'update'
      ? { kind: 'view', intakeId: editor.value.intakeId, section: 'summary' } : { kind: 'list' }
  }
})
const revisionConflict = computed(() => editor.value.kind === 'update' && editor.value.revision.kind === 'conflict')
const editingForm = computed({
  get: () => editor.value.kind === 'view' && editor.value.section === 'form',
  set: (value: boolean) => {
    if (editor.value.kind === 'view') editor.value = { ...editor.value, section: value ? 'form' : 'summary' }
  }
})
const error = useLocalizedFeedback(t)
const message = useLocalizedFeedback(t)
const search = ref('')
const fieldErrors: Ref<Partial<Record<keyof IntakeDraft, 'intakeDateOrder' | 'intakeRequired' | 'intakeInvalidField'>>> = ref({})
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase(locale.value)
  if (!query) return intakes.value
  return intakes.value.filter((item) => [item.nameEn, item.nameFr, item.id]
    .some((value) => value.toLocaleLowerCase(locale.value).includes(query)))
})
const localized = (item: { nameEn: string; nameFr: string }) =>
  /^fr(?:-|$)/i.test(locale.value) ? item.nameFr || item.nameEn : item.nameEn || item.nameFr
let collectionGeneration: object | null = {}
watch(() => [props.agencyId, props.disabled], () => {
  collectionGeneration = {}
  loadRequest.invalidate()
  mutationRequest.invalidate()
}, { flush: 'sync' })
onScopeDispose(() => {
  collectionGeneration = null
})
/**
 * Refreshes the Agency collection without changing a replacement opening.
 * @param preserveOpening Whether selection and navigation belong to another opening.
 * @returns Refreshed, unavailable or retired readback evidence.
 */
const load = async (preserveOpening = false): Promise<'refreshed' | 'unavailable' | 'retired'> => {
  const request = loadRequest.begin()
  if (!request) return 'retired'
  const generation = collectionGeneration
  const opening = editor.value
  const path = endpoint.value
  error.value = ''
  try {
    const result = await api.get<{ intakes: Intake[]; streams: Stream[] }>(path)
    if (!loadRequest.isCurrent(request) || collectionGeneration !== generation) return 'retired'
    intakes.value = result.intakes
    streams.value = result.streams
    if (!preserveOpening && editor.value === opening) {
      if (selected.value?.published) editingForm.value = false
      if (selectedId.value && !result.intakes.some((item) => item.id === selectedId.value)) selectedId.value = null
    }
    loadRequest.succeed(request)
    return 'refreshed'
  } catch {
    if (!loadRequest.isCurrent(request) || collectionGeneration !== generation) return 'retired'
    error.value = feedback('intakeLoadFailed')
    loadRequest.fail(request)
    return 'unavailable'
  }
}
/**
 * Captures the live Agency collection independently of the child editor.
 * @returns A readback callback, or null when new writes are unavailable.
 */
const captureIntakeSettlement = () => {
  if (props.disabled || !collectionGeneration) return null
  const generation = collectionGeneration
  const opening = editor.value
  return async () => collectionGeneration === generation ? await load(editor.value !== opening) : 'retired' as const
}
watch(() => props.agencyId, () => {
  loadRequest.invalidate()
  mutationRequest.invalidate()
  intakes.value = []
  streams.value = []
  editor.value = { kind: 'list' }
  search.value = ''
  fieldErrors.value = {}
  message.value = ''
  void load()
}, { immediate: true, flush: 'sync' })
const createRequestKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const openCreate = () => {
  mutationRequest.invalidate()
  editor.value = { kind: 'create', requestKey: createRequestKey(),
    draft: { streamId: '', nameEn: '', nameFr: '', startDate: '', endDate: '' } }
  fieldErrors.value = {}
  message.value = ''
}
const openDetails = () => {
  const item = selected.value
  if (!item || item.published) return
  mutationRequest.invalidate()
  editor.value = { kind: 'update', intakeId: item.id, revision: { kind: 'current', expected: item.revision },
    draft: { streamId: item.streamId, nameEn: item.nameEn,
      nameFr: item.nameFr, startDate: item.startDate, endDate: item.endDate } }
  fieldErrors.value = {}
  message.value = ''
}
const acceptLatestRevision = () => {
  if (!selected.value || editor.value.kind !== 'update' || !revisionConflict.value) return
  editor.value.revision = { kind: 'current', expected: selected.value.revision }
  error.value = ''
}
const save = async () => {
  const session = editor.value
  if (session.kind !== 'create' && session.kind !== 'update') return
  if (props.disabled || busy.value || revisionConflict.value) return
  const parsed = intakeDraftSchema.safeParse(session.draft)
  if (!parsed.success) {
    const errors: Partial<Record<keyof IntakeDraft, 'intakeDateOrder' | 'intakeRequired' | 'intakeInvalidField'>> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path[0] as keyof IntakeDraft
      if (path && !errors[path]) {
        const value = session.draft[path]
        errors[path] = path === 'endDate' && session.draft.endDate && session.draft.startDate
          && session.draft.endDate < session.draft.startDate
          ? 'intakeDateOrder' : !value.trim() ? 'intakeRequired' : 'intakeInvalidField'
      }
    }
    fieldErrors.value = errors
    return
  }
  const settleCollection = captureIntakeSettlement()
  if (!settleCollection) return
  const request = mutationRequest.begin()
  if (!request) return
  const path = endpoint.value
  const body = session.kind === 'update'
    ? { action: 'update', intakeId: session.intakeId, expectedRevision: session.revision.expected, ...parsed.data }
    : { action: 'create', requestKey: session.requestKey, ...parsed.data }
  error.value = ''
  fieldErrors.value = {}
  try {
    const result = await api.post<{ intakeId: string }>(path, body)
    const current = mutationRequest.isCurrent(request) && editor.value === session
    if (current) {
      editor.value = { kind: 'view', intakeId: result.intakeId, section: 'summary' }
      message.value = feedback('intakeSaved')
    }
    await settleCollection()
    mutationRequest.succeed(request)
  } catch (failure) {
    if (!mutationRequest.isCurrent(request) || editor.value !== session) return
    const payload = failure instanceof FetchResponseError ? failure.data : null
    const details = payload && typeof payload === 'object' && 'data' in payload ? payload.data : null
    const code = details && typeof details === 'object' && 'code' in details ? details.code : null
    if (session.kind === 'update' && failure instanceof FetchResponseError && failure.response.status === 409
      && code === 'GCS_PORTAL_INTAKE_REVISION_CONFLICT') {
      await load()
      if (!mutationRequest.isCurrent(request) || editor.value !== session) return
      session.revision = { kind: 'conflict', expected: session.revision.expected }
      error.value = feedback('intakeRevisionConflict')
    } else error.value = feedback('intakeSaveFailed')
    mutationRequest.fail(request)
  }
}
const act = async (action: 'publish' | 'withdraw' | 'delete') => {
  const item = selected.value
  if (!item || props.disabled || busy.value) return
  if (action === 'withdraw' && !confirm(t('intakeWithdrawConfirm'))) return
  if (action === 'delete' && !confirm(t('intakeDeleteConfirm'))) return
  const request = mutationRequest.begin()
  if (!request) return
  const session = editor.value
  const path = endpoint.value
  error.value = ''
  message.value = ''
  try {
    await api.post(path, { action, intakeId: item.id })
    if (!mutationRequest.isCurrent(request) || editor.value !== session) return
    editor.value = action === 'delete' ? { kind: 'list' } : { kind: 'view', intakeId: item.id, section: 'summary' }
    message.value = action === 'publish' ? feedback('intakePublishedNotice')
      : action === 'withdraw' ? feedback('intakeWithdrawnNotice') : feedback('intakeDeletedNotice')
    await load()
    mutationRequest.succeed(request)
  } catch {
    if (!mutationRequest.isCurrent(request) || editor.value !== session) return
    error.value = feedback('intakeActionFailed')
    mutationRequest.fail(request)
  }
}
const returnToList = () => {
  mutationRequest.invalidate()
  editor.value = { kind: 'list' }
  fieldErrors.value = {}
  message.value = ''
}
</script>

<template>
  <section class="space-y-5" :aria-label="t('intakes')" data-field-scope="extension.gcs-ssc-portal-connector.intake-workspace">
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}
      <button v-if="!draft" type="button" class="ml-2 underline" @click="load()">{{ t('intakeRetry') }}</button>
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
        <ExtensionFormField :label="t('intakeNameEn')" name="intakeNameEn" required :error="fieldErrors.nameEn ? t(fieldErrors.nameEn) : undefined">
          <ExtensionInput
            v-model="draft.nameEn" name="intakeNameEn" required :disabled="disabled || busy"
            :aria-invalid="Boolean(fieldErrors.nameEn)" />
        </ExtensionFormField>
        <ExtensionFormField :label="t('intakeNameFr')" name="intakeNameFr" required :error="fieldErrors.nameFr ? t(fieldErrors.nameFr) : undefined">
          <ExtensionInput
            v-model="draft.nameFr" name="intakeNameFr" required :disabled="disabled || busy"
            :aria-invalid="Boolean(fieldErrors.nameFr)" />
        </ExtensionFormField>
        <ExtensionFormField :label="t('intakeStream')" name="intakeStream" :required="!selected" :error="fieldErrors.streamId ? t(fieldErrors.streamId) : undefined">
          <ExtensionSelect
            v-model="draft.streamId" name="intakeStream" value-key="value" :required="!selected"
            :disabled="disabled || busy || Boolean(selected)" :aria-required="!selected"
            :aria-invalid="Boolean(fieldErrors.streamId)"
            :items="streams.map((item) => ({ value: item.id, label: localized(item) }))" />
        </ExtensionFormField>
        <div />
        <ExtensionFormField :label="t('intakeOpens')" name="intakeStartDate" required :error="fieldErrors.startDate ? t(fieldErrors.startDate) : undefined">
          <ExtensionInput
            v-model="draft.startDate" name="intakeStartDate" type="date" required
            :disabled="disabled || busy" :aria-invalid="Boolean(fieldErrors.startDate)" />
        </ExtensionFormField>
        <ExtensionFormField :label="t('intakeCloses')" name="intakeEndDate" required :error="fieldErrors.endDate ? t(fieldErrors.endDate) : undefined">
          <ExtensionInput
            v-model="draft.endDate" name="intakeEndDate" type="date" required
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
      <FormCreator
        v-if="editingForm && !selected.published" :key="`${agencyId}:${selected.id}`" :agency-id="agencyId"
        :intake-id="selected.id" :selected-form-id="selected.surveyId ?? undefined"
        :disabled="disabled || selected.published" :capture-intake-settlement="captureIntakeSettlement" @close="editingForm = false" />
      <div v-if="!editingForm" class="flex flex-wrap gap-3 border-t border-default pt-4">
        <ExtensionButton
          v-if="!selected.published" :disabled="disabled || busy || !selected.surveyId"
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
        <input data-field-label-en="Search intakes" data-field-label-fr="Rechercher des demandes" v-model="search" type="search" class="mt-1 w-full rounded border border-default bg-default px-3 py-2" data-ui-target="extension.gcs-ssc-portal-connector.intake-workspace.search" />
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
