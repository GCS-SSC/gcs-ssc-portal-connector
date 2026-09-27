<script setup lang="ts">
import { computed, onMounted, ref, watch, type Ref } from 'vue'
import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions'
import {
  ExtensionButton, ExtensionFormField, ExtensionModal, ExtensionTextarea,
  useExtensionApi, useExtensionI18n, useHostApi
} from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'

interface Organization {
  id: string; name: string; description: string; ownerName: string; ownerEmail: string
  memberCount: number; agreementCount: number; active: boolean; verified: boolean
  proponentId: string | null; note: string | null; verifiedAt: string | null
}
const props = defineProps<{
  context?: ExtensionEntityTabContext
  agencyId?: string
  applicantRecipientId?: string
}>()
const { t, locale } = useExtensionI18n(messages)
const api = useExtensionApi('gcs-ssc-portal-connector')
const hostApi = useHostApi()
const agencyId = computed(() => props.context?.agencyId ?? props.agencyId ?? '')
const proponentId = computed(() => props.context?.applicantRecipientId ?? props.applicantRecipientId ?? '')
const organizations: Ref<Organization[]> = ref([])
const selected: Ref<Organization | null> = ref(null)
const note = ref('')
const open = ref(false)
const busy = ref(false)
const loading = ref(true)
const canLink = ref(false)
const message = ref('')
const error = ref('')
const history = computed(() => organizations.value.filter(item => item.proponentId === proponentId.value))
const choices = computed(() => organizations.value.filter(item => item.active && !item.verified))

const load = async () => {
  if (!agencyId.value || !proponentId.value) return
  loading.value = true; error.value = ''
  try {
    const [organizationResult, registry, proponent] = await Promise.all([
      api.get<{ organizations: Organization[] }>(`/agencies/${agencyId.value}/organizations`),
      hostApi.get<{ items: Array<{ extension: { key: string }; config: Record<string, unknown>; canConfigure: boolean }> }>(`/api/extensions/agency/${agencyId.value}`),
      hostApi.get<{ can_update?: boolean }>(`/api/applicant-recipients/${proponentId.value}`)
    ])
    organizations.value = organizationResult.organizations
    const item = registry.items.find(entry => entry.extension.key === 'gcs-ssc-portal-connector')
    const setting = item?.config.portalProponentVerificationAccess
    canLink.value = proponent.can_update === true && (setting === 'contributor'
      || setting === 'manager' && item?.canConfigure === true)
  } catch { error.value = t('loadFailed') }
  finally { loading.value = false }
}
const select = (item: Organization) => {
  if (!canLink.value || !item.active || item.verified) return
  selected.value = item; note.value = ''; open.value = true
}
const verify = async () => {
  if (!canLink.value || !selected.value || !note.value.trim() || busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api.post(`/agencies/${agencyId.value}/proponents/${proponentId.value}/verification`, {
      organizationId: selected.value.id, proponentId: proponentId.value, note: note.value.trim()
    })
    open.value = false; selected.value = null; note.value = ''
    message.value = t('proponentVerified')
    await load()
  } catch { error.value = t('verifyFailed') }
  finally { busy.value = false }
}
onMounted(load)
watch(() => [agencyId.value, proponentId.value], load)
</script>

<template>
  <div class="space-y-5">
    <p v-if="loading" role="status">{{ t('loading') }}</p>
    <template v-else>
      <p class="text-sm text-muted">{{ t('verificationIrreversible') }}</p>
      <h3 class="text-base font-semibold">{{ t('verifiedLinks') }}</h3>
      <p v-if="!history.length" class="text-sm text-muted">{{ t('noVerifiedLinks') }}</p>
      <div v-else class="overflow-x-auto"><table class="w-full text-left text-sm">
        <thead><tr class="border-b border-default"><th scope="col" class="p-2">{{ t('portalOrganization') }}</th><th scope="col" class="p-2">{{ t('organizationOwner') }}</th><th scope="col" class="p-2">{{ t('organizationState') }}</th><th scope="col" class="p-2">{{ t('verificationNote') }}</th></tr></thead>
        <tbody><tr v-for="item in history" :key="item.id" class="border-b border-default"><td class="p-2">{{ item.name }} · {{ item.id }}</td><td class="p-2">{{ item.ownerName }}<span class="block">{{ item.ownerEmail }}</span></td><td class="p-2">{{ item.active ? t('active') : t('inactive') }}</td><td class="p-2">{{ item.note || '—' }}</td></tr></tbody>
      </table></div>
      <template v-if="canLink">
        <h3 class="text-base font-semibold">{{ t('availableOrganizations') }}</h3>
        <p v-if="!choices.length" class="text-sm text-muted">{{ t('noOrganizations') }}</p>
        <div v-else class="overflow-x-auto"><table class="w-full text-left text-sm">
          <thead><tr class="border-b border-default"><th scope="col" class="p-2">{{ t('portalOrganization') }}</th><th scope="col" class="p-2">{{ t('organizationOwner') }}</th><th scope="col" class="p-2">{{ t('actions') }}</th></tr></thead>
          <tbody><tr v-for="item in choices" :key="item.id" class="border-b border-default"><td class="p-2">{{ item.name }} · {{ item.id }}<span v-if="item.description" class="block text-muted">{{ item.description }}</span></td><td class="p-2">{{ item.ownerName }}<span class="block">{{ item.ownerEmail }}</span></td><td class="p-2"><ExtensionButton @click="select(item)">{{ t('verifyOrganization') }}</ExtensionButton></td></tr></tbody>
        </table></div>
      </template>
    </template>
    <ExtensionModal v-model:open="open" :title="t('verifyOrganization')" :description="t('verificationIrreversible')">
      <template #body><div class="space-y-4">
        <p v-if="selected"><strong>{{ selected.name }}</strong> · {{ selected.id }}<span v-if="selected.description" class="block">{{ selected.description }}</span><span class="block">{{ selected.ownerName }} · {{ selected.ownerEmail }}</span></p>
        <ExtensionFormField :label="t('verificationNote')" name="note" required>
          <ExtensionTextarea v-model="note" name="note" required :maxlength="4000" :disabled="busy" />
        </ExtensionFormField>
        <ExtensionButton :disabled="busy || !note.trim()" :loading="busy" @click="verify">{{ t('confirmVerification') }}</ExtensionButton>
      </div></template>
    </ExtensionModal>
    <p v-if="message" role="status" class="text-sm text-success">{{ message }}</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </div>
</template>
