import { defineGcsExtensionRouteHandler, type GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { asConnectorDb } from './db.ts'

/** Shows the last successful publication for each portal organization on this Agreement. */
export const listPublications = async (context: GcsExtensionRouteContext) => {
  const agreementId = context.params.agreementId
  const agencyId = context.params.agencyId
  if (!agreementId || !/^[1-9]\d{0,18}$/.test(agreementId)) throw new Error('A valid Agreement is required.')
  if (!agencyId || !/^[1-9]\d{0,18}$/.test(agencyId)) throw new Error('A valid agency is required.')
  const rows = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_publication')
    .select(['portal_organization_id', 'portal_agreement_id', 'portal_agreement_revision',
      'portal_set_ids', 'published_at'])
    .where('agency_id', '=', agencyId).where('gcs_agreement_id', '=', agreementId)
    .orderBy('published_at', 'desc').orderBy('id', 'desc')
    .execute()
  const seen = new Set<string>()
  const publications = rows.filter((row) => {
    if (seen.has(row.portal_organization_id)) return false
    seen.add(row.portal_organization_id)
    return true
  }).map((row) => ({
    organizationId: row.portal_organization_id,
    agreementId: row.portal_agreement_id,
    revision: row.portal_agreement_revision,
    setCount: row.portal_set_ids.length,
    publishedAt: new Date(row.published_at).toISOString()
  }))
  return { publications }
}

export default defineGcsExtensionRouteHandler(listPublications)
