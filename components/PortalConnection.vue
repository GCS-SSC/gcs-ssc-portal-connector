<script setup lang="ts">
import { formatMoneyText, parseMoney } from '@gcs-ssc/extensions/money'
import { feedback, useLocalizedFeedback, type Feedback } from './localized-feedback'
import { FetchResponseError } from '@gcs-ssc/extensions'
import { computed, h, onMounted, ref, watch, type Ref } from 'vue'
import {
  ExtensionAlert, ExtensionBadge, ExtensionButton, ExtensionCheckbox, ExtensionFormField, ExtensionInput, ExtensionSaveButton,
  ExtensionModal, ExtensionResourceLayout, ExtensionSelect, ExtensionTextarea,
  useExtensionApi, useExtensionI18n, useExtensionToast, useHostApi
} from '@gcs-ssc/extensions/ui'
import { usePortalRequest } from './usePortalRequest'
import { readImportDiagnostic } from '../shared/import-diagnostics'
import { messages } from '../i18n/messages'
import FormCreator from './FormCreator.vue'
import FormLibrary from './FormLibrary.vue'
import IntakeWorkspace from './IntakeWorkspace.vue'
import ReceiptEvidence from './ReceiptEvidence.vue'
import IntakeImportSettings from './IntakeImportSettings.vue'

interface Connection {
  portalUrl: string
  portalAgencyId: string
  hasCredential: boolean
}
interface Receipt {
  id: string
  kind: string
  submission_id: string
  organization_id: string | null
  form_title: { en: string; fr: string } | null
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
interface BacklogDetail extends BacklogItem {
  createdAt: string; deliveredAt: string | null
  payload: { agreement?: Record<string, unknown>; [key: string]: unknown } | null
}
interface InboundItem { eventId: string; kind: string; submissionId: string; state: string; lastError: string | null }
interface OutcomeBacklogItem { id: string; submissionId: string; kind: string; state: string; attempts: number; nextAttemptAt: string; lastError: string | null }
interface PortalOperation { id: string; kind: 'form' | 'request'; target: string; state: string; attempts: number; nextAttemptAt: string; lastError: string | null }
interface PortalStatus { id: string; name_en: string; name_fr: string }
const props = defineProps<{
  agencyId: string
  section?: 'connection' | 'verification' | 'statuses' | 'queue' | 'delivery' | 'forms' | 'intakes'
  config?: Record<string, unknown>
  enabled?: boolean
  disabled?: boolean
  readOnly?: boolean
  detailFormId?: string
  formFlowOnly?: boolean
  formEditorView?: 'edit' | 'test' | 'publish'
}>()
const emit = defineEmits<{ formFlow: [view: 'edit' | 'flow' | 'test' | 'publish']; openForm: [formId: string]; savedForm: [formId: string]; closeForm: []; formCollectionLabel: [label: string] }>()
const section = computed(() => props.section ?? 'connection')
const formsVisited = ref(section.value === 'forms')
watch(section, (value) => {
  if (value === 'forms') formsVisited.value = true
  if (value === 'queue') {
    const agencyId = props.agencyId
    void loadManagement().catch(() => {
      if (agencyId === props.agencyId && managementRequest.state.value.kind === 'error') error.value = feedback('loadFailed')
    })
  }
})
watch(() => props.agencyId, () => {
  formsVisited.value = section.value === 'forms'
})
const { t, locale } = useExtensionI18n(messages)
watch(() => [props.detailFormId, t('formsAll')] as const, ([detailFormId, label]) => {
  if (detailFormId !== undefined) emit('formCollectionLabel', label)
}, { immediate: true })
const toast = useExtensionToast()
const toastDescription = (description: string | Feedback) => () => h('span',
  typeof description === 'string' ? description : t(description.key, description.values))
const showSuccess = (description: Feedback) => toast.add({
  title: () => h('span', t('successNotice')), description: toastDescription(description), color: 'success'
})
const showError = (description: string | Feedback) => toast.add({
  title: () => h('span', t('errorNotice')), description: toastDescription(description), color: 'error'
})
const api = useExtensionApi('gcs-ssc-portal-connector')
const hostApi = useHostApi()
const loadRequest = usePortalRequest()
const managementRequest = usePortalRequest()
const actionRequest = usePortalRequest()
const proponentRequest = usePortalRequest()
const receiptRequest = usePortalRequest()
const backlogRequest = usePortalRequest()
const connection: Ref<Connection | null> = ref(null)
const receipts: Ref<Receipt[]> = ref([])
type ReceiptDialog = { kind: 'closed' } | { kind: 'open'; receipt: Receipt; source: unknown }
const receiptDialog = ref<ReceiptDialog>({ kind: 'closed' })
const selectedReceipt = computed(() => receiptDialog.value.kind === 'open' ? receiptDialog.value.receipt : null)
const receiptSource = computed(() => receiptDialog.value.kind === 'open' ? receiptDialog.value.source : null)
const receiptEvidenceOpen = computed({
  get: () => receiptDialog.value.kind === 'open',
  set: (value: boolean) => { if (!value) { receiptRequest.invalidate(); receiptDialog.value = { kind: 'closed' } } }
})
const openReceipt = async (receipt: Receipt) => {
  const request = receiptRequest.begin()
  if (!request) return
  const path = `${endpoint.value}/receipts/${receipt.id}`
  try {
    const result = await api.get<{ receipt: { source_export: unknown } }>(path)
    if (!receiptRequest.isCurrent(request)) return
    receiptDialog.value = { kind: 'open', receipt, source: result.receipt.source_export }
    receiptRequest.succeed(request)
  } catch {
    if (!receiptRequest.fail(request)) return
    showError(feedback('loadFailed'))
  }
}
const receiptSearch = ref('')
const receiptPagination = ref({ pageIndex: 0, pageSize: 10 })
const receiptColumns = computed(() => [
  { id: 'submission', accessorKey: 'submission_id', header: t('submission') },
  { id: 'kind', accessorKey: 'kind', header: t('kind') },
  { id: 'record', accessorKey: 'gcs_entity_id', header: t('gcsRecord') },
  { id: 'state', accessorKey: 'state', header: t('organizationState') },
  { id: 'actions', header: t('actions') }
])
const filteredReceipts = computed(() => {
  const search = receiptSearch.value.trim().toLocaleLowerCase(locale.value)
  if (!search) return receipts.value
  return receipts.value.filter(item => [receiptKind(item.kind), item.submission_id, item.form_title?.[/^fr(?:-|$)/i.test(locale.value) ? 'fr' : 'en'], item.gcs_entity_id,
    queueState(item.state), new Date(item.created_at).toLocaleString(locale.value)]
    .some(value => value?.toLocaleLowerCase(locale.value).includes(search)))
})
const visibleReceipts = computed(() => filteredReceipts.value.slice(
  receiptPagination.value.pageIndex * receiptPagination.value.pageSize,
  (receiptPagination.value.pageIndex + 1) * receiptPagination.value.pageSize
))
watch(receiptSearch, () => { receiptPagination.value.pageIndex = 0 })
watch(() => filteredReceipts.value.length, length => {
  const lastPage = Math.max(0, Math.ceil(length / receiptPagination.value.pageSize) - 1)
  if (receiptPagination.value.pageIndex > lastPage) receiptPagination.value.pageIndex = lastPage
})
const organizations: Ref<PortalOrganization[]> = ref([])
const unverifiedOrganizations = computed(() => organizations.value.filter(item => !item.verified))
const organizationSearch = ref('')
const organizationPagination = ref({ pageIndex: 0, pageSize: 10 })
const organizationColumns = computed(() => [
  { id: 'organization', accessorKey: 'name', header: t('portalOrganization') },
  { id: 'owner', accessorKey: 'ownerName', header: t('organizationOwner') },
  { id: 'recipient', accessorKey: 'proponentId', header: t('gcsProponent') },
  { id: 'state', accessorKey: 'active', header: t('organizationState') },
  { id: 'actions', header: t('actions') }
])
const filteredOrganizations = computed(() => {
  const search = organizationSearch.value.trim().toLocaleLowerCase(locale.value)
  if (!search) return unverifiedOrganizations.value
  return unverifiedOrganizations.value.filter(item => [
    item.name, item.id, item.description, item.ownerName, item.ownerEmail,
    item.proponentId, item.note, item.active ? t('active') : t('inactive')
  ].some(value => value?.toLocaleLowerCase(locale.value).includes(search)))
})
const visibleOrganizations = computed(() => filteredOrganizations.value.slice(
  organizationPagination.value.pageIndex * organizationPagination.value.pageSize,
  (organizationPagination.value.pageIndex + 1) * organizationPagination.value.pageSize
))
watch(organizationSearch, () => { organizationPagination.value.pageIndex = 0 })
watch(() => filteredOrganizations.value.length, length => {
  const lastPage = Math.max(0, Math.ceil(length / organizationPagination.value.pageSize) - 1)
  if (organizationPagination.value.pageIndex > lastPage) organizationPagination.value.pageIndex = lastPage
})
const backlog: Ref<BacklogItem[]> = ref([])
const operations: Ref<PortalOperation[]> = ref([])
const backlogSearch = ref('')
const backlogPagination = ref({ pageIndex: 0, pageSize: 10 })
const backlogColumns = computed(() => [
  { id: 'agreement', accessorKey: 'agreementId', header: t('agreement') },
  { id: 'organization', accessorKey: 'organizationId', header: t('portalOrganization') },
  { id: 'state', accessorKey: 'state', header: t('organizationState') },
  { id: 'actions', header: t('actions') }
])
type BacklogDialog = { kind: 'closed' } | { kind: 'open'; item: BacklogItem }
const backlogDialog = ref<BacklogDialog>({ kind: 'closed' })
const selectedBacklog = computed({
  get: () => backlogDialog.value.kind === 'open' ? backlogDialog.value.item : null,
  set: (item: BacklogItem | null) => {
    backlogRequest.invalidate()
    backlogDialog.value = item ? { kind: 'open', item } : { kind: 'closed' }
  }
})
const backlogDetail: Ref<BacklogDetail | null> = ref(null)
const backlogDetailBusy = backlogRequest.pending
const backlogDetailError = computed(() => backlogRequest.state.value.kind === 'error')
const detailAgreement = computed(() => backlogDetail.value?.payload?.agreement ?? null)
const detailConfig = computed(() => detailAgreement.value?.config as Record<string, unknown> | undefined)
const detailBudgetLines = computed(() => Array.isArray(detailConfig.value?.budgetLines)
  ? detailConfig.value.budgetLines as Array<Record<string, unknown>> : [])
const detailFiscalYears = computed(() => Array.isArray(detailConfig.value?.fiscalYears)
  ? detailConfig.value.fiscalYears as Array<Record<string, unknown>> : [])
const detailText = (value: unknown): string => value === null || value === undefined || value === '' ? '—' : String(value)
const fiscalYearLabel = (id: unknown): string => detailText(
  detailFiscalYears.value.find(year => String(year.id) === String(id))?.startYear ?? id
)
const budgetAmountLabel = (line: Record<string, unknown>): string => {
  try { return formatMoneyText(parseMoney(line.budgetedAmount), locale.value) }
  catch { return '—' }
}

const openBacklogDetail = async (item: BacklogItem) => {
  selectedBacklog.value = item
  const request = backlogRequest.begin()
  if (!request) return
  backlogDetail.value = null
  const path = `${endpoint.value}/backlog/${item.id}`
  try {
    const detail = await api.get<BacklogDetail>(path)
    if (!backlogRequest.isCurrent(request)) return
    backlogDetail.value = detail
    backlogRequest.succeed(request)
  } catch { backlogRequest.fail(request) }
}
const filteredBacklog = computed(() => {
  const search = backlogSearch.value.trim().toLocaleLowerCase(locale.value)
  if (!search) return backlog.value
  return backlog.value.filter(item => [item.agreementId, item.organizationId, queueState(item.state), item.lastError]
    .some(value => value?.toLocaleLowerCase(locale.value).includes(search)))
})
const visibleBacklog = computed(() => filteredBacklog.value.slice(
  backlogPagination.value.pageIndex * backlogPagination.value.pageSize,
  (backlogPagination.value.pageIndex + 1) * backlogPagination.value.pageSize
))
watch(backlogSearch, () => { backlogPagination.value.pageIndex = 0 })
watch(() => filteredBacklog.value.length, length => {
  const lastPage = Math.max(0, Math.ceil(length / backlogPagination.value.pageSize) - 1)
  if (backlogPagination.value.pageIndex > lastPage) backlogPagination.value.pageIndex = lastPage
})
const inbound: Ref<InboundItem[]> = ref([])
const inboundSearch = ref('')
const inboundPagination = ref({ pageIndex: 0, pageSize: 10 })
const inboundColumns = computed(() => [
  { id: 'submission', accessorKey: 'submissionId', header: t('submission') },
  { id: 'kind', accessorKey: 'kind', header: t('kind') },
  { id: 'state', accessorKey: 'state', header: t('organizationState') }
])
const filteredInbound = computed(() => {
  const search = inboundSearch.value.trim().toLocaleLowerCase(locale.value)
  if (!search) return inbound.value
  return inbound.value.filter(item => [item.submissionId, receiptKind(item.kind), queueState(item.state), item.lastError ? diagnosticMessage(item.lastError) : null]
    .some(value => value?.toLocaleLowerCase(locale.value).includes(search)))
})
const visibleInbound = computed(() => filteredInbound.value.slice(
  inboundPagination.value.pageIndex * inboundPagination.value.pageSize,
  (inboundPagination.value.pageIndex + 1) * inboundPagination.value.pageSize
))
watch(inboundSearch, () => { inboundPagination.value.pageIndex = 0 })
watch(() => filteredInbound.value.length, length => {
  const lastPage = Math.max(0, Math.ceil(length / inboundPagination.value.pageSize) - 1)
  if (inboundPagination.value.pageIndex > lastPage) inboundPagination.value.pageIndex = lastPage
})
const outcomeBacklog: Ref<OutcomeBacklogItem[]> = ref([])
const outcomeSearch = ref('')
const outcomePagination = ref({ pageIndex: 0, pageSize: 10 })
const outcomeColumns = computed(() => [
  { id: 'submission', accessorKey: 'submissionId', header: t('submission') },
  { id: 'kind', accessorKey: 'kind', header: t('kind') },
  { id: 'state', accessorKey: 'state', header: t('organizationState') }
])
const filteredOutcomeBacklog = computed(() => {
  const search = outcomeSearch.value.trim().toLocaleLowerCase(locale.value)
  if (!search) return outcomeBacklog.value
  return outcomeBacklog.value.filter(item => [item.submissionId, receiptKind(item.kind), queueState(item.state), item.lastError ? diagnosticMessage(item.lastError) : null]
    .some(value => value?.toLocaleLowerCase(locale.value).includes(search)))
})
const visibleOutcomeBacklog = computed(() => filteredOutcomeBacklog.value.slice(
  outcomePagination.value.pageIndex * outcomePagination.value.pageSize,
  (outcomePagination.value.pageIndex + 1) * outcomePagination.value.pageSize
))
watch(outcomeSearch, () => { outcomePagination.value.pageIndex = 0 })
watch(() => filteredOutcomeBacklog.value.length, length => {
  const lastPage = Math.max(0, Math.ceil(length / outcomePagination.value.pageSize) - 1)
  if (outcomePagination.value.pageIndex > lastPage) outcomePagination.value.pageIndex = lastPage
})
const lastPullAt = ref<string | null>(null)
const lastPullError = ref<string | null>(null)
const statuses: Ref<PortalStatus[]> = ref([])
type StatusEntity = 'agreement' | 'claim' | 'forecast' | 'funding_application' | 'other_form'
type EntityStatusIds = Record<Exclude<StatusEntity, 'agreement'>, string[]>
interface SettingsDraft {
  portalStatusIds: string[]
  entityStatusIds: EntityStatusIds
  pullInterval: string
}
type SettingsEditor = { kind: 'unknown' } | { kind: 'accepted'; draft: SettingsDraft } | { kind: 'edited'; draft: SettingsDraft }
  | { kind: 'saving'; draft: SettingsDraft }
const emptySettingsDraft = (): SettingsDraft => ({
  portalStatusIds: [], entityStatusIds: { claim: [], forecast: [], funding_application: [], other_form: [] }, pullInterval: 'manual'
})
const settingsEditor: Ref<SettingsEditor> = ref({ kind: 'unknown' })
const settingsReady = computed(() => settingsEditor.value.kind !== 'unknown')
const selectedStatusIds = computed(() => settingsEditor.value.kind === 'unknown' ? [] : settingsEditor.value.draft.portalStatusIds)
const entityStatusIds = computed(() => settingsEditor.value.kind === 'unknown' ? emptySettingsDraft().entityStatusIds : settingsEditor.value.draft.entityStatusIds)
const statusEntity = ref<StatusEntity>('claim')
const visibleStatusIds = computed(() => statusEntity.value === 'agreement'
  ? selectedStatusIds.value : entityStatusIds.value[statusEntity.value])
const pullInterval = computed({
  get: () => settingsEditor.value.kind === 'unknown' ? '' : settingsEditor.value.draft.pullInterval,
  set: (value: string) => {
    if (settingsEditor.value.kind === 'unknown') return
    settingsEditor.value = { kind: 'edited', draft: { ...settingsEditor.value.draft, pullInterval: value } }
  }
})
const proponentVerificationAccess = ref('off')
watch(() => props.config, value => {
  const access = value?.portalProponentVerificationAccess
  proponentVerificationAccess.value = access === 'manager' || access === 'contributor' ? access : 'off'
}, { immediate: true })
type VerificationDialog = { kind: 'closed' } | { kind: 'open'; organizationId: string; proponentId: string; note: string }
const verificationDialog = ref<VerificationDialog>({ kind: 'closed' })
const selectedOrganizationId = computed(() => verificationDialog.value.kind === 'open' ? verificationDialog.value.organizationId : '')
const verificationNote = computed({
  get: () => verificationDialog.value.kind === 'open' ? verificationDialog.value.note : '',
  set: (value: string) => { if (verificationDialog.value.kind === 'open') verificationDialog.value.note = value }
})
const verificationConfirmOpen = computed({
  get: () => verificationDialog.value.kind === 'open',
  set: (value: boolean) => { if (!value) verificationDialog.value = { kind: 'closed' } }
})
const selectedOrganization = computed(() => organizations.value.find(item => item.id === selectedOrganizationId.value) ?? null)
const validOrganizationId = computed(() => selectedOrganization.value?.active === true && !selectedOrganization.value.verified)
const proponentSearch = ref('')
const proponents = ref<Array<{ id: string; egcs_ar_legalname_en: string; egcs_ar_legalname_fr: string }>>([])
const selectedProponentId = computed({
  get: () => verificationDialog.value.kind === 'open' ? verificationDialog.value.proponentId : '',
  set: (value: string) => { if (verificationDialog.value.kind === 'open') verificationDialog.value.proponentId = value }
})
const pushCount = ref('10')
const validPushCount = computed(() => Number.isInteger(Number(pushCount.value)) && pushCount.value.trim() !== ''
  && Number(pushCount.value) >= 1 && Number(pushCount.value) <= 100)
const form = ref({ portalUrl: '', portalAgencyId: '', portalKey: '' })
const portalKeyFormatValid = computed(() => /^gcs_[A-Za-z0-9_-]{43}$/.test(form.value.portalKey))
const busy = actionRequest.pending
const loading = computed(() => loadRequest.state.value.kind === 'idle' || loadRequest.pending.value)
const error = useLocalizedFeedback(t)
const pending = ref<Array<{ eventId: string; reason: string; code?: 'forecastPending' | 'documentationPending' | 'unsupportedPending'; submissionId?: string; organizationId?: string }>>([])
const receiptKind = (kind: string) => kind === 'claim' ? t('claimKind')
  : kind === 'forecast' ? t('forecastKind')
    : kind === 'funding_application' ? t('fundingApplicationKind')
      : kind === 'other_form' ? t('otherFormKind')
        : kind === 'organization_detail' ? t('documentationKind') : kind
const queueState = (state: string) => state === 'delivered' ? t('deliveredState')
  : state === 'cancelled' ? t('cancelledState')
  : state === 'leased' ? t('sendingState')
    : state === 'imported' ? t('imported')
      : state === 'received' ? t('received')
        : state === 'unsupported' ? t('unsupported') : t('queuedState')
const queueColor = (state: string) => state === 'delivered' || state === 'imported' || state === 'received' ? 'success'
  : state === 'leased' ? 'warning' : state === 'failed' ? 'error' : 'neutral'
const diagnosticMessage = (reason: string) => {
  const diagnostic = readImportDiagnostic(reason)
  return diagnostic ? t(diagnostic.code, diagnostic.params) : reason
}
const pendingMessage = (item: typeof pending.value[number]) => item.code
  ? t(item.code, { submission: item.submissionId ?? '', organization: item.organizationId ?? '' })
  : diagnosticMessage(item.reason)
const locked = computed(() => props.enabled === false || props.disabled === true || props.readOnly === true)
const connectionValidationError = () => {
  const { portalUrl, portalAgencyId, portalKey } = form.value
  let url: URL
  try { url = new URL(portalUrl) } catch { return feedback('portalUrlInvalid') }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return feedback('portalUrlInvalid')
  if (!/^G-[A-HJKMNP-Z2-9]{5,}$/.test(portalAgencyId)) return feedback('portalAgencyInvalid')
  if (!portalKey && !connection.value?.hasCredential) return feedback('portalKeyRequired')
  if (portalKey && !portalKeyFormatValid.value) return feedback('portalKeyInvalid')
  return null
}
const connectionFailure = (cause: unknown, fallback: 'saveFailed' | 'connectionTestFailed') => {
  if (cause instanceof FetchResponseError && cause.data && typeof cause.data === 'object' && 'data' in cause.data) {
    const data = cause.data.data
    if (data && typeof data === 'object' && 'code' in data
      && typeof data.code === 'string' && data.code.startsWith('GCS_PORTAL_')) {
      return cause.message
    }
  }
  return feedback(fallback)
}
const endpoint = computed(() => `/agencies/${props.agencyId}`)
const proponentOptions = computed(() => proponents.value.map(item => ({
  value: item.id,
  label: `${/^fr(?:-|$)/i.test(locale.value) ? item.egcs_ar_legalname_fr : item.egcs_ar_legalname_en} (#${item.id})`
})))
const loadManagement = async (parentIsCurrent: () => boolean = () => true) => {
  if (!parentIsCurrent()) return
  const request = managementRequest.begin()
  if (!request) return
  const path = endpoint.value
  const settingsSnapshot = settingsEditor.value
  try {
    const queue = await api.get<{ backlog: BacklogItem[]; operations: PortalOperation[]; outcomes: OutcomeBacklogItem[]; inbound: InboundItem[] }>(`${path}/backlog`)
    if (!managementRequest.isCurrent(request) || !parentIsCurrent()) return
    backlog.value = queue.backlog
    operations.value = queue.operations ?? []
    inbound.value = queue.inbound
    outcomeBacklog.value = queue.outcomes
    if (!connection.value) { managementRequest.succeed(request); return }
    const [orgs, settings] = await Promise.all([
      api.get<{ organizations: PortalOrganization[] }>(`${path}/organizations`),
      api.get<{ statuses: PortalStatus[]; settings: { portalStatusIds: string[]; entityStatusIds: typeof entityStatusIds.value; pullIntervalMinutes: number | null; lastPullAt: string | null; lastPullError: string | null } | null }>(`${path}/settings`)
    ])
    if (!managementRequest.isCurrent(request) || !parentIsCurrent()) return
    organizations.value = orgs.organizations
    statuses.value = settings.statuses
    if (settingsEditor.value === settingsSnapshot && (settingsSnapshot.kind === 'accepted' || settingsSnapshot.kind === 'unknown')) {
      settingsEditor.value = { kind: 'accepted', draft: {
        portalStatusIds: settings.settings?.portalStatusIds ?? [],
        entityStatusIds: settings.settings?.entityStatusIds ?? emptySettingsDraft().entityStatusIds,
        pullInterval: settings.settings?.pullIntervalMinutes?.toString() ?? 'manual'
      } }
    }
    lastPullAt.value = settings.settings?.lastPullAt ?? null
    lastPullError.value = settings.settings?.lastPullError ?? null
    managementRequest.succeed(request)
  } catch (cause) {
    if (managementRequest.fail(request) && parentIsCurrent()) throw cause
  }
}
const searchProponents = async () => {
  const request = proponentRequest.begin()
  if (!request) return
  try {
    const params = new URLSearchParams({ limit: '20',
      ...(proponentSearch.value.trim() ? { search: proponentSearch.value.trim() } : {}) })
    const result = await hostApi.get<{ items: typeof proponents.value }>(`/api/applicant-recipients?${params}`)
    if (!proponentRequest.isCurrent(request)) return
    proponents.value = result.items
    proponentRequest.succeed(request)
  } catch { if (proponentRequest.fail(request)) error.value = feedback('proponentSearchFailed') }
}
const verifyOrganization = async () => {
  if (locked.value || busy.value || !validOrganizationId.value || !selectedProponentId.value || !verificationNote.value.trim()) return
  const session = verificationDialog.value
  const request = actionRequest.begin()
  if (!request) return
  const path = endpoint.value
  const isCurrent = () => actionRequest.isCurrent(request)
  error.value = ''
  try {
    const result = await api.post<{ queued: number }>(`${path}/organizations`, {
      organizationId: selectedOrganizationId.value, proponentId: selectedProponentId.value,
      note: verificationNote.value.trim()
    })
    if (!isCurrent()) return
    if (verificationDialog.value === session) verificationDialog.value = { kind: 'closed' }
    await loadManagement(isCurrent)
    if (!isCurrent()) return
    showSuccess(feedback('verifiedQueued', { count: result.queued }))
  } catch { if (actionRequest.fail(request)) error.value = feedback('verifyFailed') }
  finally { actionRequest.succeed(request) }
}
const refreshOrganizationChoices = async () => {
  if (locked.value || busy.value || !connection.value) return
  const request = actionRequest.begin()
  if (!request) return
  const path = endpoint.value
  const isCurrent = () => actionRequest.isCurrent(request)
  error.value = ''
  try {
    await api.post(`${path}/organization-sync`)
    if (!isCurrent()) return
    await loadManagement(isCurrent)
    if (!isCurrent()) return
    showSuccess(feedback('organizationsSynced'))
  } catch { if (actionRequest.fail(request)) error.value = feedback('organizationSyncFailed') }
  finally { actionRequest.succeed(request) }
}
const saveProponentVerificationAccess = async () => {
  if (locked.value || busy.value) return
  const request = actionRequest.begin()
  if (!request) return
  const agencyId = props.agencyId
  const isCurrent = () => actionRequest.isCurrent(request)
  error.value = ''
  try {
    await hostApi.patch(`/api/extensions/agency/${agencyId}`, {
      extensionKey: 'gcs-ssc-portal-connector', enabled: true,
      config: { ...props.config, portalProponentVerificationAccess: proponentVerificationAccess.value }
    })
    if (!isCurrent()) return
    showSuccess(feedback('proponentVerificationSaved'))
  } catch { if (actionRequest.fail(request)) error.value = feedback('proponentVerificationSaveFailed') }
  finally { actionRequest.succeed(request) }
}
const openVerification = (item: PortalOrganization) => {
  if (locked.value || !item.active || item.verified) return
  verificationDialog.value = { kind: 'open', organizationId: item.id, proponentId: '', note: '' }
}
const initialSync = async () => {
  if (locked.value || busy.value) return
  const request = actionRequest.begin()
  if (!request) return
  const path = endpoint.value
  const isCurrent = () => actionRequest.isCurrent(request)
  error.value = ''
  try {
    const result = await api.post<{ queued: number }>(`${path}/initial-sync`)
    if (!isCurrent()) return
    await loadManagement(isCurrent)
    if (!isCurrent()) return
    showSuccess(feedback('initialQueued', { count: result.queued }))
  } catch { if (actionRequest.fail(request)) error.value = feedback('initialFailed') }
  finally { actionRequest.succeed(request) }
}
const pushBacklog = async () => {
  const limit = Number(pushCount.value)
  if (locked.value || busy.value || !validPushCount.value) return
  const request = actionRequest.begin()
  if (!request) return
  const path = endpoint.value
  const isCurrent = () => actionRequest.isCurrent(request)
  error.value = ''
  try {
    const result = await api.post<{ results: Array<{ delivered: boolean }> }>(`${path}/backlog`, { limit })
    if (!isCurrent()) return
    await loadManagement(isCurrent)
    if (!isCurrent()) return
    showSuccess(feedback('pushed', { count: result.results.filter(item => item.delivered).length,
      failed: result.results.filter(item => !item.delivered).length }))
  } catch { if (actionRequest.fail(request)) error.value = feedback('pushFailed') }
  finally { actionRequest.succeed(request) }
}
const pushAllBacklog = async () => {
  if (locked.value || busy.value) return
  const request = actionRequest.begin()
  if (!request) return
  const path = endpoint.value
  const isCurrent = () => actionRequest.isCurrent(request)
  error.value = ''
  try {
    const result = await api.post<{ queued: number; results: Array<{ delivered: boolean }> }>(`${path}/backlog`, { all: true })
    if (!isCurrent()) return
    await loadManagement(isCurrent)
    if (!isCurrent()) return
    showSuccess(feedback('allPushed', { queued: result.queued, delivered: result.results.filter(item => item.delivered).length }))
  } catch { if (actionRequest.fail(request)) error.value = feedback('pushFailed') }
  finally { actionRequest.succeed(request) }
}
const saveSettings = async () => {
  if (locked.value || busy.value || settingsEditor.value.kind === 'unknown') return
  const request = actionRequest.begin()
  if (!request) return
  const path = endpoint.value
  const isCurrent = () => actionRequest.isCurrent(request)
  error.value = ''
  settingsEditor.value = { kind: 'saving', draft: settingsEditor.value.draft }
  const snapshot = settingsEditor.value
  try {
    await api.put(`${path}/settings`, {
      portalStatusIds: snapshot.draft.portalStatusIds,
      entityStatusIds: snapshot.draft.entityStatusIds,
      pullIntervalMinutes: snapshot.draft.pullInterval === 'manual' ? null : Number(snapshot.draft.pullInterval)
    })
    if (!isCurrent()) return
    if (settingsEditor.value === snapshot) settingsEditor.value = { kind: 'accepted', draft: snapshot.draft }
    showSuccess(feedback('settingsSaved'))
  } catch {
    if (actionRequest.fail(request)) {
      if (settingsEditor.value === snapshot) settingsEditor.value = { kind: 'edited', draft: snapshot.draft }
      error.value = feedback('settingsFailed')
    }
  }
  finally { actionRequest.succeed(request) }
}
const toggleStatus = (id: string, enabled: boolean) => {
  if (settingsEditor.value.kind === 'unknown') return
  const next = enabled
    ? [...new Set([...visibleStatusIds.value, id])]
    : visibleStatusIds.value.filter(item => item !== id)
  const draft = settingsEditor.value.draft
  settingsEditor.value = { kind: 'edited', draft: statusEntity.value === 'agreement'
    ? { ...draft, portalStatusIds: next }
    : { ...draft, entityStatusIds: { ...draft.entityStatusIds, [statusEntity.value]: next } } }
}
const load = async () => {
  const request = loadRequest.begin()
  if (!request) return
  const isCurrent = () => loadRequest.isCurrent(request)
  const path = endpoint.value
  error.value = ''
  connection.value = null
  operations.value = []
  backlog.value = []
  outcomeBacklog.value = []
  inbound.value = []
  organizations.value = []
  try {
    const [summary, history] = await Promise.all([
      api.get<{ connection: Connection | null }>(`${path}/connection`),
      api.get<{ receipts: Receipt[] }>(`${path}/receipts`)
    ])
    if (!isCurrent()) return
    connection.value = summary.connection
    form.value = {
      portalUrl: summary.connection?.portalUrl ?? '',
      portalAgencyId: summary.connection?.portalAgencyId ?? '', portalKey: ''
    }
    receipts.value = history.receipts
    await loadManagement(isCurrent)
    if (isCurrent()) loadRequest.succeed(request)
  } catch {
    if (!loadRequest.fail(request)) return
    if (section.value === 'connection') showError(feedback('loadFailed'))
    else error.value = feedback('loadFailed')
  }
}
const save = async () => {
  if (locked.value || busy.value) return
  const validationError = connectionValidationError()
  if (validationError) { showError(validationError); return }
  const request = actionRequest.begin()
  if (!request) return
  const path = endpoint.value
  const isCurrent = () => actionRequest.isCurrent(request)
  error.value = ''
  try {
    const input = { portalUrl: form.value.portalUrl, portalAgencyId: form.value.portalAgencyId,
      ...(form.value.portalKey ? { portalKey: form.value.portalKey } : {}) }
    const result = await api.put<{ connection: Connection }>(`${path}/connection`, input)
    if (!isCurrent()) return
    connection.value = result.connection
    if (form.value.portalKey === input.portalKey) form.value.portalKey = ''
    showSuccess(feedback('connected'))
    try {
      await api.post(`${path}/organization-sync`)
      if (!isCurrent()) return
      await loadManagement(isCurrent)
    } catch { if (isCurrent()) showError(feedback('organizationSyncFailed')) }
  } catch (cause) { if (actionRequest.fail(request)) showError(connectionFailure(cause, 'saveFailed')) }
  finally { actionRequest.succeed(request) }
}
const test = async () => {
  if (locked.value || busy.value) return
  const validationError = connectionValidationError()
  if (validationError) { showError(validationError); return }
  const request = actionRequest.begin()
  if (!request) return
  const path = endpoint.value
  const isCurrent = () => actionRequest.isCurrent(request)
  error.value = ''
  try {
    await api.post(`${path}/connection-test`, {
      portalUrl: form.value.portalUrl,
      portalAgencyId: form.value.portalAgencyId,
      ...(form.value.portalKey ? { portalKey: form.value.portalKey } : {})
    })
    if (!isCurrent()) return
    showSuccess(feedback('connectionTestPassed'))
  } catch (cause) { if (actionRequest.fail(request)) showError(connectionFailure(cause, 'connectionTestFailed')) }
  finally { actionRequest.succeed(request) }
}
const sync = async () => {
  if (locked.value || busy.value || !connection.value) return
  const request = actionRequest.begin()
  if (!request) return
  const path = endpoint.value
  const isCurrent = () => actionRequest.isCurrent(request)
  error.value = ''
  try {
    const result = await api.post<{
      imported: Array<{ entityId: string }>
      pending: Array<{ eventId: string; reason: string }>
    }>(`${path}/sync`)
    if (!isCurrent()) return
    pending.value = result.pending
    showSuccess(feedback('syncDone', { count: result.imported.length, pending: result.pending.length }))
    try {
      const [history, deliveryBacklog] = await Promise.all([
        api.get<{ receipts: Receipt[] }>(`${path}/receipts`),
        api.get<{ backlog: BacklogItem[]; outcomes: OutcomeBacklogItem[]; inbound: InboundItem[] }>(`${path}/backlog`)
      ])
      if (!isCurrent()) return
      receipts.value = history.receipts
      inbound.value = deliveryBacklog.inbound
    } catch { if (isCurrent()) error.value = feedback('deliveryRefreshFailed') }
  } catch { if (actionRequest.fail(request)) error.value = feedback('syncFailed') }
  finally { actionRequest.succeed(request) }
}
onMounted(load)
watch(() => props.agencyId, () => {
  for (const owner of [loadRequest, managementRequest, actionRequest, proponentRequest, receiptRequest, backlogRequest]) owner.invalidate()
  receiptDialog.value = { kind: 'closed' }
  backlogDialog.value = { kind: 'closed' }
  verificationDialog.value = { kind: 'closed' }
  receipts.value = []
  proponents.value = []
  pending.value = []
  statuses.value = []
  settingsEditor.value = { kind: 'unknown' }
  lastPullAt.value = null
  lastPullError.value = null
  void load()
}, { flush: 'sync' })
onMounted(searchProponents)
watch(() => props.agencyId, searchProponents)
</script>

<template>
  <div class="space-y-8" data-field-scope="extension.gcs-ssc-portal-connector.portal-connection">
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
          <ExtensionSaveButton :label="t('saveConnection')" type="button" :disabled="locked || busy" :loading="busy" @click="save" />
          <ExtensionButton type="button" :disabled="locked || busy" :loading="busy" @click="test">{{ t('testConnection') }}</ExtensionButton>
        </div>
        <p class="text-sm text-muted">{{ t('saveConnectionHelp') }}</p>
        <ExtensionFormField :label="t('pullSchedule')" name="pullSchedule" :description="t('pullScheduleHelp')">
          <ExtensionSelect
            v-model="pullInterval" :items="[
              { value: 'manual', label: t('manualOnly') },
              { value: '1', label: t('everyScheduledCheck') },
              { value: '5', label: t('everyFiveMinutes') },
              { value: '15', label: t('everyFifteenMinutes') },
              { value: '30', label: t('everyThirtyMinutes') },
              { value: '60', label: t('everyHour') }
            ]" value-key="value" name="pullSchedule" :disabled="locked || busy || !connection || !settingsReady" />
        </ExtensionFormField>
        <ExtensionSaveButton :label="t('saveSettings')" :disabled="locked || busy || !connection || !settingsReady" :loading="busy" @click="saveSettings" />
        <p v-if="lastPullAt" class="text-sm text-muted">{{ t('lastPull') }} {{ new Date(lastPullAt).toLocaleString(locale) }}</p>
        <p v-if="lastPullError" class="text-sm text-error">{{ lastPullError }}</p>
      </template>
    </section>
    <section v-if="formsVisited" v-show="section === 'forms'" class="space-y-4">
      <ExtensionAlert v-if="readOnly" color="info" variant="soft" icon="i-lucide-lock-keyhole" :title="t('formsReadOnlyTitle')">
        <template #description>{{ t('formsReadOnlyHelp') }}</template>
      </ExtensionAlert>
      <ExtensionAlert v-if="!connection" color="info" variant="soft" icon="i-lucide-info" :title="t('formsAwaitConnection')" />
      <FormLibrary
        v-if="detailFormId === undefined" :agency-id="agencyId" :disabled="locked"
        @open="emit('openForm', $event)" />
      <FormCreator
        v-else :key="agencyId" :agency-id="agencyId" :disabled="locked"
        :selected-form-id="detailFormId" :flow-only="formFlowOnly" :initial-view="formEditorView" standalone @flow="emit('formFlow', $event)" @saved="emit('savedForm', $event)"
        @close="emit('closeForm')" />
    </section>
    <section v-if="section === 'intakes'" class="space-y-4">
      <p v-if="!connection" class="text-sm text-muted">{{ t('connectionRequired') }}</p>
      <IntakeWorkspace v-else :agency-id="agencyId" :disabled="locked" />
    </section>
    <section v-if="section === 'verification'" class="space-y-4">
      <div><h3 class="text-base font-semibold text-highlighted">{{ t('organizationLinks') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('organizationLinksHelp') }}</p></div>
      <ExtensionFormField :label="t('proponentVerificationAccess')" name="proponentVerificationAccess" :description="t('proponentVerificationAccessHelp')">
        <ExtensionSelect
          v-model="proponentVerificationAccess" :items="[
            { value: 'off', label: t('verificationOff') },
            { value: 'manager', label: t('verificationManagers') },
            { value: 'contributor', label: t('verificationContributorsAndManagers') }
          ]" value-key="value" name="proponentVerificationAccess" :disabled="locked || busy" />
      </ExtensionFormField>
      <div class="flex flex-wrap items-center gap-3">
        <ExtensionSaveButton :label="t('saveVerificationAccess')" :disabled="locked || busy" :loading="busy" @click="saveProponentVerificationAccess" />
        <ExtensionButton :disabled="locked || busy || !connection" :loading="busy" @click="refreshOrganizationChoices">{{ t('refreshOrganizations') }}</ExtensionButton>
      </div>
      <p v-if="!unverifiedOrganizations.length" class="text-sm text-muted">{{ t('noUnverifiedOrganizations') }}</p>
      <ExtensionResourceLayout
        v-else v-model:search="organizationSearch" v-model:pagination="organizationPagination"
        :data="visibleOrganizations" :columns="organizationColumns" :total-records="filteredOrganizations.length"
        :show-button="false" :show-column-toggle="false" :search-placeholder="t('searchOrganizations')">
        <template #organization-cell="{ row }">
          <strong>{{ row.original.name }}</strong><span class="block text-muted">{{ row.original.id }}</span>
          <span v-if="row.original.description" class="block">{{ row.original.description }}</span>
          <span class="block text-muted">{{ t('memberCount') }}: {{ row.original.memberCount }} · {{ t('agreementCount') }}: {{ row.original.agreementCount }}</span>
        </template>
        <template #owner-cell="{ row }">{{ row.original.ownerName }}<span class="block">{{ row.original.ownerEmail }}</span></template>
        <template #recipient-cell="{ row }"><span v-if="row.original.proponentId">#{{ row.original.proponentId }}<span v-if="row.original.note" class="block text-muted">{{ row.original.note }}</span></span><span v-else>—</span></template>
        <template #state-cell="{ row }">{{ row.original.active ? t('active') : t('inactive') }}<span v-if="row.original.verifiedAt" class="block text-muted">{{ new Date(row.original.verifiedAt).toLocaleDateString(locale) }}</span></template>
        <template #actions-cell="{ row }"><ExtensionButton v-if="row.original.active && !row.original.verified && !locked" :disabled="busy" @click="openVerification(row.original)">{{ t('verifyAction') }}</ExtensionButton></template>
        <template #empty>{{ t('noMatchingOrganizations') }}</template>
      </ExtensionResourceLayout>
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
        <ExtensionSelect
          v-model="statusEntity" :items="[
            { value: 'agreement', label: t('agreementKind') },
            { value: 'claim', label: t('claimKind') },
            { value: 'forecast', label: t('forecastKind') },
            { value: 'funding_application', label: t('fundingApplicationKind') },
            { value: 'other_form', label: t('otherFormKind') }
          ]" value-key="value" name="statusEntity" />
      </ExtensionFormField>
      <div class="grid gap-2 sm:grid-cols-2">
        <ExtensionCheckbox data-field-label-en="Visible statuses" data-field-label-fr="Statuts visibles" v-for="status in statuses" :key="status.id" :model-value="visibleStatusIds.includes(status.id)" :label="locale === 'fr' ? status.name_fr : status.name_en" :disabled="locked || busy || !connection || !settingsReady" data-ui-target="extension.gcs-ssc-portal-connector.portal-connection.visible-status-ids.includes-status.id" @update:model-value="toggleStatus(status.id, Boolean($event))" />
      </div>
      <ExtensionSaveButton :label="t('saveSettings')" :disabled="locked || busy || !connection || !settingsReady" :loading="busy" @click="saveSettings" />
    </section>
    <section v-if="section === 'delivery'" class="space-y-6">
      <IntakeImportSettings :agency-id="agencyId" :read-only="readOnly" :disabled="locked" />
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h3 class="text-lg font-semibold text-highlighted">{{ t('inboundBacklog') }}</h3>
          <p class="mt-1 text-sm text-muted">{{ t('inboundBacklogHelp') }}</p>
        </div>
        <ExtensionButton class="shrink-0 whitespace-nowrap" :disabled="locked || busy || !connection" :loading="busy" @click="sync">{{ t('sync') }}</ExtensionButton>
      </div>
      <p v-if="!connection" class="text-sm text-muted">{{ t('connectionRequired') }}</p>
      <ExtensionAlert v-if="pending.length" color="warning" variant="soft" icon="i-lucide-triangle-alert" :title="t('pending')">
        <template #description>
          <ul class="list-disc space-y-1 pl-5"><li v-for="item in pending" :key="item.eventId">{{ pendingMessage(item) }}</li></ul>
        </template>
      </ExtensionAlert>
      <p v-if="!inbound.length" class="text-sm text-muted">{{ t('emptyInbound') }}</p>
      <ExtensionResourceLayout
        v-else v-model:search="inboundSearch" v-model:pagination="inboundPagination"
        :data="visibleInbound" :columns="inboundColumns" :total-records="filteredInbound.length"
        :show-button="false" :show-column-toggle="false" :search-placeholder="t('searchInbound')">
        <template #submission-cell="{ row }"><span class="font-medium">{{ row.original.submissionId }}</span></template>
        <template #kind-cell="{ row }">{{ receiptKind(row.original.kind) }}</template>
        <template #state-cell="{ row }">
          <ExtensionBadge :color="queueColor(row.original.state)" variant="subtle">{{ queueState(row.original.state) }}</ExtensionBadge>
          <span v-if="row.original.lastError" class="mt-1 block text-sm text-error">{{ diagnosticMessage(row.original.lastError) }}</span>
        </template>
        <template #empty>{{ t('noMatchingInbound') }}</template>
      </ExtensionResourceLayout>
      <div class="space-y-4 border-t border-default pt-6">
        <h4 class="text-base font-semibold text-highlighted">{{ t('receipts') }}</h4>
        <p v-if="!receipts.length" class="text-sm text-muted">{{ t('none') }}</p>
        <ExtensionResourceLayout
          v-else v-model:search="receiptSearch" v-model:pagination="receiptPagination"
          :data="visibleReceipts" :columns="receiptColumns" :total-records="filteredReceipts.length"
          :show-button="false" :show-column-toggle="false" :search-placeholder="t('searchReceipts')">
          <template #submission-cell="{ row }"><span class="font-medium">{{ row.original.submission_id }}</span>
            <span v-if="row.original.form_title" class="block text-sm text-muted">{{ row.original.form_title[locale === 'fr' ? 'fr' : 'en'] }}</span></template>
          <template #kind-cell="{ row }"><span class="font-medium">{{ receiptKind(row.original.kind) }}</span></template>
          <template #record-cell="{ row }">{{ row.original.gcs_entity_id ? `#${row.original.gcs_entity_id}` : row.original.state === 'received' ? `portal-receipt:${row.original.id}` : '—' }}</template>
          <template #state-cell="{ row }">
            <ExtensionBadge :color="queueColor(row.original.state)" variant="subtle">{{ queueState(row.original.state) }}</ExtensionBadge>
            <time class="mt-1 block text-xs text-muted" :datetime="row.original.created_at">{{ new Date(row.original.created_at).toLocaleString(locale) }}</time>
          </template>
          <template #actions-cell="{ row }">
            <div class="flex justify-end"><ExtensionButton
              v-if="row.original.kind === 'other_form' || row.original.kind === 'funding_application'"
              icon="i-lucide-eye" color="neutral" variant="ghost" :aria-label="t('viewReceipt')"
              @click="openReceipt(row.original)" /></div>
          </template>
          <template #empty>{{ t('noMatchingReceipts') }}</template>
        </ExtensionResourceLayout>
      </div>
    </section>
    <ExtensionModal v-model:open="receiptEvidenceOpen" :title="t('receiptEvidence')" :description="t('receiptEvidenceDescription')" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body><div v-if="selectedReceipt" class="space-y-6">
        <p class="text-sm text-muted">{{ t('submission') }}: {{ selectedReceipt.submission_id }} · {{ t('portalOrganization') }}: {{ selectedReceipt.organization_id }}</p>
        <ReceiptEvidence :source="receiptSource" :agency-id="agencyId" :receipt-id="selectedReceipt.id" /></div></template>
    </ExtensionModal>
    <section v-if="section === 'queue'" class="space-y-6">
      <div>
        <h3 class="text-lg font-semibold text-highlighted">{{ t('portalOperations') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('portalOperationsHelp') }}</p>
        <p v-if="!operations.length" class="mt-3 text-sm text-muted">{{ t('emptyOperations') }}</p>
        <ul v-else class="mt-3 divide-y divide-default">
          <li v-for="operation in operations" :key="operation.id" class="flex flex-wrap items-start justify-between gap-3 py-2 text-sm">
            <span>{{ operation.kind === 'form' ? t('forms') : operation.target }}<span v-if="operation.kind === 'form'" class="block text-xs text-muted">{{ operation.target }}</span></span>
            <span><ExtensionBadge :color="queueColor(operation.state)" variant="subtle">{{ queueState(operation.state) }}</ExtensionBadge>
              <span v-if="operation.lastError" class="block text-error">{{ operation.lastError }}</span></span>
          </li>
        </ul>
      </div>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h3 class="text-lg font-semibold text-highlighted">{{ t('outboundBacklog') }}</h3>
          <p class="mt-1 text-sm text-muted">{{ t('outboundBacklogHelp') }}</p>
        </div>
        <ExtensionButton
          color="neutral" variant="outline" class="shrink-0 whitespace-nowrap"
          :disabled="locked || busy || !connection" :loading="busy" @click="initialSync">{{ t('initialSync') }}</ExtensionButton>
      </div>
      <div class="flex flex-wrap items-end gap-x-3 gap-y-4">
        <div class="shrink-0">
          <ExtensionFormField :label="t('pushCount')" name="pushCount" required>
            <ExtensionInput
              v-model="pushCount" class="w-28" name="pushCount" type="number" min="1" max="100" required :disabled="locked || busy || !connection"
              :aria-invalid="!validPushCount" :aria-describedby="!validPushCount ? 'push-count-error' : undefined" />
            <p v-if="!validPushCount" id="push-count-error" role="alert" class="text-sm text-error">{{ t('pushCountInvalid') }}</p>
          </ExtensionFormField>
        </div>
        <ExtensionButton class="shrink-0 whitespace-nowrap" :disabled="locked || busy || !connection || !validPushCount" :loading="busy" @click="pushBacklog">{{ t('pushBacklog') }}</ExtensionButton>
        <ExtensionButton
          color="neutral" variant="outline" class="shrink-0 whitespace-nowrap"
          :disabled="locked || busy || !connection" :loading="busy" @click="pushAllBacklog">{{ t('pushAll') }}</ExtensionButton>
      </div>
      <p v-if="!backlog.length" class="text-sm text-muted">{{ t('emptyBacklog') }}</p>
      <ExtensionResourceLayout
        v-else v-model:search="backlogSearch" v-model:pagination="backlogPagination"
        :data="visibleBacklog" :columns="backlogColumns" :total-records="filteredBacklog.length"
        :show-button="false" :show-column-toggle="false" :search-placeholder="t('searchBacklog')">
        <template #agreement-cell="{ row }"><span class="font-medium">#{{ row.original.agreementId }}</span></template>
        <template #organization-cell="{ row }">{{ row.original.organizationId }}</template>
        <template #state-cell="{ row }">
          <ExtensionBadge :color="queueColor(row.original.state)" variant="subtle">{{ queueState(row.original.state) }}</ExtensionBadge>
          <span class="mt-1 block text-xs text-muted">{{ t('attempts') }}: {{ row.original.attempts }}<template v-if="row.original.state !== 'delivered' && row.original.state !== 'cancelled'"> · {{ t('nextAttempt') }}: {{ new Date(row.original.nextAttemptAt).toLocaleString(locale) }}</template></span>
          <span v-if="row.original.lastError" class="mt-1 block text-sm text-error">{{ diagnosticMessage(row.original.lastError) }}</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end">
            <ExtensionButton
              icon="i-lucide-eye" color="neutral" variant="ghost"
              :aria-label="t('viewDeliveryDetails')" @click="openBacklogDetail(row.original)" />
          </div>
        </template>
        <template #empty>{{ t('noMatchingBacklog') }}</template>
      </ExtensionResourceLayout>
      <ExtensionModal
        :open="selectedBacklog !== null" :title="t('deliveryDetails')"
        :ui="{ content: 'sm:max-w-2xl' }" @update:open="(value: boolean) => { if (!value) selectedBacklog = null }">
        <template #body>
          <p v-if="backlogDetailBusy" role="status">{{ t('loading') }}</p>
          <div v-else-if="backlogDetailError" class="space-y-3">
            <p role="alert">{{ t('deliveryDetailsFailed') }}</p>
            <ExtensionButton color="neutral" variant="outline" @click="selectedBacklog && openBacklogDetail(selectedBacklog)">{{ t('retry') }}</ExtensionButton>
          </div>
          <div v-else-if="backlogDetail" class="space-y-5">
            <dl class="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt class="text-xs font-semibold uppercase text-muted">{{ t('agreement') }}</dt><dd>#{{ backlogDetail.agreementId }}</dd></div>
              <div><dt class="text-xs font-semibold uppercase text-muted">{{ t('portalOrganization') }}</dt><dd>{{ backlogDetail.organizationId }}</dd></div>
              <div><dt class="text-xs font-semibold uppercase text-muted">{{ t('organizationState') }}</dt><dd>{{ queueState(backlogDetail.state) }} · {{ t('attempts') }}: {{ backlogDetail.attempts }}</dd></div>
              <div><dt class="text-xs font-semibold uppercase text-muted">{{ t('deliveryTime') }}</dt><dd>{{ backlogDetail.deliveredAt ? new Date(backlogDetail.deliveredAt).toLocaleString(locale) : '—' }}</dd></div>
            </dl>
            <p v-if="backlogDetail.payload" class="text-sm text-muted">{{ t('recordedPayloadHelp') }}</p>
            <p v-else class="text-sm text-muted">{{ t('payloadUnavailable') }}</p>
            <template v-if="detailAgreement">
              <div class="border-t border-default pt-4">
                <h4 class="font-semibold text-highlighted">{{ t('portalAgreement') }}</h4>
                <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt class="text-xs font-semibold uppercase text-muted">{{ t('agreementNumber') }}</dt><dd>{{ detailText(detailAgreement.agreementNumber) }}</dd></div>
                  <div><dt class="text-xs font-semibold uppercase text-muted">{{ t('portalStream') }}</dt><dd>{{ detailText(detailAgreement.streamId) }}</dd></div>
                  <div><dt class="text-xs font-semibold uppercase text-muted">{{ t('englishName') }}</dt><dd>{{ detailText(detailAgreement.nameEn) }}</dd></div>
                  <div><dt class="text-xs font-semibold uppercase text-muted">{{ t('frenchName') }}</dt><dd>{{ detailText(detailAgreement.nameFr) }}</dd></div>
                </dl>
              </div>
              <div v-if="detailBudgetLines.length" class="border-t border-default pt-4">
                <h4 class="font-semibold text-highlighted">{{ t('budgetLines') }}</h4>
                <div class="mt-3 max-h-64 overflow-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="text-xs uppercase text-muted"><tr><th class="pb-2 pr-3">{{ t('budgetLine') }}</th><th class="pb-2 pr-3">{{ t('fiscalYear') }}</th><th class="pb-2 text-right">{{ t('budgetedAmount') }}</th></tr></thead>
                    <tbody><tr v-for="(line, index) in detailBudgetLines" :key="String(line.id ?? index)" class="border-t border-default">
                      <td class="py-2 pr-3">{{ detailText(locale === 'fr' ? line.nameFr : line.nameEn) }}</td>
                      <td class="py-2 pr-3">{{ fiscalYearLabel(line.fiscalYearId) }}</td>
                      <td class="py-2 text-right">{{ budgetAmountLabel(line) }}</td>
                    </tr></tbody>
                  </table>
                </div>
              </div>
              <details class="border-t border-default pt-4 text-sm">
                <summary class="cursor-pointer font-semibold">{{ t('fullPortalData') }}</summary>
                <pre class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(backlogDetail.payload, null, 2) }}</pre>
              </details>
            </template>
          </div>
        </template>
      </ExtensionModal>
      <div class="space-y-4 border-t border-default pt-6">
        <h4 class="text-base font-semibold text-highlighted">{{ t('outcomeBacklog') }}</h4>
        <p v-if="!outcomeBacklog.length" class="text-sm text-muted">{{ t('emptyOutcomeBacklog') }}</p>
        <ExtensionResourceLayout
          v-else v-model:search="outcomeSearch" v-model:pagination="outcomePagination"
          :data="visibleOutcomeBacklog" :columns="outcomeColumns" :total-records="filteredOutcomeBacklog.length"
          :show-button="false" :show-column-toggle="false" :search-placeholder="t('searchOutcomeBacklog')">
          <template #submission-cell="{ row }"><span class="font-medium">{{ row.original.submissionId }}</span></template>
          <template #kind-cell="{ row }">{{ receiptKind(row.original.kind) }}</template>
          <template #state-cell="{ row }">
            <ExtensionBadge :color="queueColor(row.original.state)" variant="subtle">{{ queueState(row.original.state) }}</ExtensionBadge>
            <span class="mt-1 block text-xs text-muted">{{ t('attempts') }}: {{ row.original.attempts }}</span>
            <span v-if="row.original.lastError" class="mt-1 block text-sm text-error">{{ diagnosticMessage(row.original.lastError) }}</span>
          </template>
          <template #empty>{{ t('noMatchingOutcomeBacklog') }}</template>
        </ExtensionResourceLayout>
      </div>
    </section>
    <p v-if="error && section !== 'connection'" role="alert" class="text-sm text-error">
      {{ error }}
      <ExtensionButton v-if="section === 'statuses'" color="neutral" variant="link" @click="load">
        {{ t('retry') }}
      </ExtensionButton>
    </p>
  </div>
</template>
