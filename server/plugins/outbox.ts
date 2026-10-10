import { defineGcsExtensionNitroPlugin, getGcsExtensionHookDatabase, type GcsExtensionRouteContext,
  registerGcsExtensionL1QueueHandler } from '@gcs-ssc/extensions/server'
import { asConnectorDb } from '../db.ts'
import { drainOutbox } from '../outbox.ts'
import { drainOutcomeOutbox } from '../outcomes.ts'
import { pullDueAgencies, releasePullLease } from '../pull.ts'
import { syncPortal } from '../sync.ts'
import { EXTENSION_KEY } from '../authorization.ts'
import { drainOperations } from '../operations.ts'
import { initializeLocalPortalDemo } from '../local-demo.ts'

/** The host leases both recurring schedules; domain queues retain delivery evidence. */
export default defineGcsExtensionNitroPlugin((nitroApp) => {
  let demoInitialization: Promise<void> | null = null
  registerGcsExtensionL1QueueHandler({
    extensionKey: EXTENSION_KEY, id: 'deliveries', intervalMs: 5000,
    run: async context => {
      const database = asConnectorDb(context.db)
      await drainOperations(database, 2)
      await drainOutbox(database, 2)
      await drainOutcomeOutbox(database, 2)
    }
  }, nitroApp)
  nitroApp.hooks.hook('request', async (event: { context?: { $db?: unknown } }) => {
    if (process.env.NODE_ENV === 'production' || process.env.GCS_PORTAL_DEMO_SEED !== '1') return
    const requestDatabase = getGcsExtensionHookDatabase({ event })
    if (!requestDatabase) return
    demoInitialization ??= initializeLocalPortalDemo(asConnectorDb(requestDatabase)).catch(error => {
      demoInitialization = null
      throw error
    })
    await demoInitialization
  })
  registerGcsExtensionL1QueueHandler({
    extensionKey: EXTENSION_KEY, id: 'imports', intervalMs: 60000,
    run: async payload => {
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
        } catch (error) {
          console.error('Scheduled portal import failed', agency.agencyId, error)
        } finally {
          await releasePullLease(asConnectorDb(payload.db), agency.agencyId)
        }
      }
    }
  }, nitroApp)
})
