<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions'
import { ExtensionBadge, ExtensionButton, ExtensionResourceLayoutCard, useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import FormCreator from './FormCreator.vue'

type Form = { surveyId: string; revision: number; title: { en: string; fr: string } }
const props = defineProps<{ context: ExtensionEntityTabContext; disabled?: boolean }>()
const api = useExtensionApi('gcs-ssc-portal-connector')
const { locale, t } = useExtensionI18n(messages)
const agencyId = computed(() => props.context.agencyId ?? '')
const opportunityId = computed(() => props.context.opportunityId ?? props.context.ownerId)
const streamId = computed(() => props.context.streamId ?? '')
const readEndpoint = computed(() => `/agencies/${agencyId.value}/opportunities/${opportunityId.value}/forms`)
const writeEndpoint = computed(() => `/agencies/${agencyId.value}/opportunities/${opportunityId.value}`)
const forms = ref<Form[]>([])
const search = ref('')
const pagination = ref({ pageIndex: 0, pageSize: 10 })
const language = computed(() => locale.value === 'fr' ? 'fr' : 'en')
const writable = computed(() => canWrite.value && !props.disabled)
const editable = computed(() => writable.value && !published.value && !loading.value && !busy.value)
const titleFor = (form: Form) => form.title[language.value] || form.title.en || form.surveyId
const filteredForms = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return forms.value.map((form, index) => ({ ...form, id: form.surveyId, order: index + 1 }))
    .filter(form => !query || `${form.title.en} ${form.title.fr} ${form.surveyId}`.toLocaleLowerCase().includes(query))
})
const visibleForms = computed(() => filteredForms.value.slice(pagination.value.pageIndex * pagination.value.pageSize,
  (pagination.value.pageIndex + 1) * pagination.value.pageSize))
const columns = computed(() => [
  { id: 'order', header: t('opportunityFormsOrder') },
  { id: 'form', header: t('formLibraryForm') },
  { id: 'publication', header: t('formLibraryPublicationStatus') },
  { id: 'actions', header: t('formLibraryActions') }
])
watch(search, () => { pagination.value.pageIndex = 0 })
watch(() => filteredForms.value.length, total => {
  const lastPage = Math.max(0, Math.ceil(total / pagination.value.pageSize) - 1)
  if (pagination.value.pageIndex > lastPage) pagination.value.pageIndex = lastPage
})
const published = ref(false)
const canWrite = ref(false)
const editing = ref<string | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
let sequence = 0
const load = async () => {
  const current = ++sequence
  loading.value = true; error.value = ''
  try {
    const result = await api.get<{ forms: Form[]; published: boolean; canWrite: boolean }>(readEndpoint.value)
    if (current !== sequence) return
    forms.value = result.forms
    published.value = result.published
    canWrite.value = result.canWrite
  } catch {
    if (current === sequence) error.value = t('opportunityFormsLoadFailed')
  } finally { if (current === sequence) loading.value = false }
}
watch(() => [agencyId.value, opportunityId.value], () => {
  editing.value = null; forms.value = []; published.value = false; canWrite.value = false
  search.value = ''; pagination.value.pageIndex = 0; message.value = ''; void load()
}, { immediate: true })
const changeForms = async (next: Form[]) => {
  if (!editable.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api.post(writeEndpoint.value, { action: 'saveForms', forms: next.map(form => ({
      surveyId: form.surveyId, revision: form.revision
    })) })
    message.value = t('opportunityFormsOrderSaved')
    await load()
  } catch { error.value = t('opportunityFormsSaveFailed') }
  finally { busy.value = false }
}
const move = (index: number, direction: -1 | 1) => {
  const next = [...forms.value]
  const target = index + direction
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  void changeForms(next)
}
const act = async (action: 'publish' | 'withdraw') => {
  if (busy.value || loading.value || !writable.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api.post(writeEndpoint.value, { action })
    message.value = action === 'publish'
      ? t('opportunityFormsPublished')
      : t('opportunityFormsWithdrawn')
    await load()
  } catch {
    error.value = action === 'publish'
      ? t('opportunityFormsPublishFailed')
      : t('opportunityFormsWithdrawFailed')
  } finally { busy.value = false }
}
</script>

<template>
  <section class="space-y-5">
    <div v-if="editing !== null">
      <FormCreator :key="`${opportunityId}:${editing}`" :agency-id="agencyId" :opportunity-id="opportunityId"
        :stream-id="streamId" :selected-form-id="editing" :disabled="disabled || !canWrite || published"
        @close="editing = null; load()" @saved="load" />
    </div>
    <template v-else>
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 class="text-xl font-semibold text-highlighted">{{ t('opportunityFormsTitle') }}</h3>
          <p class="mt-1 text-sm text-muted">{{ t('opportunityFormsDescription') }}</p>
        </div>
        <ExtensionButton v-if="writable && !published" icon="i-lucide-plus"
          :disabled="!editable || forms.length >= 10 || !!error" @click="editing = ''">{{ t('formLibraryCreate') }}</ExtensionButton>
      </div>
      <p v-if="loading" role="status" class="text-sm text-muted">{{ t('formLibraryLoading') }}</p>
      <p v-if="error" role="alert" class="text-sm text-error">{{ error }}
        <button type="button" class="ml-2 underline" @click="load">{{ t('formLibraryRetry') }}</button>
      </p>
      <ExtensionResourceLayoutCard v-if="!loading && !error" v-model:search="search" v-model:pagination="pagination"
        :data="visibleForms" :columns="columns" :total-records="filteredForms.length" :show-button="false"
        :search-placeholder="t('formLibrarySearch')">
        <template #order-cell="{ row }"><span class="text-muted">{{ row.original.order }}</span></template>
        <template #form-cell="{ row }">
          <button type="button" class="text-left font-semibold text-highlighted underline-offset-2 hover:underline focus-visible:underline"
            @click="editing = row.original.surveyId">{{ titleFor(row.original) }}</button>
          <div class="mt-1 text-xs text-muted">{{ t('formLibraryRevision') }} {{ row.original.revision }} · {{ row.original.surveyId }}</div>
        </template>
        <template #publication-cell>
          <ExtensionBadge :color="published ? 'success' : 'neutral'" variant="subtle">
            {{ published ? t('formLibraryPublished') : t('formLibraryDraft') }}
          </ExtensionBadge>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end gap-1">
            <ExtensionButton icon="i-lucide-eye" color="neutral" variant="ghost"
              :aria-label="`${published || !writable ? t('opportunityFormsView') : t('formLibraryEdit')}: ${titleFor(row.original)}`"
              @click="editing = row.original.surveyId" />
            <template v-if="writable && !published">
              <ExtensionButton icon="i-lucide-arrow-up" color="neutral" variant="ghost"
                :aria-label="`${t('opportunityFormsUp')}: ${titleFor(row.original)}`"
                :disabled="!editable || row.original.order === 1" @click="move(row.original.order - 1, -1)" />
              <ExtensionButton icon="i-lucide-arrow-down" color="neutral" variant="ghost"
                :aria-label="`${t('opportunityFormsDown')}: ${titleFor(row.original)}`"
                :disabled="!editable || row.original.order === forms.length" @click="move(row.original.order - 1, 1)" />
              <ExtensionButton icon="i-lucide-unlink" color="neutral" variant="ghost"
                :aria-label="`${t('opportunityFormsRemove')}: ${titleFor(row.original)}`" :disabled="!editable"
                @click="changeForms(forms.filter(item => item.surveyId !== row.original.surveyId))" />
            </template>
          </div>
        </template>
        <template #empty>
          <div v-if="!forms.length" class="py-8 text-center">
            <p class="font-medium text-highlighted">{{ t('formLibraryEmpty') }}</p>
            <p class="mt-1 text-sm text-muted">{{ t('opportunityFormsEmptyHelp') }}</p>
          </div>
          <p v-else class="py-8 text-center text-sm text-muted">{{ t('formLibraryNoMatch') }}</p>
        </template>
      </ExtensionResourceLayoutCard>
      <div v-if="writable && !loading && !error" class="flex flex-wrap gap-3">
        <ExtensionButton v-if="!published" icon="i-lucide-upload" :disabled="busy || !forms.length" :loading="busy" @click="act('publish')">
          {{ t('opportunityFormsPublish') }}</ExtensionButton>
        <ExtensionButton v-else color="neutral" variant="outline" :disabled="busy" :loading="busy" @click="act('withdraw')">
          {{ t('opportunityFormsWithdraw') }}</ExtensionButton>
      </div>
      <p v-if="published" class="text-sm text-muted">{{ t('opportunityFormsPinned') }}</p>
      <p v-if="message" role="status" class="text-sm text-success">{{ message }}</p>
    </template>
  </section>
</template>
