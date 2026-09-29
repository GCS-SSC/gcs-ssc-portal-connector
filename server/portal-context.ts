import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { agencyIdFromContext } from './authorization.ts'
import { readPortalCredentialFromDb } from './connection.ts'
import { asConnectorDb } from './db.ts'
import { queuePortalClient } from './operations.ts'

export const clientForAgency = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const db = asConnectorDb(context.db)
  const connection = await db.selectFrom('extensions.gcs_portal_connection').selectAll()
    .where('agency_id', '=', agencyId).executeTakeFirst()
  if (!connection) throw new Error('Connect the portal before managing forms.')
  return { agencyId, connection, client: queuePortalClient(db, agencyId, {
    portalUrl: connection.portal_url, portalAgencyId: connection.portal_agency_id,
    key: await readPortalCredentialFromDb(db, agencyId)
  }) }
}
