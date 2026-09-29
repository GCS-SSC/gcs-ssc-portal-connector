<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions'
import { ExtensionButton, useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import FormCreator from './FormCreator.vue'

type Form = { surveyId: string; revision: number; title: { en: string; fr: string } }
const props = defineProps<{ context: ExtensionEntityTabContext; disabled?: boolean }>()
const api = useExtensionApi('gcs-ssc-portal-connector')
const { locale } = useExtensionI18n(messages)
const tr = (en: string, fr: string) => locale.value === 'fr' ? fr : en
const agencyId = computed(() => props.context.agencyId ?? '')
const opportunityId = computed(() => props.context.opportunityId ?? props.context.ownerId)
const streamId = computed(() => props.context.streamId ?? '')
const readEndpoint = computed(() => `/agencies/${agencyId.value}/opportunities/${opportunityId.value}/forms`)
const writeEndpoint = computed(() => `/agencies/${agencyId.value}/opportunities/${opportunityId.value}`)
const forms = ref<Form[]>([])
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
    if (current === sequence) error.value = tr('Could not load opportunity forms.', 'Impossible de charger les formulaires de l’occasion.')
  } finally { if (current === sequence) loading.value = false }
}
watch(() => [agencyId.value, opportunityId.value], () => {
  editing.value = null; forms.value = []; published.value = false; void load()
}, { immediate: true })
const changeForms = async (next: Form[]) => {
  if (busy.value || published.value || !canWrite.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api.post(writeEndpoint.value, { action: 'saveForms', forms: next.map(form => ({
      surveyId: form.surveyId, revision: form.revision
    })) })
    message.value = tr('Form order saved.', 'Ordre des formulaires enregistré.')
    await load()
  } catch { error.value = tr('Could not save the forms.', 'Impossible d’enregistrer les formulaires.') }
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
  if (busy.value || !canWrite.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api.post(writeEndpoint.value, { action })
    message.value = action === 'publish'
      ? tr('Opportunity published in the portal.', 'Occasion publiée dans le portail.')
      : tr('Opportunity withdrawn from the portal.', 'Occasion retirée du portail.')
    await load()
  } catch {
    error.value = action === 'publish'
      ? tr('Publication failed. Activate the opportunity and complete every form in both languages.',
        'Échec de la publication. Activez l’occasion et remplissez tous les formulaires dans les deux langues.')
      : tr('Could not withdraw the opportunity.', 'Impossible de retirer l’occasion.')
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
      <div>
        <h3 class="text-base font-semibold">{{ tr('Application forms', 'Formulaires de demande') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ tr('Applicants complete every form below as one application, in this order.',
          'Les demandeurs remplissent tous les formulaires ci-dessous dans une seule demande, dans cet ordre.') }}</p>
      </div>
      <p v-if="loading" role="status">{{ tr('Loading forms…', 'Chargement des formulaires…') }}</p>
      <p v-else-if="!forms.length">{{ tr('No forms attached yet.', 'Aucun formulaire associé pour le moment.') }}</p>
      <ol v-else class="divide-y divide-default border-y border-default">
        <li v-for="(form, index) in forms" :key="form.surveyId" class="flex flex-wrap items-center gap-3 py-3">
          <span class="text-sm text-muted">{{ index + 1 }}.</span>
          <strong class="min-w-40 flex-1">{{ form.title[locale === 'fr' ? 'fr' : 'en'] || form.surveyId }}</strong>
          <span class="text-sm text-muted">{{ tr('Revision', 'Version') }} {{ form.revision }}</span>
          <ExtensionButton color="neutral" variant="outline" size="sm" @click="editing = form.surveyId">
            {{ published || !canWrite ? tr('View', 'Voir') : tr('Edit', 'Modifier') }}
          </ExtensionButton>
          <template v-if="canWrite && !published && !disabled">
            <ExtensionButton color="neutral" variant="ghost" size="sm" :disabled="busy || index === 0" @click="move(index, -1)">
              {{ tr('Up', 'Monter') }}</ExtensionButton>
            <ExtensionButton color="neutral" variant="ghost" size="sm" :disabled="busy || index === forms.length - 1" @click="move(index, 1)">
              {{ tr('Down', 'Descendre') }}</ExtensionButton>
            <ExtensionButton color="neutral" variant="ghost" size="sm" :disabled="busy" @click="changeForms(forms.filter(item => item.surveyId !== form.surveyId))">
              {{ tr('Remove', 'Retirer') }}</ExtensionButton>
          </template>
        </li>
      </ol>
      <div v-if="canWrite && !disabled" class="flex flex-wrap gap-3">
        <ExtensionButton v-if="!published && forms.length < 10" :disabled="busy" @click="editing = ''">
          {{ tr('Create form', 'Créer un formulaire') }}</ExtensionButton>
        <ExtensionButton v-if="!published" :disabled="busy || !forms.length" :loading="busy" @click="act('publish')">
          {{ tr('Publish opportunity', 'Publier l’occasion') }}</ExtensionButton>
        <ExtensionButton v-else color="neutral" variant="outline" :disabled="busy" :loading="busy" @click="act('withdraw')">
          {{ tr('Withdraw opportunity', 'Retirer l’occasion') }}</ExtensionButton>
      </div>
      <p v-if="published" class="text-sm text-muted">{{ tr('Published forms are pinned to their saved revisions. Withdraw before editing.',
        'Les formulaires publiés sont liés à leurs versions enregistrées. Retirez l’occasion avant de les modifier.') }}</p>
      <p v-if="message" role="status" class="text-sm text-success">{{ message }}</p>
      <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    </template>
  </section>
</template>
