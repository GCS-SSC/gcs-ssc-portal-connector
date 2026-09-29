import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import extension from '../extension.config.ts'

const expectedOwnedTables = [
  'gcs_portal_connection',
  'gcs_portal_receipt',
  'gcs_portal_publication',
  'gcs_portal_identity',
  'gcs_portal_organization',
  'gcs_portal_verification',
  'gcs_portal_outbox',
  'gcs_portal_inbox',
  'gcs_portal_outcome_outbox',
  'gcs_portal_form',
  'gcs_portal_operation'
].map(table => `extensions.${table}`).sort()

describe('portal connector audit ownership', () => {
  it('declares agency-owned tables and the app-wide verification table', () => {
    const migrationsDirectory = fileURLToPath(new URL('../server/migrations/', import.meta.url))
    const created = readdirSync(migrationsDirectory).flatMap(file => {
      const source = readFileSync(new URL(`../server/migrations/${file}`, import.meta.url), 'utf8')
      return [...source.matchAll(/CREATE TABLE extensions\.([a-z_][a-z_0-9]*)/g)]
        .map(match => `extensions.${match[1]}`)
    }).sort()

    expect(created).toEqual(expectedOwnedTables)
    expect(extension.auditOwnership?.map(declaration => declaration.table).sort()).toEqual(expectedOwnedTables)
    for (const declaration of extension.auditOwnership ?? []) expect(declaration.owner).toEqual(
      declaration.table === 'extensions.gcs_portal_verification'
        ? { kind: 'global', reason: 'A verified Portal organization maps to one GCS Proponent across all agencies.' }
        : { kind: 'owner', owner: 'agency', column: 'agency_id' }
    )
  })

  it('leaves host infrastructure outside the connector declaration for global fallback', () => {
    expect(extension.auditOwnership?.some(declaration => declaration.table === 'extensions.agency_enablement')).toBe(false)
    expect(extension.auditOwnership?.some(declaration => declaration.table === 'extensions.extension_migration_fixture')).toBe(false)
  })
})
