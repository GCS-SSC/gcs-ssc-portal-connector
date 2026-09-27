import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import extension from '../extension.config.ts'

const connectorRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const hostRoot = [resolve(connectorRoot, '../gcs-ssc'), resolve(connectorRoot, '../..')]
  .find(candidate => existsSync(resolve(candidate, 'tooling/gcs-ssc/tests/fixtures/extension-audit-contract.ts')))
if (!hostRoot) throw new Error('Portal audit tests require the GCS-SSC host and private tooling checkout.')

const fixture = await import(pathToFileURL(resolve(hostRoot, 'tooling/gcs-ssc/tests/fixtures/extension-audit-contract.ts')).href)

// These expected audiences are authored independently of extension.config.ts.
const concreteRows = [
  { table: 'extensions.gcs_portal_connection', row: { id: '1001', agency_id: '11' }, agencies: ['11'] },
  { table: 'extensions.gcs_portal_receipt', row: { id: '1002', agency_id: '22' }, agencies: ['22'] },
  { table: 'extensions.gcs_portal_publication', row: { id: '1003', agency_id: '11' }, agencies: ['11'] },
  { table: 'extensions.gcs_portal_identity', row: { id: '1004', agency_id: '22' }, agencies: ['22'] },
  { table: 'extensions.gcs_portal_organization', row: { id: '1008', agency_id: '11', portal_organization_id: 'N-ABCDE' }, agencies: ['11'] },
  { table: 'extensions.gcs_portal_verification', row: { id: '1009', portal_organization_id: 'N-ABCDE', proponent_id: '44' }, agencies: [] },
  { table: 'extensions.gcs_portal_outbox', row: { id: '1005', agency_id: '11' }, agencies: ['11'] },
  { table: 'extensions.gcs_portal_inbox', row: { id: '1006', agency_id: '22' }, agencies: ['22'] },
  { table: 'extensions.gcs_portal_outcome_outbox', row: { id: '1007', agency_id: '11' }, agencies: ['11'] }
]

fixture.verifyExtensionAuditContract(extension, concreteRows)

describe('portal audit missing owner', () => {
  it('does not attribute an unknown Agency row to the actor', async () => {
    const { mergeExtensionAuditOwnership } = await import(pathToFileURL(resolve(hostRoot, 'server/database/extension-audit-ownership.ts')).href)
    const { createAuditOwnershipResolver } = await import(pathToFileURL(resolve(hostRoot, 'server/utils/audit-ownership.ts')).href)
    const registry = mergeExtensionAuditOwnership([extension])
    const resolver = createAuditOwnershipResolver({ registry, actorAgencyIds: async () => ['11'], load: async () => [] })
    expect(await resolver.resolveRow('extensions.gcs_portal_receipt', { id: '9999', agency_id: '99' }))
      .toMatchObject({ type: 'unresolved' })
  })
})
