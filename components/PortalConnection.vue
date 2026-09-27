<script setup lang="ts">
import { computed, onMounted, ref, watch, type Ref } from 'vue'
import {
  ExtensionButton, ExtensionCheckbox, ExtensionFormField, ExtensionInput, ExtensionSaveButton,
  ExtensionModal, ExtensionSelect, ExtensionTextarea, useExtensionApi, useExtensionI18n, useHostApi
} from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
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
interface PortalOrganization {
  id: string; name: string; description: string; ownerName: string; ownerEmail: string
  memberCount: number; agreementCount: number; active: boolean; verified: boolean
  proponentId: string | null; note: string | null; verifiedAt: string | null; syncedAt: string
}
interface BacklogItem { id: string; agreementId: string; organizationId: string; state: string; attempts: number; nextAttemptAt: string; lastError: string | null }
interface InboundItem { eventId: string; kind: string; submissionId: string; state: string; lastError: string | null }
interface OutcomeBacklogItem { id: string; submissionId: string; kind: string; state: string; attempts: number; nextAttemptAt: string; lastError: string | null }
interface PortalStatus { id: string; name_en: string; name_fr: string }
const props = defineProps<{
  agencyId: string
  section?: 'connection' | 'verification' | 'statuses' | 'queue' | 'delivery' | 'forms'
  config?: Record<string, unknown>
  enabled?: boolean
  disabled?: boolean
  readOnly?: boolean
}>()
const section = computed(() => props.section ?? 'connection')
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
type StatusEntity = 'agreement' | 'claim' | 'forecast' | 'funding_application' | 'other_form'
const statusEntity = ref<StatusEntity>('claim')
const entityStatusIds = ref<{ claim: string[]; forecast: string[]; funding_application: string[]; other_form: string[] }>({
  claim: [], forecast: [], funding_application: [], other_form: []
})
const visibleStatusIds = computed(() => statusEntity.value === 'agreement'
  ? selectedStatusIds.value : entityStatusIds.value[statusEntity.value])
const pullInterval = ref('manual')
const proponentVerificationAccess = ref('off')
watch(() => props.config, value => {
  const access = value?.portalProponentVerificationAccess
  proponentVerificationAccess.value = access === 'manager' || access === 'contributor' ? access : 'off'
}, { immediate: true })
const selectedOrganizationId = ref('')
const verificationNote = ref('')
const verificationConfirmOpen = ref(false)
const selectedOrganization = computed(() => organizations.value.find(item => item.id === selectedOrganizationId.value) ?? null)
const validOrganizationId = computed(() => selectedOrganization.value?.active === true && !selectedOrganization.value.verified)
const proponentSearch = ref('')
const proponents = ref<Array<{ id: string; egcs_ar_legalname_en: string; egcs_ar_legalname_fr: string }>>([])
const selectedProponentId = ref('')
const pushCount = ref('10')
const validPushCount = computed(() => Number.isInteger(Number(pushCount.value)) && pushCount.value.trim() !== ''
  && Number(pushCount.value) >= 1 && Number(pushCount.value) <= 100)
const form = ref({ portalUrl: '', portalAgencyId: '', portalKey: '' })
const busy = ref(false)
const loading = ref(true)
const message = ref('')
const error = ref('')
const pending = ref<Array<{ eventId: string; reason: string; code?: 'forecastPending' | 'documentationPending' | 'unsupportedPending'; submissionId?: string; organizationId?: string }>>([])
const receiptKind = (kind: string) => kind === 'claim' ? t('claimKind')
  : kind === 'forecast' ? t('forecastKind')
    : kind === 'organization_detail' ? t('documentationKind') : kind
const queueState = (state: string) => state === 'delivered' ? t('deliveredState')
  : state === 'cancelled' ? t('cancelledState')
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
const proponentOptions = computed(() => proponents.value.map(item => ({
  value: item.id,
  label: `${locale.value === 'fr' ? item.egcs_ar_legalname_fr : item.egcs_ar_legalname_en} (#${item.id})`
})))
const loadManagement = async () => {
  if (!connection.value) return
  const [orgs, queue, settings] = await Promise.all([
    api.get<{ organizations: PortalOrganization[] }>(`${endpoint.value}/organizations`),
    api.get<{ backlog: BacklogItem[]; outcomes: OutcomeBacklogItem[]; inbound: InboundItem[] }>(`${endpoint.value}/backlog`),
    api.get<{ statuses: PortalStatus[]; settings: { portalStatusIds: string[]; entityStatusIds: typeof entityStatusIds.value; pullIntervalMinutes: number | null; lastPullAt: string | null; lastPullError: string | null } | null }>(`${endpoint.value}/settings`)
  ])
  organizations.value = orgs.organizations
  backlog.value = queue.backlog
  inbound.value = queue.inbound
  outcomeBacklog.value = queue.outcomes
  statuses.value = settings.statuses
  selectedStatusIds.value = settings.settings?.portalStatusIds ?? []
  entityStatusIds.value = settings.settings?.entityStatusIds ?? { claim: [], forecast: [], funding_application: [], other_form: [] }
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
  if (locked.value || busy.value || !validOrganizationId.value || !selectedProponentId.value || !verificationNote.value.trim()) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api.post<{ queued: number }>(`${endpoint.value}/organizations`, {
      organizationId: selectedOrganizationId.value, proponentId: selectedProponentId.value,
      note: verificationNote.value.trim()
    })
    verificationConfirmOpen.value = false
    selectedOrganizationId.value = ''
    selectedProponentId.value = ''
    verificationNote.value = ''
    message.value = t('verifiedQueued', { count: result.queued })
    await loadManagement()
  } catch { error.value = t('verifyFailed') }
  finally { busy.value = false }
}
const refreshOrganizationChoices = async () => {
  if (locked.value || busy.value || !connection.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api.post(`${endpoint.value}/organization-sync`)
    await loadManagement()
    message.value = t('organizationsSynced')
  } catch { error.value = t('organizationSyncFailed') }
  finally { busy.value = false }
}
const saveProponentVerificationAccess = async () => {
  if (locked.value || busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await hostApi.patch(`/api/extensions/agency/${props.agencyId}`, {
      extensionKey: 'gcs-ssc-portal-connector', enabled: true,
      config: { ...props.config, portalProponentVerificationAccess: proponentVerificationAccess.value }
    })
    message.value = t('proponentVerificationSaved')
  } catch { error.value = t('proponentVerificationSaveFailed') }
  finally { busy.value = false }
}
const openVerification = (item: PortalOrganization) => {
  if (locked.value || !item.active || item.verified) return
  selectedOrganizationId.value = item.id
  selectedProponentId.value = ''
  verificationNote.value = ''
  verificationConfirmOpen.value = true
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
  if (locked.value || busy.value || !validPushCount.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api.post<{ results: Array<{ delivered: boolean }> }>(`${endpoint.value}/backlog`, { limit })
    message.value = t('pushed', { count: result.results.filter(item => item.delivered).length,
      failed: result.results.filter(item => !item.delivered).length })
    await loadManagement()
  } catch { error.value = t('pushFailed') }
  finally { busy.value = false }
}
const pushAllBacklog = async () => {
  if (locked.value || busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api.post<{ queued: number; results: Array<{ delivered: boolean }> }>(`${endpoint.value}/backlog`, { all: true })
    message.value = t('allPushed', { queued: result.queued, delivered: result.results.filter(item => item.delivered).length })
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
      entityStatusIds: entityStatusIds.value,
      pullIntervalMinutes: pullInterval.value === 'manual' ? null : Number(pullInterval.value)
    })
    message.value = t('settingsSaved')
  } catch { error.value = t('settingsFailed') }
  finally { busy.value = false }
}
const toggleStatus = (id: string, enabled: boolean) => {
  const next = enabled
    ? [...new Set([...visibleStatusIds.value, id])]
    : visibleStatusIds.value.filter(item => item !== id)
  if (statusEntity.value === 'agreement') selectedStatusIds.value = next
  else entityStatusIds.value = { ...entityStatusIds.value, [statusEntity.value]: next }
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
  let saved = false
  try {
    const input = { portalUrl: form.value.portalUrl, portalAgencyId: form.value.portalAgencyId,
      ...(form.value.portalKey ? { portalKey: form.value.portalKey } : {}) }
    const result = await api.put<{ connection: Connection }>(`${endpoint.value}/connection`, input)
    saved = true
    connection.value = result.connection
    form.value.portalKey = ''
    message.value = t('connected')
    await api.post(`${endpoint.value}/organization-sync`)
    await loadManagement()
  } catch { error.value = t(saved ? 'organizationSyncFailed' : 'saveFailed') }
  finally { busy.value = false }
}
const test = async () => {
  if (locked.value || busy.value || !valid.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api.post(`${endpoint.value}/connection-test`, {
      portalUrl: form.value.portalUrl,
      portalAgencyId: form.value.portalAgencyId,
      ...(form.value.portalKey ? { portalKey: form.value.portalKey } : {})
    })
    message.value = t('connectionTestPassed')
  } catch { error.value = t('connectionTestFailed') }
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
onMounted(searchProponents)
watch(() => props.agencyId, searchProponents)
</script>

<template>
  <div class="space-y-8">
    <section v-if="section === 'connection'" class="space-y-4">
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
        <div class="flex flex-wrap gap-3">
          <ExtensionSaveButton :label="t('saveConnection')" :disabled="locked || busy || !valid" :loading="busy" @click="save" />
          <ExtensionButton :disabled="locked || busy || !valid" :loading="busy" @click="test">{{ t('testConnection') }}</ExtensionButton>
        </div>
        <p class="text-sm text-muted">{{ t('saveConnectionHelp') }}</p>
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
      </template>
    </section>
    <section v-if="section === 'forms'" class="space-y-4">
      <h3 class="text-base font-semibold text-highlighted">{{ t('formCreator') }}</h3>
      <p v-if="!connection" class="text-sm text-muted">{{ t('connectionRequired') }}</p>
      <FormCreator v-else :agency-id="agencyId" :disabled="locked" />
    </section>
    <section v-if="section === 'verification'" class="space-y-4">
      <div><h3 class="text-base font-semibold text-highlighted">{{ t('organizationLinks') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('organizationLinksHelp') }}</p></div>
      <ExtensionFormField :label="t('proponentVerificationAccess')" name="proponentVerificationAccess" :description="t('proponentVerificationAccessHelp')">
        <ExtensionSelect v-model="proponentVerificationAccess" :items="[
          { value: 'off', label: t('verificationOff') },
          { value: 'manager', label: t('verificationManagers') },
          { value: 'contributor', label: t('verificationContributorsAndManagers') }
        ]" value-key="value" name="proponentVerificationAccess" :disabled="locked || busy" />
      </ExtensionFormField>
      <ExtensionSaveButton :label="t('saveVerificationAccess')" :disabled="locked || busy" :loading="busy" @click="saveProponentVerificationAccess" />
      <ExtensionButton :disabled="locked || busy || !connection" :loading="busy" @click="refreshOrganizationChoices">{{ t('refreshOrganizations') }}</ExtensionButton>
      <p v-if="!organizations.length" class="text-sm text-muted">{{ t('noOrganizations') }}</p>
      <div v-else class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-sm">
          <thead><tr class="border-b border-default">
            <th scope="col" class="p-2">{{ t('portalOrganization') }}</th>
            <th scope="col" class="p-2">{{ t('organizationOwner') }}</th>
            <th scope="col" class="p-2">{{ t('gcsProponent') }}</th>
            <th scope="col" class="p-2">{{ t('organizationState') }}</th>
            <th scope="col" class="p-2 text-right">{{ t('actions') }}</th>
          </tr></thead>
          <tbody><tr v-for="item in organizations" :key="item.id" class="border-b border-default align-top">
            <td class="p-2"><strong>{{ item.name }}</strong><span class="block text-muted">{{ item.id }}</span>
              <span v-if="item.description" class="block">{{ item.description }}</span>
              <span class="block text-muted">{{ t('memberCount') }}: {{ item.memberCount }} · {{ t('agreementCount') }}: {{ item.agreementCount }}</span>
            </td>
            <td class="p-2">{{ item.ownerName }}<span class="block">{{ item.ownerEmail }}</span></td>
            <td class="p-2"><span v-if="item.proponentId">#{{ item.proponentId }}<span v-if="item.note" class="block text-muted">{{ item.note }}</span></span><span v-else>—</span></td>
            <td class="p-2">{{ item.active ? t('active') : t('inactive') }}<span v-if="item.verifiedAt" class="block text-muted">{{ new Date(item.verifiedAt).toLocaleDateString(locale) }}</span></td>
            <td class="p-2 text-right"><ExtensionButton v-if="item.active && !item.verified && !locked" :disabled="busy" @click="openVerification(item)">{{ t('verifyOrganization') }}</ExtensionButton></td>
          </tr></tbody>
        </table>
      </div>
      <ExtensionModal v-model:open="verificationConfirmOpen" :title="t('verifyOrganization')" :description="t('verificationIrreversible')">
        <template #body>
          <div class="space-y-4">
            <p v-if="selectedOrganization"><strong>{{ selectedOrganization.name }}</strong> · {{ selectedOrganization.id }}<span v-if="selectedOrganization.description" class="block">{{ selectedOrganization.description }}</span></p>
            <div class="flex items-end gap-3">
              <ExtensionFormField :label="t('findProponent')" name="proponentSearch">
                <ExtensionInput v-model="proponentSearch" name="proponentSearch" :disabled="busy" @keydown.enter.prevent="searchProponents" />
              </ExtensionFormField>
              <ExtensionButton :disabled="busy" @click="searchProponents">{{ t('search') }}</ExtensionButton>
            </div>
            <ExtensionFormField :label="t('gcsProponent')" name="proponentId" required>
              <ExtensionSelect v-model="selectedProponentId" :items="proponentOptions" value-key="value" name="proponentId" required :disabled="busy" :placeholder="t('chooseProponent')" />
            </ExtensionFormField>
            <ExtensionFormField :label="t('verificationNote')" name="note" required>
              <ExtensionTextarea v-model="verificationNote" name="note" required :maxlength="4000" :disabled="busy" />
            </ExtensionFormField>
            <p class="text-sm text-warning">{{ t('verificationIrreversible') }}</p>
            <ExtensionButton :disabled="busy || !selectedProponentId || !verificationNote.trim()" :loading="busy" @click="verifyOrganization">{{ t('confirmVerification') }}</ExtensionButton>
          </div>
        </template>
      </ExtensionModal>
    </section>
    <section v-if="section === 'statuses'" class="space-y-4">
      <div><h3 class="text-base font-semibold text-highlighted">{{ t('portalStatuses') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('portalStatusesHelp') }}</p></div>
      <ExtensionFormField :label="t('statusEntity')" name="statusEntity">
        <ExtensionSelect v-model="statusEntity" :items="[
          { value: 'agreement', label: t('agreementKind') },
          { value: 'claim', label: t('claimKind') },
          { value: 'forecast', label: t('forecastKind') },
          { value: 'funding_application', label: t('fundingApplicationKind') },
          { value: 'other_form', label: t('otherFormKind') }
        ]" value-key="value" name="statusEntity" />
      </ExtensionFormField>
      <div class="grid gap-2 sm:grid-cols-2">
        <ExtensionCheckbox v-for="status in statuses" :key="status.id" :model-value="visibleStatusIds.includes(status.id)" :label="locale === 'fr' ? status.name_fr : status.name_en" :disabled="locked || busy || !connection" @update:model-value="toggleStatus(status.id, Boolean($event))" />
      </div>
      <ExtensionSaveButton :label="t('saveSettings')" :disabled="locked || busy || !connection" :loading="busy" @click="saveSettings" />
    </section>
    <section v-if="section === 'delivery'" class="space-y-3">
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
    <section v-if="section === 'queue'" class="space-y-4">
      <div><h3 class="text-base font-semibold text-highlighted">{{ t('outboundBacklog') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('outboundBacklogHelp') }}</p></div>
      <ExtensionButton :disabled="locked || busy || !connection" :loading="busy" @click="initialSync">{{ t('initialSync') }}</ExtensionButton>
      <div class="flex items-end gap-3">
        <ExtensionFormField :label="t('pushCount')" name="pushCount" required>
          <ExtensionInput v-model="pushCount" name="pushCount" type="number" min="1" max="100" required :disabled="locked || busy || !connection"
            :aria-invalid="!validPushCount" :aria-describedby="!validPushCount ? 'push-count-error' : undefined" />
          <p v-if="!validPushCount" id="push-count-error" role="alert" class="text-sm text-error">{{ t('pushCountInvalid') }}</p>
        </ExtensionFormField>
        <ExtensionButton :disabled="locked || busy || !connection || !validPushCount" :loading="busy" @click="pushBacklog">{{ t('pushBacklog') }}</ExtensionButton>
        <ExtensionButton :disabled="locked || busy || !connection" :loading="busy" @click="pushAllBacklog">{{ t('pushAll') }}</ExtensionButton>
      </div>
      <p v-if="!backlog.length" class="text-sm text-muted">{{ t('emptyBacklog') }}</p>
      <div v-else class="overflow-x-auto"><table class="w-full text-left text-sm">
        <thead><tr class="border-b border-default"><th scope="col" class="p-2">{{ t('agreement') }}</th><th scope="col" class="p-2">{{ t('portalOrganization') }}</th><th scope="col" class="p-2">{{ t('organizationState') }}</th><th scope="col" class="p-2">{{ t('attempts') }}</th><th scope="col" class="p-2">{{ t('nextAttempt') }}</th></tr></thead>
        <tbody><tr v-for="item in backlog" :key="item.id" class="border-b border-default"><td class="p-2">#{{ item.agreementId }}</td><td class="p-2">{{ item.organizationId }}</td><td class="p-2">{{ queueState(item.state) }}<span v-if="item.lastError" class="block text-error">{{ item.lastError }}</span></td><td class="p-2">{{ item.attempts }}</td><td class="p-2">{{ item.state === 'delivered' || item.state === 'cancelled' ? '—' : new Date(item.nextAttemptAt).toLocaleString(locale) }}</td></tr></tbody>
      </table></div>
      <h4 class="text-sm font-semibold text-highlighted">{{ t('outcomeBacklog') }}</h4>
      <p v-if="!outcomeBacklog.length" class="text-sm text-muted">{{ t('emptyOutcomeBacklog') }}</p>
      <div v-else class="overflow-x-auto"><table class="w-full text-left text-sm">
        <thead><tr class="border-b border-default"><th scope="col" class="p-2">{{ t('submission') }}</th><th scope="col" class="p-2">{{ t('kind') }}</th><th scope="col" class="p-2">{{ t('organizationState') }}</th><th scope="col" class="p-2">{{ t('attempts') }}</th></tr></thead>
        <tbody><tr v-for="item in outcomeBacklog" :key="item.id" class="border-b border-default"><td class="p-2">{{ item.submissionId }}</td><td class="p-2">{{ receiptKind(item.kind) }}</td><td class="p-2">{{ queueState(item.state) }}<span v-if="item.lastError" class="block text-error">{{ item.lastError }}</span></td><td class="p-2">{{ item.attempts }}</td></tr></tbody>
      </table></div>
    </section>
    <section v-if="section === 'delivery'" class="space-y-4 border-t border-default pt-6">
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
    <section v-if="section === 'delivery'" class="space-y-3 border-t border-default pt-6">
      <h3 class="text-base font-semibold text-highlighted">{{ t('receipts') }}</h3>
      <p v-if="!receipts.length" class="text-sm text-muted">{{ t('none') }}</p>
      <div v-else class="overflow-x-auto"><table class="w-full text-left text-sm">
        <thead><tr class="border-b border-default"><th scope="col" class="p-2">{{ t('kind') }}</th><th scope="col" class="p-2">{{ t('organizationState') }}</th><th scope="col" class="p-2">{{ t('gcsRecord') }}</th><th scope="col" class="p-2">{{ t('deliveredAt') }}</th></tr></thead>
        <tbody><tr v-for="receipt in receipts" :key="receipt.id" class="border-b border-default"><td class="p-2">{{ receiptKind(receipt.kind) }}</td><td class="p-2">{{ receipt.state === 'imported' ? t('imported') : t('unsupported') }}</td><td class="p-2">{{ receipt.gcs_entity_id ? `#${receipt.gcs_entity_id}` : '—' }}</td><td class="p-2"><time :datetime="receipt.created_at">{{ new Date(receipt.created_at).toLocaleString(locale) }}</time></td></tr></tbody>
      </table></div>
    </section>
    <p v-if="message" role="status" class="text-sm text-success">{{ message }}</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </div>
</template>
