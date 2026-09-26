<script setup lang="ts">
import { computed, onMounted, ref, watch, type Ref } from 'vue'
import {
  ExtensionButton, ExtensionCheckbox, ExtensionFormField, ExtensionInput, ExtensionSaveButton,
  ExtensionSelect, useExtensionApi, useExtensionI18n, useHostApi
} from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import AgreementPortal from './AgreementPortal.vue'
import FormCreator from './FormCreator.vue'

interface Connection {
  portalUrl: string
  portalAgencyId: string
  hasCredential: boolean
}
interface Receipt {
  id: string
  kind: string
  state: string
  gcs_entity_id: string | null
  created_at: string
}
interface PortalOrganization { id: string; name: string; active: boolean; verified: boolean; foreignApplicantRecipientId: string | null }
interface BacklogItem { id: string; agreementId: string; organizationId: string; state: string; attempts: number; nextAttemptAt: string; lastError: string | null }
interface InboundItem { eventId: string; kind: string; submissionId: string; state: string; lastError: string | null }
interface OutcomeBacklogItem { id: string; submissionId: string; kind: string; state: string; attempts: number; nextAttemptAt: string; lastError: string | null }
interface PortalStatus { id: string; name_en: string; name_fr: string }
const props = defineProps<{
  agencyId: string
  enabled?: boolean
  disabled?: boolean
  readOnly?: boolean
}>()
const { t, locale } = useExtensionI18n(messages)
const api = useExtensionApi('gcs-ssc-portal-connector')
const hostApi = useHostApi()
const connection: Ref<Connection | null> = ref(null)
const receipts: Ref<Receipt[]> = ref([])
const organizations: Ref<PortalOrganization[]> = ref([])
const backlog: Ref<BacklogItem[]> = ref([])
const inbound: Ref<InboundItem[]> = ref([])
const outcomeBacklog: Ref<OutcomeBacklogItem[]> = ref([])
const lastPullAt = ref<string | null>(null)
const lastPullError = ref<string | null>(null)
const statuses: Ref<PortalStatus[]> = ref([])
const selectedStatusIds = ref<string[]>([])
const pullInterval = ref('manual')
const selectedOrganizationId = ref('')
const organizationCode = ref('')
watch(selectedOrganizationId, (value) => { if (value) organizationCode.value = '' })
watch(organizationCode, (value) => { if (value.trim()) selectedOrganizationId.value = '' })
const proponentSearch = ref('')
const proponents = ref<Array<{ id: string; egcs_ar_legalname_en: string; egcs_ar_legalname_fr: string }>>([])
const selectedProponentId = ref('')
const pushCount = ref('10')
const form = ref({ portalUrl: '', portalAgencyId: '', portalKey: '' })
const busy = ref(false)
const loading = ref(true)
const message = ref('')
const error = ref('')
const pending = ref<Array<{ eventId: string; reason: string; code?: 'forecastPending' | 'documentationPending' | 'unsupportedPending'; submissionId?: string; organizationId?: string }>>([])
const agreementSearch = ref('')
const agreements = ref<Array<{ id: string; egcs_fc_title_en: string; egcs_fc_title_fr: string;
  egcs_fc_agreementnumber: string }>>([])
const selectedAgreementId = ref('')
const searchPending = ref(false)
const agreementOptions = computed(() => agreements.value.map((agreement) => ({
  value: agreement.id,
  label: `${agreement.egcs_fc_agreementnumber} — ${locale.value === 'fr' ? agreement.egcs_fc_title_fr : agreement.egcs_fc_title_en}`
})))
const receiptKind = (kind: string) => kind === 'claim' ? t('claimKind')
  : kind === 'forecast' ? t('forecastKind')
    : kind === 'organization_detail' ? t('documentationKind') : kind
const queueState = (state: string) => state === 'delivered' ? t('deliveredState')
  : state === 'leased' ? t('sendingState')
    : state === 'imported' ? t('imported')
      : state === 'unsupported' ? t('unsupported') : t('queuedState')
const pendingMessage = (item: typeof pending.value[number]) => item.code
  ? t(item.code, { submission: item.submissionId ?? '', organization: item.organizationId ?? '' })
  : item.reason
const locked = computed(() => props.enabled === false || props.disabled === true || props.readOnly === true)
const valid = computed(() => {
  const { portalUrl, portalAgencyId, portalKey } = form.value
  let url: URL
  try { url = new URL(portalUrl) } catch { return false }
  return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
    && /^G-[A-HJKMNP-Z2-9]{5,}$/.test(portalAgencyId)
    && (portalKey === '' ? connection.value?.hasCredential === true : /^gcs_[A-Za-z0-9_-]{43}$/.test(portalKey))
})
const endpoint = computed(() => `/agencies/${props.agencyId}`)
const organizationOptions = computed(() => organizations.value.filter(item => item.active).map(item => ({
  value: item.id, label: `${item.name} (${item.id})${item.verified ? ` · ${t('verified')}` : ''}`
})))
const proponentOptions = computed(() => proponents.value.map(item => ({
  value: item.id,
  label: `${locale.value === 'fr' ? item.egcs_ar_legalname_fr : item.egcs_ar_legalname_en} (#${item.id})`
})))
const loadManagement = async () => {
  if (!connection.value) return
  const [orgs, queue, settings] = await Promise.all([
    api.get<{ organizations: PortalOrganization[] }>(`${endpoint.value}/organizations`),
    api.get<{ backlog: BacklogItem[]; outcomes: OutcomeBacklogItem[]; inbound: InboundItem[] }>(`${endpoint.value}/backlog`),
    api.get<{ statuses: PortalStatus[]; settings: { portalStatusIds: string[]; pullIntervalMinutes: number | null; lastPullAt: string | null; lastPullError: string | null } | null }>(`${endpoint.value}/settings`)
  ])
  organizations.value = orgs.organizations
  backlog.value = queue.backlog
  inbound.value = queue.inbound
  outcomeBacklog.value = queue.outcomes
  statuses.value = settings.statuses
  selectedStatusIds.value = settings.settings?.portalStatusIds ?? []
  pullInterval.value = settings.settings?.pullIntervalMinutes?.toString() ?? 'manual'
  lastPullAt.value = settings.settings?.lastPullAt ?? null
  lastPullError.value = settings.settings?.lastPullError ?? null
}
const searchProponents = async () => {
  try {
    const params = new URLSearchParams({ agency_id: props.agencyId, limit: '20',
      ...(proponentSearch.value.trim() ? { search: proponentSearch.value.trim() } : {}) })
    proponents.value = (await hostApi.get<{ items: typeof proponents.value }>(`/api/applicant-recipients?${params}`)).items
  } catch { error.value = t('proponentSearchFailed') }
}
const verifyOrganization = async () => {
  const organizationId = organizationCode.value.trim() || selectedOrganizationId.value
  if (locked.value || busy.value || !/^N-[A-HJKMNP-Z2-9]{5,}$/.test(organizationId) || !selectedProponentId.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api.post<{ queued: number }>(`${endpoint.value}/organizations`, {
      organizationId, proponentId: selectedProponentId.value
    })
    message.value = t('verifiedQueued', { count: result.queued })
    await loadManagement()
  } catch { error.value = t('verifyFailed') }
  finally { busy.value = false }
}
const initialSync = async () => {
  if (locked.value || busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api.post<{ queued: number }>(`${endpoint.value}/initial-sync`)
    message.value = t('initialQueued', { count: result.queued })
    await loadManagement()
  } catch { error.value = t('initialFailed') }
  finally { busy.value = false }
}
const pushBacklog = async () => {
  const limit = Number(pushCount.value)
  if (locked.value || busy.value || !Number.isInteger(limit) || limit < 1 || limit > 100) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api.post<{ results: Array<{ delivered: boolean }> }>(`${endpoint.value}/backlog`, { limit })
    message.value = t('pushed', { count: result.results.filter(item => item.delivered).length,
      failed: result.results.filter(item => !item.delivered).length })
    await loadManagement()
  } catch { error.value = t('pushFailed') }
  finally { busy.value = false }
}
const saveSettings = async () => {
  if (locked.value || busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api.put(`${endpoint.value}/settings`, {
      portalStatusIds: selectedStatusIds.value,
      pullIntervalMinutes: pullInterval.value === 'manual' ? null : Number(pullInterval.value)
    })
    message.value = t('settingsSaved')
  } catch { error.value = t('settingsFailed') }
  finally { busy.value = false }
}
const toggleStatus = (id: string, enabled: boolean) => {
  selectedStatusIds.value = enabled
    ? [...new Set([...selectedStatusIds.value, id])]
    : selectedStatusIds.value.filter(item => item !== id)
}
const searchAgreements = async () => {
  searchPending.value = true
  try {
    const params = new URLSearchParams({ agency_id: props.agencyId, limit: '20',
      ...(agreementSearch.value.trim() ? { search: agreementSearch.value.trim() } : {}) })
    agreements.value = (await hostApi.get<{ items: typeof agreements.value }>(`/api/agreements?${params}`)).items
    if (!agreements.value.some((item) => item.id === selectedAgreementId.value)) selectedAgreementId.value = ''
  } catch { error.value = t('agreementSearchFailed') }
  finally { searchPending.value = false }
}
const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const [summary, history] = await Promise.all([
      api.get<{ connection: Connection | null }>(`${endpoint.value}/connection`),
      api.get<{ receipts: Receipt[] }>(`${endpoint.value}/receipts`)
    ])
    connection.value = summary.connection
    form.value = {
      portalUrl: summary.connection?.portalUrl ?? '',
      portalAgencyId: summary.connection?.portalAgencyId ?? '', portalKey: ''
    }
    receipts.value = history.receipts
    if (summary.connection) await loadManagement()
  } catch {
    error.value = t('loadFailed')
  } finally { loading.value = false }
}
const save = async () => {
  if (locked.value || busy.value || !valid.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const input = { portalUrl: form.value.portalUrl, portalAgencyId: form.value.portalAgencyId,
      ...(form.value.portalKey ? { portalKey: form.value.portalKey } : {}) }
    const result = await api.put<{ connection: Connection }>(`${endpoint.value}/connection`, input)
    connection.value = result.connection
    form.value.portalKey = ''
    message.value = t('connected')
    await loadManagement()
  } catch { error.value = t('saveFailed') }
  finally { busy.value = false }
}
const sync = async () => {
  if (locked.value || busy.value || !connection.value) return
  busy.value = true; error.value = ''; message.value = ''; pending.value = []
  try {
    const result = await api.post<{
      imported: Array<{ entityId: string }>
      pending: Array<{ eventId: string; reason: string }>
    }>(`${endpoint.value}/sync`)
    pending.value = result.pending
    message.value = t('syncDone', { count: result.imported.length, pending: result.pending.length })
    receipts.value = (await api.get<{ receipts: Receipt[] }>(`${endpoint.value}/receipts`)).receipts
  } catch { error.value = t('syncFailed') }
  finally { busy.value = false }
}
onMounted(load)
watch(() => props.agencyId, load)
onMounted(searchAgreements)
watch(() => props.agencyId, searchAgreements)
onMounted(searchProponents)
watch(() => props.agencyId, searchProponents)
</script>

<template>
  <div class="space-y-8">
    <section class="space-y-4">
      <div>
        <h3 class="text-base font-semibold text-highlighted">{{ t('connection') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('connectionHelp') }}</p>
      </div>
      <p v-if="loading" role="status">{{ t('loading') }}</p>
      <template v-else>
        <p v-if="!connection" class="text-sm text-muted">{{ t('notConnected') }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <ExtensionFormField :label="t('portalUrl')" name="portalUrl" :description="t('portalUrlHelp')" required>
            <ExtensionInput v-model="form.portalUrl" type="url" name="portalUrl" required autocomplete="url" :disabled="locked || busy" placeholder="https://portal.example.gc.ca/" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('portalAgency')" name="portalAgencyId" :description="t('portalAgencyHelp')" required>
            <ExtensionInput v-model="form.portalAgencyId" name="portalAgencyId" required :disabled="locked || busy" placeholder="G-ABCDE" />
          </ExtensionFormField>
        </div>
        <ExtensionFormField :label="t('portalKey')" name="portalKey" :description="t('portalKeyHelp')" :required="!connection?.hasCredential">
          <ExtensionInput v-model="form.portalKey" type="password" name="portalKey" :required="!connection?.hasCredential" autocomplete="new-password" :disabled="locked || busy" />
        </ExtensionFormField>
        <ExtensionSaveButton :label="t('saveConnection')" :disabled="locked || busy || !valid" :loading="busy" @click="save" />
        <p class="text-sm text-muted">{{ t('saveConnectionHelp') }}</p>
      </template>
    </section>
    <details v-if="connection" class="border-t border-default pt-6">
      <summary class="cursor-pointer text-base font-semibold text-highlighted">{{ t('formCreator') }}</summary>
      <FormCreator :agency-id="agencyId" :disabled="locked" />
    </details>
    <section class="space-y-4 border-t border-default pt-6">
      <div><h3 class="text-base font-semibold text-highlighted">{{ t('organizationLinks') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('organizationLinksHelp') }}</p></div>
      <div class="grid gap-4 sm:grid-cols-2">
        <ExtensionFormField :label="t('portalOrganization')" name="portalOrganization">
          <ExtensionSelect v-model="selectedOrganizationId" :items="organizationOptions" value-key="value" name="portalOrganization" :disabled="locked || busy || !connection" :placeholder="t('chooseOrganization')" />
        </ExtensionFormField>
        <ExtensionFormField :label="t('organizationCode')" name="organizationCode" :description="t('organizationCodeHelp')">
          <ExtensionInput v-model="organizationCode" name="organizationCode" :disabled="locked || busy || !connection" placeholder="N-ABCDE" />
        </ExtensionFormField>
        <div class="space-y-2">
          <ExtensionFormField :label="t('findProponent')" name="proponentSearch">
            <ExtensionInput v-model="proponentSearch" name="proponentSearch" :disabled="locked || busy" @keydown.enter.prevent="searchProponents" />
          </ExtensionFormField>
          <ExtensionButton :disabled="locked || busy" @click="searchProponents">{{ t('search') }}</ExtensionButton>
        </div>
      </div>
      <ExtensionFormField :label="t('gcsProponent')" name="proponentId" required>
        <ExtensionSelect v-model="selectedProponentId" :items="proponentOptions" value-key="value" name="proponentId" :disabled="locked || busy || !connection" :placeholder="t('chooseProponent')" />
      </ExtensionFormField>
      <ExtensionButton :disabled="locked || busy || !connection || !(organizationCode.trim() || selectedOrganizationId) || !selectedProponentId" :loading="busy" @click="verifyOrganization">{{ t('verifyOrganization') }}</ExtensionButton>
      <ul v-if="organizations.some(item => item.verified)" class="divide-y divide-default text-sm">
        <li v-for="item in organizations.filter(row => row.verified)" :key="item.id" class="py-2">{{ item.name }} ({{ item.id }}) → #{{ item.foreignApplicantRecipientId }}</li>
      </ul>
    </section>
    <section class="space-y-4 border-t border-default pt-6">
      <div><h3 class="text-base font-semibold text-highlighted">{{ t('portalStatuses') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('portalStatusesHelp') }}</p></div>
      <div class="grid gap-2 sm:grid-cols-2">
        <ExtensionCheckbox v-for="status in statuses" :key="status.id" :model-value="selectedStatusIds.includes(status.id)" :label="locale === 'fr' ? status.name_fr : status.name_en" :disabled="locked || busy || !connection" @update:model-value="toggleStatus(status.id, Boolean($event))" />
      </div>
      <ExtensionFormField :label="t('pullSchedule')" name="pullSchedule" :description="t('pullScheduleHelp')">
        <ExtensionSelect v-model="pullInterval" :items="[
          { value: 'manual', label: t('manualOnly') },
          { value: '1', label: t('everyMinute') },
          { value: '5', label: t('everyFiveMinutes') },
          { value: '15', label: t('everyFifteenMinutes') },
          { value: '30', label: t('everyThirtyMinutes') },
          { value: '60', label: t('everyHour') }
        ]" value-key="value" name="pullSchedule" :disabled="locked || busy || !connection" />
      </ExtensionFormField>
      <ExtensionSaveButton :label="t('saveSettings')" :disabled="locked || busy || !connection" :loading="busy" @click="saveSettings" />
      <p v-if="lastPullAt" class="text-sm text-muted">{{ t('lastPull') }} {{ new Date(lastPullAt).toLocaleString(locale) }}</p>
      <p v-if="lastPullError" class="text-sm text-error">{{ lastPullError }}</p>
    </section>
    <section class="space-y-3 border-t border-default pt-6">
      <h3 class="text-base font-semibold text-highlighted">{{ t('inboundBacklog') }}</h3>
      <p class="text-sm text-muted">{{ t('inboundBacklogHelp') }}</p>
      <p v-if="!inbound.length" class="text-sm text-muted">{{ t('emptyInbound') }}</p>
      <ul v-else class="divide-y divide-default text-sm">
        <li v-for="item in inbound" :key="item.eventId" class="py-2">
          {{ item.submissionId }} · {{ item.kind }} · {{ queueState(item.state) }}
          <p v-if="item.lastError" class="text-error">{{ item.lastError }}</p>
        </li>
      </ul>
    </section>
    <section class="space-y-4 border-t border-default pt-6">
      <div><h3 class="text-base font-semibold text-highlighted">{{ t('outboundBacklog') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('outboundBacklogHelp') }}</p></div>
      <ExtensionButton :disabled="locked || busy || !connection" :loading="busy" @click="initialSync">{{ t('initialSync') }}</ExtensionButton>
      <div class="flex items-end gap-3">
        <ExtensionFormField :label="t('pushCount')" name="pushCount">
          <ExtensionInput v-model="pushCount" name="pushCount" type="number" min="1" max="100" :disabled="locked || busy || !connection" />
        </ExtensionFormField>
        <ExtensionButton :disabled="locked || busy || !connection" :loading="busy" @click="pushBacklog">{{ t('pushBacklog') }}</ExtensionButton>
      </div>
      <p v-if="!backlog.length" class="text-sm text-muted">{{ t('emptyBacklog') }}</p>
      <ul v-else class="divide-y divide-default text-sm">
        <li v-for="item in backlog" :key="item.id" class="py-2">
          <span>{{ queueState(item.state) }} · #{{ item.agreementId }} → {{ item.organizationId }} · {{ t('attempts') }} {{ item.attempts }}</span>
          <span v-if="item.state !== 'delivered'"> · {{ t('nextAttempt') }} {{ new Date(item.nextAttemptAt).toLocaleString(locale) }}</span>
          <p v-if="item.lastError" class="text-error">{{ item.lastError }}</p>
        </li>
      </ul>
      <h4 class="text-sm font-semibold text-highlighted">{{ t('outcomeBacklog') }}</h4>
      <p v-if="!outcomeBacklog.length" class="text-sm text-muted">{{ t('emptyOutcomeBacklog') }}</p>
      <ul v-else class="divide-y divide-default text-sm">
        <li v-for="item in outcomeBacklog" :key="item.id" class="py-2">
          {{ item.submissionId }} · {{ receiptKind(item.kind) }} · {{ queueState(item.state) }} · {{ t('attempts') }} {{ item.attempts }}
          <span v-if="item.state !== 'delivered'"> · {{ t('nextAttempt') }} {{ new Date(item.nextAttemptAt).toLocaleString(locale) }}</span>
          <p v-if="item.lastError" class="text-error">{{ item.lastError }}</p>
        </li>
      </ul>
    </section>
    <section class="space-y-4 border-t border-default pt-6">
      <div>
        <h3 class="text-base font-semibold text-highlighted">{{ t('sync') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('syncHelp') }}</p>
      </div>
      <p v-if="!connection" class="text-sm text-muted">{{ t('connectionRequired') }}</p>
      <ExtensionButton :disabled="locked || busy || !connection" :loading="busy" @click="sync">{{ t('sync') }}</ExtensionButton>
      <div v-if="pending.length" class="space-y-2">
        <h4 class="text-sm font-semibold">{{ t('pending') }}</h4>
        <ul class="list-disc space-y-1 pl-5 text-sm"><li v-for="item in pending" :key="item.eventId">{{ pendingMessage(item) }}</li></ul>
      </div>
    </section>
    <section class="space-y-4 border-t border-default pt-6">
      <div>
        <h3 class="text-base font-semibold text-highlighted">{{ t('findAgreement') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('findAgreementHelp') }}</p>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <ExtensionFormField :label="t('findAgreement')" name="agreementSearch">
          <ExtensionInput v-model="agreementSearch" name="agreementSearch" :disabled="searchPending" @keydown.enter.prevent="searchAgreements" />
        </ExtensionFormField>
        <ExtensionButton :disabled="searchPending" :loading="searchPending" @click="searchAgreements">{{ t('search') }}</ExtensionButton>
      </div>
      <ExtensionFormField :label="t('agreement')" name="agreementId" required>
        <ExtensionSelect v-model="selectedAgreementId" :items="agreementOptions" value-key="value" name="agreementId" :disabled="!agreements.length || searchPending" :placeholder="t('chooseAgreement')" />
      </ExtensionFormField>
      <p v-if="!agreements.length && !searchPending" class="text-sm text-muted">{{ t('noAgreements') }}</p>
      <AgreementPortal v-if="selectedAgreementId" :key="selectedAgreementId" :agency-id="agencyId" :agreement-id="selectedAgreementId" :disabled="locked" />
    </section>
    <section class="space-y-3 border-t border-default pt-6">
      <h3 class="text-base font-semibold text-highlighted">{{ t('receipts') }}</h3>
      <p v-if="!receipts.length" class="text-sm text-muted">{{ t('none') }}</p>
      <ul v-else class="divide-y divide-default text-sm">
        <li v-for="receipt in receipts.slice(0, 5)" :key="receipt.id" class="flex flex-wrap gap-x-3 py-2">
          <span>{{ receiptKind(receipt.kind) }}</span>
          <span>{{ receipt.state === 'imported' ? t('imported') : t('unsupported') }}</span>
          <span v-if="receipt.gcs_entity_id">#{{ receipt.gcs_entity_id }}</span>
          <time :datetime="receipt.created_at">{{ new Date(receipt.created_at).toLocaleString(locale) }}</time>
        </li>
      </ul>
    </section>
    <p v-if="message" role="status" class="text-sm text-success">{{ message }}</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </div>
</template>
