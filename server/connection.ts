import { z } from 'zod'
import { createGcsExtensionUserError, getEncryptedExtensionSecret, setEncryptedExtensionSecret, type GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { asConnectorDb } from './db.ts'
import { agencyIdFromContext, authorizedWrite, EXTENSION_KEY } from './authorization.ts'
import { createPortalClient, PortalRequestError } from './portal-client.ts'

const portalUrl = z.url().refine((value) => {
  const url = new URL(value)
  return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
})
export const connectionInput = z.object({
  portalUrl,
  portalAgencyId: z.string().regex(/^G-[A-HJKMNP-Z2-9]{5,}$/),
  portalKey: z.string().regex(/^gcs_[A-Za-z0-9_-]{43}$/).optional()
}).strict()

const secretRootKey = (): string => {
  const key = process.env.GCS_EXTENSION_SECRETS_KEY
  if (!key) throw new Error('GCS_EXTENSION_SECRETS_KEY is required for the portal connector.')
  return key
}

export const secretOptions = (agencyId: string) => ({
  rootKey: secretRootKey(),
  extensionKey: EXTENSION_KEY,
  ownerType: 'agency',
  ownerId: agencyId,
  secretKey: 'portal-key'
})

const checkPortalStructure = async (portalUrl: string, portalAgencyId: string, key: string) => {
  try {
    await createPortalClient({ portalUrl, portalAgencyId, key }).structure()
  } catch (error) {
    if (error instanceof PortalRequestError && error.status === 401) {
      throw createGcsExtensionUserError({
        code: 'GCS_PORTAL_INVALID_CREDENTIAL', statusCode: 400,
        message: {
          en: 'The Portal rejected this API credential. Issue a new integration key for this agency in the Portal, then try again.',
          fr: 'Le portail a refusé cette clé API. Créez une nouvelle clé d’intégration pour cet organisme gouvernemental dans le portail, puis réessayez.'
        }
      })
    }
    if (error instanceof PortalRequestError && error.status === 404) {
      throw createGcsExtensionUserError({
        code: 'GCS_PORTAL_AGENCY_NOT_FOUND', statusCode: 400,
        message: {
          en: 'The Portal could not find this agency for the supplied code and credential. Check both values in the Portal.',
          fr: 'Le portail ne trouve pas cet organisme gouvernemental avec le code et la clé fournis. Vérifiez les deux valeurs dans le portail.'
        }
      })
    }
    throw error
  }
}

export const getConnection = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const db = asConnectorDb(context.db)
  const row = await db.selectFrom('extensions.gcs_portal_connection').selectAll()
    .where('agency_id', '=', agencyId).executeTakeFirst()
  if (!row) return { connection: null }
  const credential = await getEncryptedExtensionSecret(db, secretOptions(agencyId))
  return {
    connection: {
      portalUrl: row.portal_url,
      portalAgencyId: row.portal_agency_id,
      revision: row.revision,
      hasCredential: credential !== null,
      updatedAt: new Date(row.updated_at).toISOString()
    }
  }
}

export const saveConnection = async (context: GcsExtensionRouteContext) => {
  const input = connectionInput.parse(await context.readBody())
  const agencyId = agencyIdFromContext(context)
  const existingConnection = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_connection')
    .select('agency_id').where('agency_id', '=', agencyId).executeTakeFirst()
  if (!existingConnection && !input.portalKey) throw new Error('A portal key is required for a new connection.')
  const key = input.portalKey ?? await readPortalCredential(context, agencyId)
  await checkPortalStructure(input.portalUrl, input.portalAgencyId, key)
  await authorizedWrite(context, async (transaction) => {
    const existing = await transaction.selectFrom('extensions.gcs_portal_connection')
      .select(['agency_id', 'portal_url', 'portal_agency_id'])
      .where('agency_id', '=', agencyId).forUpdate().executeTakeFirst()
    if (!existing && !input.portalKey) throw new Error('A portal key is required for a new connection.')
    if (input.portalKey) await setEncryptedExtensionSecret(transaction, {
      ...secretOptions(agencyId), value: { key: input.portalKey }
    })
    if (existing) {
      if (existing.portal_url !== input.portalUrl || existing.portal_agency_id !== input.portalAgencyId) {
        const linked = await transaction.selectFrom('extensions.gcs_portal_identity').select('agency_id')
          .where('agency_id', '=', agencyId).executeTakeFirst()
        if (linked) throw new Error('A connected agency with verified organizations cannot switch portals. Rotate its key or migrate the links explicitly.')
      }
      await transaction.updateTable('extensions.gcs_portal_connection')
        .set({ portal_url: input.portalUrl, portal_agency_id: input.portalAgencyId,
          scan_cursor: null, revision: (eb) => eb('revision', '+', 1), updated_at: new Date() })
        .where('agency_id', '=', agencyId).execute()
    } else {
      await transaction.insertInto('extensions.gcs_portal_connection').values({
        agency_id: agencyId, portal_url: input.portalUrl,
        portal_agency_id: input.portalAgencyId, updated_at: new Date()
      }).execute()
    }
  })
  return getConnection(context)
}

/** Checks proposed connection details without persisting the URL or credential. */
export const testConnection = async (context: GcsExtensionRouteContext) => {
  const input = connectionInput.parse(await context.readBody())
  const agencyId = agencyIdFromContext(context)
  const key = input.portalKey ?? await readPortalCredential(context, agencyId)
  await checkPortalStructure(input.portalUrl, input.portalAgencyId, key)
  return { connected: true }
}

export const readPortalCredential = async (context: GcsExtensionRouteContext, agencyId: string): Promise<string> => {
  return readPortalCredentialFromDb(asConnectorDb(context.db), agencyId)
}

export const readPortalCredentialFromDb = async (db: ReturnType<typeof asConnectorDb>, agencyId: string): Promise<string> => {
  const credential = await getEncryptedExtensionSecret(db, secretOptions(agencyId))
  const key = z.object({ key: z.string().regex(/^gcs_[A-Za-z0-9_-]{43}$/) }).parse(credential).key
  return key
}
