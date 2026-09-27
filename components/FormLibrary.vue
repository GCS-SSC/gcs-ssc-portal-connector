<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ExtensionButton, useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
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
const emit = defineEmits<{ open: [formId: string]; create: [] }>()
const { locale } = useExtensionI18n(messages)
const language = computed<'en' | 'fr'>(() => locale.value === 'fr' ? 'fr' : 'en')
const tr = (en: string, fr: string) => language.value === 'fr' ? fr : en
const api = useExtensionApi('gcs-ssc-portal-connector')
const forms = ref<FormSummary[]>([])
const publications = ref<Publication[]>([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const statusFilter = ref<'all' | 'published' | 'changes' | 'draft'>('all')

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
  ? tr('Published', 'Publié')
  : state === 'changes' ? tr('Unpublished changes', 'Modifications non publiées')
    : tr('Draft', 'Brouillon')
const locationLabel = (publication: Publication) => {
  const kind = publication.targetType === 'agreement' ? tr('Agreement', 'Accord')
    : publication.targetType === 'organization' ? tr('Organization', 'Organisme')
      : tr('Funding opportunity', 'Occasion de financement')
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
    error.value = tr('Forms could not be loaded. Check the portal connection.',
      'Impossible de charger les formulaires. Vérifiez la connexion au portail.')
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
watch(() => props.agencyId, () => {
  forms.value = []
  publications.value = []
  search.value = ''
  statusFilter.value = 'all'
  void load()
}, { immediate: true })
</script>

<template>
  <div class="forms-library space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h3 class="text-xl font-semibold text-highlighted">{{ tr('Forms', 'Formulaires') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ tr('Manage forms and where they appear in the portal.', 'Gérez les formulaires et leur emplacement dans le portail.') }}</p>
      </div>
      <ExtensionButton :disabled="disabled" @click="emit('create')">{{ tr('Create form', 'Créer un formulaire') }}</ExtensionButton>
    </div>

    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}
      <button type="button" class="ml-2 underline" @click="load">{{ tr('Try again', 'Réessayer') }}</button>
    </p>
    <p v-if="loading" role="status" class="text-sm text-muted">{{ tr('Loading forms…', 'Chargement des formulaires…') }}</p>

    <template v-else-if="!error">
      <div v-if="forms.length" class="flex flex-wrap items-end gap-3">
        <label class="block min-w-48 flex-1 text-sm font-medium text-highlighted">
          {{ tr('Search forms', 'Rechercher des formulaires') }}
          <input v-model="search" type="search" class="mt-1 block w-full rounded-md border border-default bg-default px-3 py-2 text-sm text-highlighted"
            :placeholder="tr('Search by form or destination', 'Rechercher un formulaire ou une destination')" />
        </label>
        <label class="block text-sm font-medium text-highlighted">
          {{ tr('Status', 'Statut') }}
          <select v-model="statusFilter" class="mt-1 block rounded-md border border-default bg-default px-3 py-2 text-sm text-highlighted">
            <option value="all">{{ tr('All statuses', 'Tous les statuts') }}</option>
            <option value="published">{{ tr('Published', 'Publié') }}</option>
            <option value="changes">{{ tr('Unpublished changes', 'Modifications non publiées') }}</option>
            <option value="draft">{{ tr('Draft', 'Brouillon') }}</option>
          </select>
        </label>
      </div>

      <div v-if="!forms.length" class="border-t border-default py-12 text-center">
        <p class="font-medium text-highlighted">{{ tr('No forms yet', 'Aucun formulaire pour le moment') }}</p>
        <p class="mt-1 text-sm text-muted">{{ tr('Create a form to start designing questions and publish it on the portal.',
          'Créez un formulaire pour concevoir les questions et le publier dans le portail.') }}</p>
        <ExtensionButton class="mt-4" :disabled="disabled" @click="emit('create')">{{ tr('Create form', 'Créer un formulaire') }}</ExtensionButton>
      </div>
      <p v-else-if="!filteredForms.length" class="border-t border-default py-8 text-sm text-muted">
        {{ tr('No forms match your search or status filter.', 'Aucun formulaire ne correspond à la recherche ou au filtre de statut.') }}
      </p>
      <div v-else class="overflow-x-auto border-y border-default">
        <table class="w-full border-collapse text-left text-sm">
          <thead class="text-xs font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" class="py-3 pr-5">{{ tr('Form', 'Formulaire') }}</th>
              <th scope="col" class="px-5 py-3">{{ tr('Publication status', 'Statut de publication') }}</th>
              <th scope="col" class="px-5 py-3">{{ tr('Where it appears', 'Emplacement dans le portail') }}</th>
              <th scope="col" class="forms-library-secondary px-5 py-3">{{ tr('Last updated', 'Dernière modification') }}</th>
              <th scope="col" class="forms-library-secondary py-3 pl-5 text-right">{{ tr('Action', 'Action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="form in filteredForms" :key="form.id" class="border-t border-default hover:bg-elevated">
              <td class="py-4 pr-5 align-top">
                <button type="button" class="text-left font-semibold text-highlighted underline-offset-2 hover:underline focus-visible:underline"
                  @click="emit('open', form.id)">{{ form.title[language] || form.title.en || form.id }}</button>
                <div class="mt-1 text-xs text-muted">{{ tr('Revision', 'Version') }} {{ form.revision }} · {{ form.id }}</div>
              </td>
              <td class="px-5 py-4 align-top">
                <span class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                  :class="stateFor(form) === 'published' ? 'bg-green-500/15 text-green-700 dark:text-green-300'
                    : stateFor(form) === 'changes' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'bg-elevated text-muted'">{{ stateLabel(stateFor(form)) }}</span>
              </td>
              <td class="px-5 py-4 align-top">
                <span v-if="!publicationsFor(form).length" class="text-muted">{{ tr('Not published', 'Non publié') }}</span>
                <ul v-else class="space-y-1">
                  <li v-for="(publication, index) in publicationsFor(form)" :key="`${publication.targetType}-${publication.targetId}-${index}`">
                    {{ locationLabel(publication) }}
                    <span v-if="publication.revision !== form.revision" class="text-xs text-muted">· {{ tr('revision', 'version') }} {{ publication.revision }}</span>
                  </li>
                </ul>
              </td>
              <td class="forms-library-secondary px-5 py-4 align-top whitespace-nowrap text-muted">{{ dateLabel(form.updatedAt) }}</td>
              <td class="forms-library-secondary py-4 pl-5 text-right align-top">
                <button type="button" class="font-semibold text-primary hover:underline focus-visible:underline"
                  @click="emit('open', form.id)">{{ tr('Edit form', 'Modifier le formulaire') }}<span aria-hidden="true"> →</span></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="forms.length" class="text-xs text-muted">{{ filteredForms.length }} {{ tr('of', 'sur') }} {{ forms.length }} {{ tr('forms', 'formulaires') }}</p>
    </template>
  </div>
</template>

<style scoped>
.forms-library { container-type: inline-size; }
@container (max-width: 44rem) { .forms-library-secondary { display: none; } }
</style>
