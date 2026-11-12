<script setup lang="ts">
import { feedback, useLocalizedFeedback } from './localized-feedback'
import { computed, ref, watch, type Ref } from 'vue'
import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions'
import {
  ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionSelect,
  useExtensionApi, useExtensionI18n, useHostApi
} from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import { usePortalRequest } from './usePortalRequest'

interface Recipient {
  egcs_fc_applicantrecipient: string
  applicant_recipient_name_en: string
  applicant_recipient_name_fr: string
}
interface Publication {
  organizationId: string
  agreementId: string
  revision: number
  setCount: number
  publishedAt: string
}
const props = defineProps<{
  context?: ExtensionEntityTabContext
  extensionKey?: string
  agencyId?: string
  agreementId?: string
  disabled?: boolean
}>()
const { locale, t } = useExtensionI18n(messages)
const api = useExtensionApi(props.extensionKey ?? 'gcs-ssc-portal-connector')
const hostApi = useHostApi()
const recipients: Ref<Recipient[]> = ref([])
const publications: Ref<Publication[]> = ref([])
const portalUrl = ref('')
const connected = ref(false)
const recipientId = ref('')
const organizationId = ref('')
type Subject = { agencyId: string; agreementId: string }
const loadRequest = usePortalRequest()
const publishRequest = usePortalRequest()
const busy = publishRequest.pending
const loading = loadRequest.pending
const error = useLocalizedFeedback(t)
const message = useLocalizedFeedback(t)
const agreementId = computed(() => props.context?.agreementId ?? props.agreementId ?? '')
const agencyId = computed(() => props.context?.agencyId ?? props.agencyId ?? '')
const recipientOptions = computed(() => recipients.value.map((item) => ({
  value: item.egcs_fc_applicantrecipient,
  label: /^fr(?:-|$)/i.test(locale.value) ? item.applicant_recipient_name_fr : item.applicant_recipient_name_en
})))
const valid = computed(() => !props.disabled && connected.value && recipientId.value !== ''
  && /^N-[A-HJKMNP-Z2-9]{5,}$/.test(organizationId.value))
const portalLink = (publication: Publication) => {
  if (!portalUrl.value) return ''
  return new URL(`/organizations/${encodeURIComponent(publication.organizationId)}/agreements/${encodeURIComponent(publication.agreementId)}`, portalUrl.value).href
}
const fetchPublications = async (subject: Subject) => (await api.get<{ publications: Publication[] }>(
  `/agencies/${subject.agencyId}/agreements/${subject.agreementId}/publications`
)).publications
const load = async () => {
  const request = loadRequest.begin()
  if (!request) return
  const subject = { agencyId: agencyId.value, agreementId: agreementId.value }
  publishRequest.invalidate()
  recipients.value = []; publications.value = []; portalUrl.value = ''; connected.value = false
  recipientId.value = ''; error.value = ''; message.value = ''
  if (!subject.agreementId || !subject.agencyId) {
    loadRequest.invalidate()
    return
  }
  let failed = false
  try {
    const [connection, recipientResult] = await Promise.all([
      api.get<{ connection: { portalUrl: string; hasCredential: boolean } | null }>(`/agencies/${subject.agencyId}/connection`),
      hostApi.get<{ items: Recipient[] }>(`/api/agreements/${subject.agreementId}/applicant-recipients`)
    ])
    if (!loadRequest.isCurrent(request)) return
    connected.value = connection.connection?.hasCredential === true
    portalUrl.value = connection.connection?.portalUrl ?? ''
    recipients.value = recipientResult.items
    recipientId.value = recipients.value.length === 1 ? recipients.value[0]!.egcs_fc_applicantrecipient : ''
  } catch {
    if (!loadRequest.isCurrent(request)) return
    failed = true
    error.value = feedback('recipientLoadFailed')
  }
  try {
    const result = await fetchPublications(subject)
    if (loadRequest.isCurrent(request)) publications.value = result
  } catch {
    failed = true
    if (loadRequest.isCurrent(request)) error.value = feedback('publicationLoadFailed')
  } finally {
    if (failed) loadRequest.fail(request)
    else loadRequest.succeed(request)
  }
}
const publish = async () => {
  if (!valid.value || busy.value || loading.value || !agreementId.value) return
  const request = publishRequest.begin()
  if (!request) return
  const subject = { agencyId: agencyId.value, agreementId: agreementId.value }
  const organization = organizationId.value
  let failed = false
  error.value = ''; message.value = ''
  try {
    const result = await api.post<{ agreementId: string; setIds: string[] }>(
      `/agencies/${subject.agencyId}/publish-agreement`,
      { agreementId: subject.agreementId, proponentId: recipientId.value, portalOrganizationId: organization }
    )
    if (!publishRequest.isCurrent(request)) return
    message.value = feedback('published', { agreement: result.agreementId, count: result.setIds.length,
      organization })
    const resultPublications = await fetchPublications(subject)
    if (publishRequest.isCurrent(request)) publications.value = resultPublications
  } catch {
    failed = true
    if (publishRequest.isCurrent(request)) error.value = feedback('publishFailed')
  } finally {
    if (failed) publishRequest.fail(request)
    else publishRequest.succeed(request)
  }
}
watch([agreementId, agencyId], load, { immediate: true, flush: 'sync' })
</script>

<template>
  <div class="space-y-8" data-field-scope="extension.gcs-ssc-portal-connector.agreement-portal">
    <section class="space-y-4">
      <div>
        <h3 class="text-base font-semibold text-highlighted">{{ t('publish') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('publishHelp') }}</p>
      </div>
      <p v-if="loading" role="status">{{ t('loading') }}</p>
      <template v-else-if="!connected"><p class="text-sm text-muted">{{ t('noConnection') }}</p></template>
      <template v-else>
        <p v-if="!recipients.length" class="text-sm text-muted">{{ t('noRecipients') }}</p>
        <div v-else class="grid gap-4 sm:grid-cols-2">
          <ExtensionFormField :label="t('recipient')" name="recipientId" required>
            <ExtensionSelect v-model="recipientId" :items="recipientOptions" value-key="value" name="recipientId" required :disabled="busy || disabled" :placeholder="t('chooseRecipient')" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('organization')" name="organizationId" :description="t('organizationHelp')" required>
            <ExtensionInput v-model="organizationId" name="organizationId" required :disabled="busy || disabled" placeholder="N-ABCDE" />
          </ExtensionFormField>
        </div>
        <ExtensionButton v-if="recipients.length" :disabled="busy || !valid" :loading="busy" @click="publish">{{ t('publish') }}</ExtensionButton>
      </template>
    </section>
    <section class="space-y-3 border-t border-default pt-6">
      <h3 class="text-base font-semibold text-highlighted">{{ t('publications') }}</h3>
      <p v-if="!publications.length" class="text-sm text-muted">{{ t('noPublications') }}</p>
      <ul v-else class="divide-y divide-default text-sm">
        <li v-for="publication in publications" :key="publication.organizationId" class="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
          <strong>{{ publication.organizationId }}</strong>
          <span>{{ t('portalAgreement') }} {{ publication.agreementId }}</span>
          <span>{{ t('forms') }}: {{ publication.setCount }}</span>
          <time :datetime="publication.publishedAt">{{ t('publishedAt') }} {{ new Date(publication.publishedAt).toLocaleString(locale) }}</time>
          <a v-if="portalUrl" :href="portalLink(publication)" target="_blank" rel="noopener noreferrer" class="text-primary underline">{{ t('portalLink') }}</a>
        </li>
      </ul>
    </section>
    <p v-if="message" role="status" class="text-sm text-success">{{ message }}</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </div>
</template>
