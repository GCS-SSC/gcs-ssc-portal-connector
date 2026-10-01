import { sql } from 'kysely'
import type { ConnectorDatabase } from './db.ts'
import type { Kysely } from 'kysely'
import { seedHealthCanadaPortalConnector } from './demo-seed.ts'
import { connectionInput } from './connection.ts'

/**
 * Seeds only the explicit local-development launch, never a production process.
 * @param db Migrated connector database.
 */
export const initializeLocalPortalDemo = async (db: Kysely<ConnectorDatabase>): Promise<void> => {
  if (process.env.NODE_ENV === 'production' || process.env.GCS_PORTAL_DEMO_SEED !== '1') return
  const enabled = (await sql<{ present: boolean }>`SELECT EXISTS (
    SELECT 1 FROM extensions.agency_enablement enablement
    JOIN "Agency_Profile" agency ON agency.id=enablement.agency_id
    WHERE enablement.extension_key='gcs-ssc-portal-connector' AND enablement.enabled=true
      AND enablement._deleted=false AND agency._deleted=false AND agency.egcs_ay_name_en='Health Canada'
  ) AS present`.execute(db)).rows[0]?.present
  if (!enabled) return
  const portalKey = process.env.PORTAL_DEMO_HEALTH_CANADA_TOKEN
    ?? 'gcs_PgdzCAcAAc5UJO42TvnGK8QgSQSv-fWhM-vTd0sfyPo'
  const connection = connectionInput.parse({
    portalUrl: process.env.PORTAL_DEMO_URL ?? 'http://localhost:3003/',
    portalAgencyId: process.env.PORTAL_DEMO_HEALTH_CANADA_AGENCY_ID ?? 'G-NFAFV',
    portalKey
  })
  await seedHealthCanadaPortalConnector(db, {
    ...connection, portalKey, secretRootKey: process.env.GCS_EXTENSION_SECRETS_KEY,
    preconfigureConnection: true, seedApplicationForm: true, requireEnabled: true, organizations: []
  })
}
