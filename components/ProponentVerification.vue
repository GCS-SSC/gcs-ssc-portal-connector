<script setup lang="ts">
import { computed, onMounted, ref, watch, type Ref } from 'vue'
import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions'
import {
  ExtensionBadge, ExtensionButton, ExtensionFormField, ExtensionInput, ExtensionModal,
  ExtensionResourceLayoutCard, ExtensionTextarea, useExtensionApi, useExtensionI18n,
  useExtensionToast, useHostApi
} from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'

interface Organization {
  id: string; name: string; description: string; ownerName: string; ownerEmail: string
  memberCount: number; agreementCount: number; active: boolean; verified: boolean
  sourceAgencyId: string; sourceAgencyNameEn: string; sourceAgencyNameFr: string; canLink: boolean
}
interface Verification {
  organizationId: string; organizationName: string; originAgencyId: string
  note: string | null; verifiedAt: string; active: boolean
  verifierName: string | null; verifierEmail: string | null
}
const props = defineProps<{ context: Extract<ExtensionEntityTabContext, { target: 'proponent' }> }>()
const { t, locale } = useExtensionI18n(messages)
const api = useExtensionApi('gcs-ssc-portal-connector')
const hostApi = useHostApi()
const toast = useExtensionToast()
const agencies = computed(() => props.context.agencies)
const proponentId = computed(() => props.context.applicantRecipientId)
const organizations: Ref<Organization[]> = ref([])
const verifications: Ref<Verification[]> = ref([])
const currentVerification = computed(() => verifications.value.find(item => item.active))
const choices = computed(() => organizations.value.filter(item => item.canLink && item.active && !item.verified))
const searchQuery = ref('')
const searchedTerm: Ref<string | null> = ref(null)
const pagination = ref({ pageIndex: 0, pageSize: 10 })
const columns = computed(() => [
  { id: 'organization', accessorKey: 'name', header: t('portalOrganization') },
  { id: 'owner', accessorKey: 'ownerName', header: t('organizationOwner') },
  { id: 'actions', header: t('actions') }
])
const searchResults = computed(() => {
  if (searchedTerm.value === null) return []
  const term = searchedTerm.value.toLocaleLowerCase(locale.value)
  return choices.value.filter(item => [item.name, item.id, item.description, item.ownerName,
    item.ownerEmail, item.sourceAgencyNameEn, item.sourceAgencyNameFr]
    .some(value => value.toLocaleLowerCase(locale.value).includes(term)))
})
const visibleResults = computed(() => searchResults.value.slice(
  pagination.value.pageIndex * pagination.value.pageSize,
  (pagination.value.pageIndex + 1) * pagination.value.pageSize
))
const selected: Ref<Organization | null> = ref(null)
const note = ref('')
const open = ref(false)
const busy = ref(false)
const loading = ref(true)
const canLink = ref(false)
const error = ref('')
const agencyName = (id: string) => {
  const agency = agencies.value.find(item => item.agencyId === id)
  return agency ? locale.value === 'fr' ? agency.nameFr : agency.nameEn : null
}
const search = () => {
  const term = searchQuery.value.trim()
  if (!term) return
  searchedTerm.value = term
  pagination.value.pageIndex = 0
}
watch(searchQuery, () => { searchedTerm.value = null; pagination.value.pageIndex = 0 })
watch(() => searchResults.value.length, length => {
  const lastPage = Math.max(0, Math.ceil(length / pagination.value.pageSize) - 1)
  if (pagination.value.pageIndex > lastPage) pagination.value.pageIndex = lastPage
})

const load = async () => {
  loading.value = true; error.value = ''; canLink.value = false
  organizations.value = []; verifications.value = []; searchedTerm.value = null
  if (!agencies.value.length || !proponentId.value) {
    error.value = t('proponentVerificationLoadFailed'); loading.value = false; return
  }
  try {
    const firstAgencyId = agencies.value[0]!.agencyId
    verifications.value = (await api.get<{ verifications: Verification[] }>(
      `/agencies/${firstAgencyId}/proponents/${proponentId.value}/verification`
    )).verifications
    if (currentVerification.value) return
    const proponent = await hostApi.get<{ can_update?: boolean }>(`/api/applicant-recipients/${proponentId.value}`)
    const results = await Promise.allSettled(agencies.value.map(async agency => {
      const [organizationResult, registry] = await Promise.all([
        api.get<{ organizations: Organization[] }>(`/agencies/${agency.agencyId}/organizations`),
        hostApi.get<{ items: Array<{ extension: { key: string }; config: Record<string, unknown>; canConfigure: boolean }> }>(
          `/api/extensions/agency/${agency.agencyId}`)
      ])
      const item = registry.items.find(entry => entry.extension.key === 'gcs-ssc-portal-connector')
      const setting = item?.config.portalProponentVerificationAccess
      const canLinkAgency = proponent.can_update === true && (setting === 'contributor'
        || setting === 'manager' && item?.canConfigure === true)
      if (canLinkAgency) canLink.value = true
      return organizationResult.organizations.map(organization => ({
        ...organization,
        sourceAgencyId: agency.agencyId,
        sourceAgencyNameEn: agency.nameEn,
        sourceAgencyNameFr: agency.nameFr,
        canLink: canLinkAgency
      }))
    }))
    const successful = results.filter((result): result is PromiseFulfilledResult<Organization[]> => result.status === 'fulfilled')
    if (successful.length === 0) throw new Error('No agency organizations could be loaded.')
    const byId = new Map<string, Organization>()
    for (const organization of successful.flatMap(result => result.value)) {
      const previous = byId.get(organization.id)
      if (!previous || !previous.canLink && organization.canLink) byId.set(organization.id, organization)
    }
    organizations.value = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, locale.value))
  } catch { error.value = t('proponentVerificationLoadFailed') }
  finally { loading.value = false }
}
const select = (item: Organization) => {
  if (!item.canLink || !item.active || item.verified) return
  selected.value = item; note.value = ''; open.value = true
}
const verify = async () => {
  if (!selected.value?.canLink || !note.value.trim() || busy.value) return
  busy.value = true; error.value = ''
  try {
    await api.post(`/agencies/${selected.value.sourceAgencyId}/proponents/${proponentId.value}/verification`, {
      organizationId: selected.value.id, proponentId: proponentId.value, note: note.value.trim()
    })
    open.value = false; selected.value = null; note.value = ''
    toast.add({ title: t('successNotice'), description: t('proponentVerified'), color: 'success' })
    await load()
  } catch { toast.add({ title: t('errorNotice'), description: t('verifyFailed'), color: 'error' }) }
  finally { busy.value = false }
}
onMounted(load)
watch(() => [agencies.value, proponentId.value], load)
</script>

<template>
  <div class="space-y-8">
    <p v-if="loading" role="status" class="text-sm text-muted">{{ t('loading') }}</p>
    <template v-else>
      <section v-if="verifications.length" class="space-y-6">
        <div v-for="record in verifications" :key="record.organizationId" class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="text-base font-semibold text-highlighted">{{ record.active ? t('currentVerification') : t('previousVerification') }}</h3>
            <ExtensionBadge :color="record.active ? 'success' : 'neutral'" variant="subtle">{{ record.active ? t('verified') : t('inactive') }}</ExtensionBadge>
          </div>
          <div class="border-y border-default py-5">
            <p class="font-semibold text-highlighted">{{ record.organizationName }}</p>
            <p class="mt-1 text-sm text-muted">{{ record.organizationId }}<template v-if="agencyName(record.originAgencyId)"> · {{ agencyName(record.originAgencyId) }}</template></p>
            <dl class="mt-5 grid gap-4 sm:grid-cols-2">
              <div><dt class="text-xs font-semibold uppercase tracking-wide text-muted">{{ t('verifiedBy') }}</dt><dd class="mt-1 text-sm text-highlighted">{{ record.verifierName || t('verifierNotRecorded') }}<span v-if="record.verifierEmail" class="block text-muted">{{ record.verifierEmail }}</span></dd></div>
              <div><dt class="text-xs font-semibold uppercase tracking-wide text-muted">{{ t('verifiedOn') }}</dt><dd class="mt-1 text-sm text-highlighted"><time :datetime="record.verifiedAt">{{ new Date(record.verifiedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) }}</time></dd></div>
            </dl>
            <div class="mt-5"><p class="text-xs font-semibold uppercase tracking-wide text-muted">{{ t('verificationNoteRecorded') }}</p><p class="mt-1 whitespace-pre-wrap text-sm text-highlighted">{{ record.note || t('noteNotRecorded') }}</p></div>
          </div>
        </div>
      </section>
      <section v-if="!currentVerification && canLink" class="space-y-4">
        <div>
          <h3 class="text-base font-semibold text-highlighted">{{ t('findPortalOrganization') }}</h3>
          <p class="mt-1 text-sm text-muted">{{ t('findPortalOrganizationHelp') }}</p>
        </div>
        <p v-if="!choices.length" class="text-sm text-muted">{{ t('noAvailableOrganizations') }}</p>
        <template v-else>
          <ExtensionFormField :label="t('searchOrganizations')" name="organizationSearch">
            <div class="flex max-w-2xl flex-wrap items-center gap-3">
              <ExtensionInput v-model="searchQuery" name="organizationSearch" class="min-w-56 flex-1" :placeholder="t('organizationSearchPlaceholder')" @keydown.enter.prevent="search" />
              <ExtensionButton class="shrink-0" :disabled="!searchQuery.trim()" @click="search">{{ t('search') }}</ExtensionButton>
            </div>
          </ExtensionFormField>
          <p v-if="searchedTerm !== null && !searchResults.length" role="status" class="text-sm text-muted">{{ t('noMatchingOrganizations') }}</p>
          <ExtensionResourceLayoutCard v-if="searchedTerm !== null && searchResults.length"
            v-model:pagination="pagination" :data="visibleResults" :columns="columns"
            :total-records="searchResults.length" :show-toolbar="false" :show-button="false" :show-column-toggle="false">
            <template #organization-cell="{ row }">
              <span class="font-medium text-highlighted">{{ row.original.name }}</span>
              <span class="block text-sm text-muted">{{ row.original.id }} · {{ locale === 'fr' ? row.original.sourceAgencyNameFr : row.original.sourceAgencyNameEn }}</span>
              <span v-if="row.original.description" class="block text-sm text-muted">{{ row.original.description }}</span>
            </template>
            <template #owner-cell="{ row }">{{ row.original.ownerName }}<span class="block text-sm text-muted">{{ row.original.ownerEmail }}</span></template>
            <template #actions-cell="{ row }"><ExtensionButton size="sm" @click="select(row.original)">{{ t('verifyAction') }}</ExtensionButton></template>
          </ExtensionResourceLayoutCard>
        </template>
      </section>
      <div v-if="!currentVerification && !canLink && !error" class="space-y-2 text-sm text-muted">
        <p v-if="!verifications.length">{{ t('noVerifiedLinks') }}</p>
        <p>{{ t('verificationUnavailable') }}</p>
      </div>
    </template>
    <ExtensionModal v-model:open="open" :title="t('verifyOrganization')" :description="t('verificationIrreversible')">
      <template #body><div class="space-y-4">
        <p v-if="selected"><strong>{{ selected.name }}</strong> · {{ selected.id }}<span class="block text-sm text-muted">{{ locale === 'fr' ? selected.sourceAgencyNameFr : selected.sourceAgencyNameEn }}</span><span v-if="selected.description" class="block text-sm text-muted">{{ selected.description }}</span><span class="block text-sm text-muted">{{ selected.ownerName }} · {{ selected.ownerEmail }}</span></p>
        <ExtensionFormField :label="t('verificationNote')" name="note" required>
          <ExtensionTextarea v-model="note" name="note" required :maxlength="4000" :disabled="busy" />
        </ExtensionFormField>
        <ExtensionButton :disabled="busy || !note.trim()" :loading="busy" @click="verify">{{ t('confirmVerification') }}</ExtensionButton>
      </div></template>
    </ExtensionModal>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </div>
</template>
