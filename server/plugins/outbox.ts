import { defineGcsExtensionNitroPlugin, getGcsExtensionHookDatabase, type GcsExtensionRouteContext,
  type GcsExtensionScheduledMinutePayload } from '@gcs-ssc/extensions/server'
import { asConnectorDb } from '../db.ts'
import { drainOutbox } from '../outbox.ts'
import { drainOutcomeOutbox } from '../outcomes.ts'
import { pullDueAgencies, releasePullLease } from '../pull.ts'
import { syncPortal } from '../sync.ts'
import { EXTENSION_KEY } from '../authorization.ts'

/** A short startup grace and small batches keep a restarted service responsive. */
export default defineGcsExtensionNitroPlugin((nitroApp) => {
  let database: ReturnType<typeof asConnectorDb> | null = null
  let busy = false
  let readyAt = Date.now() + 30_000
  const timer = setInterval(async () => {
    if (!database || busy || Date.now() < readyAt) return
    busy = true
    try { await drainOutbox(database, 2); await drainOutcomeOutbox(database, 2) }
    catch (error) { console.error('Portal outbox drain failed', error) }
    finally { busy = false }
  }, 5000)
  timer.unref?.()
  nitroApp.hooks.hook('afterResponse', (event: { context?: { $db?: unknown } }) => {
    if (!database && getGcsExtensionHookDatabase({ event })) {
      database = asConnectorDb(getGcsExtensionHookDatabase({ event }))
      readyAt = Date.now() + 30_000
    }
  })
  nitroApp.hooks.hook('close', () => clearInterval(timer))
  nitroApp.hooks.hook('gcs-extension:scheduled-minute', async (payload: GcsExtensionScheduledMinutePayload) => {
    const pulled = await pullDueAgencies(asConnectorDb(payload.db))
    for (const agency of pulled.results) {
      if (agency.error) continue
      try {
        if (!agency.found) continue
        await payload.runForAgency(agency.agencyId, async () => {
          const context: GcsExtensionRouteContext = {
            event: { context: { $db: payload.db } }, db: payload.db,
            params: { agencyId: agency.agencyId }, config: {}, extensionKey: EXTENSION_KEY,
            writeAuthorization: payload.createWriteAuthorization(EXTENSION_KEY, agency.agencyId),
            readBody: async <T>() => undefined as T, getHeader: () => undefined
          }
          await syncPortal(context)
        })
      } catch (error) { console.error('Scheduled portal import failed', agency.agencyId, error) }
      finally { await releasePullLease(asConnectorDb(payload.db), agency.agencyId) }
    }
  })
})
