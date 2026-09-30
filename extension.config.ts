import { defineGcsAuditOwnership, defineGcsExtension } from '@gcs-ssc/extensions'

export default defineGcsExtension({
  key: 'gcs-ssc-portal-connector',
  sdkVersion: '^0.3.4',
  name: { en: 'Organization portal', fr: 'Portail des organismes' },
  description: {
    en: 'Publishes funding data and receives organization submissions.',
    fr: 'Publie les données de financement et reçoit les soumissions des organismes.'
  },
  configurationScope: 'agency',
  configurationAccess: 'manager',
  requiredHostCapabilities: [
    'agency-only-configuration', 'configuration-access', 'server-handlers',
    'server-handler-rbac', 'migrations', 'extension-secrets', 'audit-ownership',
    'agency-config', 'extension-ui', 'extension-api-client', 'host-api-client',
    'scheduled-agreement-import', 'extension-lifecycle-hooks', 'agency-workspace', 'entity-tabs'
  ],
  admin: {
    agency: { path: './components/PortalConnection.vue' },
    agencyWorkspace: {
      label: { en: 'Portal', fr: 'Portail' }, icon: 'i-lucide-panel-left',
      tabs: [
        { id: 'connection', label: { en: 'Connection', fr: 'Connexion' }, icon: 'i-lucide-plug' },
        { id: 'verification', label: { en: 'Organization verification', fr: 'Vérification des organismes' }, icon: 'i-lucide-badge-check' },
        { id: 'statuses', label: { en: 'Statuses', fr: 'Statuts' }, icon: 'i-lucide-list-checks' },
        { id: 'queue', label: { en: 'Portal sync queue', fr: 'File de synchronisation' }, icon: 'i-lucide-list-ordered' },
        { id: 'delivery', label: { en: 'Portal delivery', fr: 'Livraison au portail' }, icon: 'i-lucide-truck' },
        { id: 'forms', label: { en: 'Forms', fr: 'Formulaires' }, icon: 'i-lucide-list' },
        { id: 'intakes', label: { en: 'Intakes', fr: 'Appels de demandes' }, icon: 'i-lucide-inbox' }
      ]
    }
  },
  client: {
    tabs: [{
      id: 'verification', target: 'proponent',
      agencyReadRequired: true,
      label: { en: 'Verification', fr: 'Vérification' }, icon: 'i-lucide-badge-check',
      rbac: { subject: 'applicant_recipient', action: 'read' },
      agencyConfigVisibility: { key: 'portalProponentVerificationAccess', values: ['manager', 'contributor'] },
      path: './components/ProponentVerification.vue'
    }, {
      id: 'portal-forms', target: 'opportunity',
      label: { en: 'Portal forms', fr: 'Formulaires du portail' }, icon: 'i-lucide-file-text',
      rbac: { subject: 'transfer_payment', action: 'read' },
      path: './components/OpportunityForms.vue'
    }]
  },
  nitroPlugin: './server/plugins/outbox.ts',
  auditOwnership: defineGcsAuditOwnership([
    { table: 'extensions.gcs_portal_connection', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_receipt', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_publication', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_identity', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_organization', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_verification', owner: { kind: 'global', reason: 'A verified Portal organization maps to one GCS Proponent across all agencies.' } },
    { table: 'extensions.gcs_portal_outbox', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_inbox', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_outcome_outbox', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_form', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_operation', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } }
  ]),
  migrations: [
    { path: './server/migrations/0001_portal_connector.ts' },
    { path: './server/migrations/0002_publication_history.ts' },
    { path: './server/migrations/0003_sync_queue.ts' },
    { path: './server/migrations/0004_status_and_pull_settings.ts' },
    { path: './server/migrations/0005_inbound_queue.ts' },
    { path: './server/migrations/0006_outcome_queue.ts' },
    { path: './server/migrations/0007_organization_verification.ts' },
    { path: './server/migrations/0008_entity_status_settings.ts' },
    { path: './server/migrations/0009_delivery_payload.ts' },
    { path: './server/migrations/0010_portal_operations.ts' },
    { path: './server/migrations/0011_terminal_call_conflicts.ts' }
  ],
  serverHandlers: [
    {
      route: '/agencies/[agencyId]/form-options', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/form-options.get.ts'
    },
    {
      route: '/agencies/[agencyId]/form-options/[streamId]', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/form-stream-options.get.ts'
    },
    {
      route: '/agencies/[agencyId]/intakes', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/intakes.get.ts'
    },
    {
      route: '/agencies/[agencyId]/opportunities/[opportunityId]', method: 'post',
      rbac: { subject: 'transfer_payment', action: 'update', entity: { target: 'opportunity', param: 'opportunityId' } },
      path: './server/api/opportunities.post.ts'
    },
    {
      route: '/agencies/[agencyId]/opportunities/[opportunityId]/forms', method: 'get',
      rbac: { subject: 'transfer_payment', action: 'read', entity: { target: 'opportunity', param: 'opportunityId' } },
      path: './server/api/opportunity-forms.get.ts'
    },
    {
      route: '/agencies/[agencyId]/opportunities/[opportunityId]/forms/[formId]', method: 'get',
      rbac: { subject: 'transfer_payment', action: 'read', entity: { target: 'opportunity', param: 'opportunityId' } },
      path: './server/api/opportunity-form.get.ts'
    },
    {
      route: '/agencies/[agencyId]/intakes', method: 'post',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/intakes.post.ts'
    },
    {
      route: '/agencies/[agencyId]/forms', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/forms.get.ts'
    },
    {
      route: '/agencies/[agencyId]/forms/[formId]', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/form.get.ts'
    },
    {
      route: '/agencies/[agencyId]/forms', method: 'post',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/forms.post.ts'
    },
    {
      route: '/agencies/[agencyId]/connection', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/connection.get.ts'
    },
    {
      route: '/agencies/[agencyId]/connection', method: 'put',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/connection.put.ts'
    },
    {
      route: '/agencies/[agencyId]/connection-test', method: 'post',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/connection-test.post.ts'
    },
    {
      route: '/agencies/[agencyId]/sync', method: 'post',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/sync.post.ts'
    },
    {
      route: '/agencies/[agencyId]/backlog', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/backlog.get.ts'
    },
    {
      route: '/agencies/[agencyId]/backlog/[itemId]', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/backlog-item.get.ts'
    },
    {
      route: '/agencies/[agencyId]/organizations', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/organizations.get.ts'
    },
    {
      route: '/agencies/[agencyId]/organizations', method: 'post',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/organizations.post.ts'
    },
    {
      route: '/agencies/[agencyId]/proponents/[proponentId]/verification', method: 'get',
      rbac: { subject: 'applicant_recipient', action: 'read', entity: { target: 'proponent', param: 'proponentId' } },
      path: './server/api/proponent-verification.get.ts'
    },
    {
      route: '/agencies/[agencyId]/proponents/[proponentId]/verification', method: 'post',
      rbac: { subject: 'applicant_recipient', action: 'update', entity: { target: 'proponent', param: 'proponentId' } },
      path: './server/api/proponent-verification.post.ts'
    },
    {
      route: '/agencies/[agencyId]/organization-sync', method: 'post',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/organization-sync.post.ts'
    },
    {
      route: '/agencies/[agencyId]/settings', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/settings.get.ts'
    },
    {
      route: '/agencies/[agencyId]/settings', method: 'put',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/settings.put.ts'
    },
    {
      route: '/agencies/[agencyId]/initial-sync', method: 'post',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/initial-sync.post.ts'
    },
    {
      route: '/agencies/[agencyId]/backlog', method: 'post',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/backlog.post.ts'
    },
    {
      route: '/agencies/[agencyId]/publish-agreement', method: 'post',
      rbac: { subject: 'agency', action: 'delete', agency: { param: 'agencyId' } },
      path: './server/api/publish-agreement.post.ts'
    },
    {
      route: '/agencies/[agencyId]/receipts', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/receipts.get.ts'
    },
    {
      route: '/agencies/[agencyId]/agreements/[agreementId]/publications', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/publications.get.ts'
    }
  ]
})
