<script setup lang="ts">
import { computed, onMounted, ref, watch, type Ref } from 'vue'
import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions'
import {
  ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionSelect,
  useExtensionApi, useExtensionI18n, useHostApi
} from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'

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
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const message = ref('')
const agreementId = computed(() => props.context?.agreementId ?? props.agreementId ?? '')
const agencyId = computed(() => props.context?.agencyId ?? props.agencyId ?? '')
const recipientOptions = computed(() => recipients.value.map((item) => ({
  value: item.egcs_fc_applicantrecipient,
  label: locale.value === 'fr' ? item.applicant_recipient_name_fr : item.applicant_recipient_name_en
})))
const valid = computed(() => !props.disabled && connected.value && recipientId.value !== ''
  && /^N-[A-HJKMNP-Z2-9]{5,}$/.test(organizationId.value))
const portalLink = (publication: Publication) => {
  if (!portalUrl.value) return ''
  return new URL(`/organizations/${encodeURIComponent(publication.organizationId)}/agreements/${encodeURIComponent(publication.agreementId)}`, portalUrl.value).href
}
const refreshPublications = async () => {
  publications.value = (await api.get<{ publications: Publication[] }>(
    `/agencies/${agencyId.value}/agreements/${agreementId.value}/publications`
  )).publications
}
const load = async () => {
  if (!agreementId.value || !agencyId.value) return
  loading.value = true; error.value = ''; message.value = ''
  try {
    const [connection, recipientResult] = await Promise.all([
      api.get<{ connection: { portalUrl: string; hasCredential: boolean } | null }>(`/agencies/${agencyId.value}/connection`),
      hostApi.get<{ items: Recipient[] }>(`/api/agreements/${agreementId.value}/applicant-recipients`)
    ])
    connected.value = connection.connection?.hasCredential === true
    portalUrl.value = connection.connection?.portalUrl ?? ''
    recipients.value = recipientResult.items
    if (!recipients.value.some((item) => item.egcs_fc_applicantrecipient === recipientId.value))
      recipientId.value = recipients.value.length === 1 ? recipients.value[0]!.egcs_fc_applicantrecipient : ''
  } catch { error.value = t('recipientLoadFailed') }
  try { await refreshPublications() } catch { error.value = t('publicationLoadFailed') }
  finally { loading.value = false }
}
const publish = async () => {
  if (!valid.value || busy.value || !agreementId.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api.post<{ agreementId: string; setIds: string[] }>(
      `/agencies/${agencyId.value}/publish-agreement`,
      { agreementId: agreementId.value, proponentId: recipientId.value, portalOrganizationId: organizationId.value }
    )
    message.value = t('published', { agreement: result.agreementId, count: result.setIds.length,
      organization: organizationId.value })
    await refreshPublications()
  } catch { error.value = t('publishFailed') }
  finally { busy.value = false }
}
onMounted(load)
watch(() => [agreementId.value, agencyId.value], load)
</script>

<template>
  <div class="space-y-8">
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
