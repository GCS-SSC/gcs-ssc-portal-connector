import { resolve } from 'node:path'
import { Kysely, PostgresDialect } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import pg from 'pg'
import type { ConnectorDatabase } from '../server/db.ts'
import { connectionInput } from '../server/connection.ts'
import { seedHealthCanadaPortalConnector } from '../server/demo-seed.ts'
import { createPortalClient } from '../server/portal-client.ts'

const portalUrl = process.env.PORTAL_DEMO_URL ?? 'http://localhost:3000/'
const portalAgencyId = process.env.PORTAL_DEMO_HEALTH_CANADA_AGENCY_ID ?? 'G-NFAFV'
const portalKey = process.env.PORTAL_DEMO_HEALTH_CANADA_TOKEN
  ?? 'gcs_PgdzCAcAAc5UJO42TvnGK8QgSQSv-fWhM-vTd0sfyPo'

if (process.env.NODE_ENV === 'production') {
  throw new Error('The Health Canada fixture is for local development only.')
}
connectionInput.parse({ portalUrl, portalAgencyId, portalKey })
const preconfigureConnection = process.env.GCS_PORTAL_DEMO_PRECONFIGURE === '1'
const secretRootKey = process.env.GCS_EXTENSION_SECRETS_KEY
if (preconfigureConnection && !secretRootKey)
  throw new Error('Set GCS_EXTENSION_SECRETS_KEY to the same value used by the GCS server to preconfigure the connection.')

const client = createPortalClient({ portalUrl, portalAgencyId, key: portalKey })
const pages: Awaited<ReturnType<typeof client.organizations>>['organizations'] = []
let after: string | undefined
do {
  const page = await client.organizations(after)
  pages.push(...page.organizations)
  after = page.nextAfter ?? undefined
} while (after)
const expectedNames = ['Shopify Inc.', 'Northern Community Health Initiative', 'Former Health Partnership']
const organizations = expectedNames.map(name => {
  const match = pages.find(organization => organization.name === name)
  if (!match) throw new Error(`Portal Health Canada fixture is missing ${name}. Seed the companion Portal first.`)
  return match
})

const databaseUrl = process.env.DATABASE_URL
const pglitePath = resolve(process.env.PGLITE_DATA_DIR ?? '../../.data/pglite')
const database = databaseUrl
  ? new Kysely<ConnectorDatabase>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }) })
  : new Kysely<ConnectorDatabase>({ dialect: new KyselyPGlite(pglitePath).dialect })
try {
  const result = await seedHealthCanadaPortalConnector(database, {
    portalUrl, portalAgencyId, portalKey, secretRootKey, preconfigureConnection, organizations
  })
  console.info(`Health Canada Agency ${result.agencyId}; Agreement ${result.agreementId}; Proponent ${result.proponentName} (${result.proponentId}).`)
  if (result.phase === 'restart-required') {
    console.info('Connector enabled. Start the GCS server once to apply its extension migrations, stop it, then run this seed command again.')
  } else {
    console.info(`Connector and three unverified Portal organizations are ready. Connection ${preconfigureConnection ? 'was preconfigured' : 'is ready for manual Test and Save'}.`)
  }
} finally {
  await database.destroy()
}
