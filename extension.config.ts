import { defineGcsAuditOwnership, defineGcsExtension } from '@gcs-ssc/extensions'

export default defineGcsExtension({
  key: 'gcs-ssc-portal-connector',
  sdkVersion: '^0.3.3',
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
    'scheduled-agreement-import', 'extension-lifecycle-hooks'
  ],
  admin: { agency: { path: './components/PortalConnection.vue' } },
  nitroPlugin: './server/plugins/outbox.ts',
  auditOwnership: defineGcsAuditOwnership([
    { table: 'extensions.gcs_portal_connection', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_receipt', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_publication', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_identity', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_outbox', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_inbox', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } },
    { table: 'extensions.gcs_portal_outcome_outbox', owner: { kind: 'owner', owner: 'agency', column: 'agency_id' } }
  ]),
  migrations: [
    { path: './server/migrations/0001_portal_connector.ts' },
    { path: './server/migrations/0002_publication_history.ts' },
    { path: './server/migrations/0003_sync_queue.ts' },
    { path: './server/migrations/0004_status_and_pull_settings.ts' },
    { path: './server/migrations/0005_inbound_queue.ts' },
    { path: './server/migrations/0006_outcome_queue.ts' }
  ],
  serverHandlers: [
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
      rbac: { subject: 'agency', action: 'update', agency: { param: 'agencyId' } },
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
      route: '/agencies/[agencyId]/sync', method: 'post',
      rbac: { subject: 'agency', action: 'update', agency: { param: 'agencyId' } },
      path: './server/api/sync.post.ts'
    },
    {
      route: '/agencies/[agencyId]/backlog', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/backlog.get.ts'
    },
    {
      route: '/agencies/[agencyId]/organizations', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/organizations.get.ts'
    },
    {
      route: '/agencies/[agencyId]/organizations', method: 'post',
      rbac: { subject: 'agency', action: 'update', agency: { param: 'agencyId' } },
      path: './server/api/organizations.post.ts'
    },
    {
      route: '/agencies/[agencyId]/settings', method: 'get',
      rbac: { subject: 'agency', action: 'read', agency: { param: 'agencyId' } },
      path: './server/api/settings.get.ts'
    },
    {
      route: '/agencies/[agencyId]/settings', method: 'put',
      rbac: { subject: 'agency', action: 'update', agency: { param: 'agencyId' } },
      path: './server/api/settings.put.ts'
    },
    {
      route: '/agencies/[agencyId]/initial-sync', method: 'post',
      rbac: { subject: 'agency', action: 'update', agency: { param: 'agencyId' } },
      path: './server/api/initial-sync.post.ts'
    },
    {
      route: '/agencies/[agencyId]/backlog', method: 'post',
      rbac: { subject: 'agency', action: 'update', agency: { param: 'agencyId' } },
      path: './server/api/backlog.post.ts'
    },
    {
      route: '/agencies/[agencyId]/publish-agreement', method: 'post',
      rbac: { subject: 'agency', action: 'update', agency: { param: 'agencyId' } },
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
