<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FetchResponseError } from '@gcs-ssc/extensions'
import { ExtensionBadge, ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionModal, ExtensionResourceLayoutCard, ExtensionTextarea, useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'

type Bilingual = { en: string; fr: string }
type FormSummary = { id: string; revision: number; title: Bilingual; updatedAt: string }
type Publication = {
  surveyId: string
  revision: number
  targetType: 'agreement' | 'organization' | 'opportunity'
  targetId: string
  targetNameEn: string
  targetNameFr: string
  organizationName?: string
  published: boolean
}

const props = defineProps<{ agencyId: string; disabled?: boolean }>()
const emit = defineEmits<{ open: [formId: string] }>()
const { locale, t } = useExtensionI18n(messages)
const language = computed<'en' | 'fr'>(() => locale.value === 'fr' ? 'fr' : 'en')
const api = useExtensionApi('gcs-ssc-portal-connector')
const forms = ref<FormSummary[]>([])
const publications = ref<Publication[]>([])
const loading = ref(true)
const error = ref('')
const createOpen = ref(false)
const createBusy = ref(false)
const createError = ref('')
const createDraft = ref({ titleEn: '', titleFr: '', introductionEn: '', introductionFr: '' })
const introductionRequired = computed(() => Boolean(createDraft.value.introductionEn.trim() || createDraft.value.introductionFr.trim()))
const createValid = computed(() => Boolean(
  createDraft.value.titleEn.trim() && createDraft.value.titleFr.trim()
  && createDraft.value.titleEn.trim().length <= 200 && createDraft.value.titleFr.trim().length <= 200
  && (!introductionRequired.value || createDraft.value.introductionEn.trim() && createDraft.value.introductionFr.trim())
  && createDraft.value.introductionEn.trim().length <= 2000 && createDraft.value.introductionFr.trim().length <= 2000
))
const openCreate = () => {
  createDraft.value = { titleEn: '', titleFr: '', introductionEn: '', introductionFr: '' }
  createError.value = ''
  createOpen.value = true
}
const createForm = async () => {
  if (!createValid.value || createBusy.value || props.disabled) return
  createBusy.value = true
  createError.value = ''
  try {
    const result = await api.post<{ survey: { id: string } }>(`/agencies/${props.agencyId}/forms`, {
      action: 'createDraft',
      title: { en: createDraft.value.titleEn.trim(), fr: createDraft.value.titleFr.trim() },
      introduction: { en: createDraft.value.introductionEn.trim(), fr: createDraft.value.introductionFr.trim() }
    })
    createOpen.value = false
    emit('open', result.survey.id)
  } catch (error) {
    createError.value = error instanceof FetchResponseError
      ? `${t('formDetailsCreateFailed')} ${error.message} (HTTP ${error.response.status})`
      : t('formDetailsCreateFailed')
  } finally {
    createBusy.value = false
  }
}
const search = ref('')
const statusFilter = ref<'all' | 'published' | 'changes' | 'draft'>('all')
const pagination = ref({ pageIndex: 0, pageSize: 10 })
const columns = computed(() => [
  { id: 'form', header: t('formLibraryForm') },
  { id: 'publication', header: t('formLibraryPublicationStatus') },
  { id: 'destination', header: t('formLibraryDestination') },
  { id: 'updated', header: t('formLibraryUpdated') },
  { id: 'actions', header: t('formLibraryActions') }
])

const publicationsFor = (form: FormSummary) => {
  const latestByDestination = new Map<string, Publication>()
  for (const item of publications.value.filter((publication) => publication.surveyId === form.id && publication.published)) {
    const key = `${item.targetType}:${item.targetId}`
    if ((latestByDestination.get(key)?.revision ?? 0) < item.revision) latestByDestination.set(key, item)
  }
  return [...latestByDestination.values()]
}
const stateFor = (form: FormSummary): 'draft' | 'published' | 'changes' => {
  const placements = publicationsFor(form)
  if (!placements.length) return 'draft'
  return placements.every((item) => item.revision === form.revision) ? 'published' : 'changes'
}
const stateLabel = (state: ReturnType<typeof stateFor>) => state === 'published'
  ? t('formLibraryPublished')
  : state === 'changes' ? t('formLibraryChanges')
    : t('formLibraryDraft')
const locationLabel = (publication: Publication) => {
  const kind = publication.targetType === 'agreement' ? t('formLibraryAgreement')
    : publication.targetType === 'organization' ? t('formLibraryOrganization')
      : t('formLibraryOpportunity')
  const name = language.value === 'fr' ? publication.targetNameFr || publication.targetNameEn
    : publication.targetNameEn || publication.targetNameFr
  return `${kind} · ${name || publication.targetId}`
}
const sortedForms = computed(() => [...forms.value].sort((a, b) => {
  const aTime = Date.parse(a.updatedAt) || 0
  const bTime = Date.parse(b.updatedAt) || 0
  return bTime - aTime || a.title[language.value].localeCompare(b.title[language.value])
}))
const filteredForms = computed(() => sortedForms.value.filter((form) => {
  const state = stateFor(form)
  if (statusFilter.value !== 'all' && statusFilter.value !== state) return false
  const query = search.value.trim().toLocaleLowerCase(locale.value)
  if (!query) return true
  return [form.id, form.title.en, form.title.fr, ...publicationsFor(form).map(locationLabel)]
    .some((value) => value.toLocaleLowerCase(locale.value).includes(query))
}))
const visibleForms = computed(() => filteredForms.value.slice(
  pagination.value.pageIndex * pagination.value.pageSize,
  (pagination.value.pageIndex + 1) * pagination.value.pageSize
))
watch([search, statusFilter], () => { pagination.value.pageIndex = 0 })
watch(() => filteredForms.value.length, length => {
  const lastPage = Math.max(0, Math.ceil(length / pagination.value.pageSize) - 1)
  if (pagination.value.pageIndex > lastPage) pagination.value.pageIndex = lastPage
})
const dateLabel = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale.value === 'fr' ? 'fr-CA' : 'en-CA', {
    year: 'numeric', month: 'short', day: 'numeric'
  }).format(date)
}
let loadSequence = 0
const load = async () => {
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  try {
    const result = await api.get<{ surveys: FormSummary[]; publications?: Publication[] }>(`/agencies/${props.agencyId}/forms`)
    if (sequence !== loadSequence) return
    forms.value = result.surveys ?? []
    publications.value = result.publications ?? []
  } catch {
    if (sequence !== loadSequence) return
    error.value = t('formLibraryLoadFailed')
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
watch(() => props.agencyId, () => {
  createOpen.value = false
  forms.value = []
  publications.value = []
  search.value = ''
  statusFilter.value = 'all'
  void load()
}, { immediate: true })
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h3 class="text-xl font-semibold text-highlighted">{{ t('formLibraryTitle') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('formLibraryDescription') }}</p>
      </div>
      <ExtensionButton icon="i-lucide-plus" :disabled="disabled" @click="openCreate">{{ t('formLibraryCreate') }}</ExtensionButton>
    </div>

    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}
      <button type="button" class="ml-2 underline" @click="load">{{ t('formLibraryRetry') }}</button>
    </p>
    <p v-if="loading" role="status" class="text-sm text-muted">{{ t('formLibraryLoading') }}</p>

    <ExtensionResourceLayoutCard v-else-if="!error" v-model:search="search" v-model:pagination="pagination"
      :data="visibleForms" :columns="columns" :total-records="filteredForms.length"
      :show-button="false"
      :search-placeholder="t('formLibrarySearch')">
      <template #filters>
        <label class="flex items-center gap-2 text-sm text-highlighted">
          <span>{{ t('formLibraryStatus') }}</span>
          <select v-model="statusFilter" class="rounded-md border border-default bg-default px-3 py-2 text-sm text-highlighted">
            <option value="all">{{ t('formLibraryAllStatuses') }}</option>
            <option value="published">{{ t('formLibraryPublished') }}</option>
            <option value="changes">{{ t('formLibraryChanges') }}</option>
            <option value="draft">{{ t('formLibraryDraft') }}</option>
          </select>
        </label>
      </template>
      <template #form-cell="{ row }">
        <button type="button" class="text-left font-semibold text-highlighted underline-offset-2 hover:underline focus-visible:underline"
          @click="emit('open', row.original.id)">{{ row.original.title[language] || row.original.title.en || row.original.id }}</button>
        <div class="mt-1 text-xs text-muted"><template v-if="row.original.revision > 0">{{ t('formLibraryRevision') }} {{ row.original.revision }} · </template>{{ row.original.id }}</div>
      </template>
      <template #publication-cell="{ row }">
        <ExtensionBadge :color="stateFor(row.original) === 'published' ? 'success' : stateFor(row.original) === 'changes' ? 'warning' : 'neutral'" variant="subtle">
          {{ stateLabel(stateFor(row.original)) }}
        </ExtensionBadge>
      </template>
      <template #destination-cell="{ row }">
        <span v-if="!publicationsFor(row.original).length" class="text-muted">{{ t('formLibraryNotPublished') }}</span>
        <ul v-else class="space-y-1">
          <li v-for="(publication, index) in publicationsFor(row.original)" :key="`${publication.targetType}-${publication.targetId}-${index}`">
            {{ locationLabel(publication) }}
            <span v-if="publication.revision !== row.original.revision" class="text-xs text-muted">· {{ t('formLibraryRevisionLower') }} {{ publication.revision }}</span>
          </li>
        </ul>
      </template>
      <template #updated-cell="{ row }"><span class="whitespace-nowrap text-muted">{{ dateLabel(row.original.updatedAt) }}</span></template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end">
          <ExtensionButton icon="i-lucide-eye" color="neutral" variant="ghost"
            :aria-label="`${t('formLibraryEdit')}: ${row.original.title[language] || row.original.title.en || row.original.id}`"
            @click="emit('open', row.original.id)" />
        </div>
      </template>
      <template #empty>
        <div v-if="!forms.length" class="py-8 text-center">
          <p class="font-medium text-highlighted">{{ t('formLibraryEmpty') }}</p>
          <p class="mt-1 text-sm text-muted">{{ t('formLibraryEmptyHelp') }}</p>
        </div>
        <p v-else class="py-8 text-center text-sm text-muted">{{ t('formLibraryNoMatch') }}</p>
      </template>
    </ExtensionResourceLayoutCard>
    <ExtensionModal v-model:open="createOpen" :dismissible="!createBusy"
      :title="t('formDetailsCreateTitle')" :description="t('formDetailsCreateHelp')">
      <template #body>
        <form class="space-y-4" @submit.prevent="createForm">
          <ExtensionFormField :label="t('formTitleEnglish')" name="formTitleEn" required>
            <ExtensionInput v-model="createDraft.titleEn" name="formTitleEn" required :maxlength="200" :disabled="createBusy" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('formTitleFrench')" name="formTitleFr" required>
            <ExtensionInput v-model="createDraft.titleFr" name="formTitleFr" required :maxlength="200" :disabled="createBusy" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('formIntroductionEnglish')" name="formDescriptionEn" :required="introductionRequired">
            <ExtensionTextarea v-model="createDraft.introductionEn" name="formDescriptionEn"
              :required="introductionRequired" :maxlength="2000" :disabled="createBusy" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('formIntroductionFrench')" name="formDescriptionFr" :required="introductionRequired">
            <ExtensionTextarea v-model="createDraft.introductionFr" name="formDescriptionFr"
              :required="introductionRequired" :maxlength="2000" :disabled="createBusy" />
          </ExtensionFormField>
          <p v-if="createError" role="alert" class="text-sm text-error">{{ createError }}</p>
          <div class="flex justify-end gap-2">
            <ExtensionButton type="button" color="neutral" variant="ghost" :disabled="createBusy" @click="createOpen = false">{{ t('formDetailsCancel') }}</ExtensionButton>
            <ExtensionButton type="submit" :disabled="disabled || !createValid" :loading="createBusy">{{ t('formDetailsCreateAction') }}</ExtensionButton>
          </div>
        </form>
      </template>
    </ExtensionModal>
  </div>
</template>
