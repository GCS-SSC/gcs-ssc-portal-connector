import type { Transaction } from 'kysely'
import {
  lockGcsExtensionLifecycleScope,
  type GcsExtensionRouteContext
} from '@gcs-ssc/extensions/server'
import { asConnectorDb, type ConnectorDatabase } from './db.ts'

export const EXTENSION_KEY = 'gcs-ssc-portal-connector'

export const agencyIdFromContext = (context: GcsExtensionRouteContext): string => {
  const agencyId = context.params.agencyId
  if (!agencyId || !/^[1-9]\d{0,18}$/.test(agencyId)) throw new Error('A valid agency is required.')
  return agencyId
}

/** Host authorization precedes extension lifecycle and business locks. */
export const authorizedWrite = async <T>(
  context: GcsExtensionRouteContext,
  operation: (transaction: Transaction<ConnectorDatabase>) => Promise<T>
): Promise<T> => {
  const authorization = context.writeAuthorization
  if (!authorization) throw new Error('Host write authorization is unavailable.')
  const agencyId = agencyIdFromContext(context)
  return asConnectorDb(context.db).transaction().execute(async (transaction) => {
    await authorization.lockAuthState(transaction)
    await lockGcsExtensionLifecycleScope(transaction as unknown as Transaction<unknown>, EXTENSION_KEY, agencyId)
    await (authorization.authorizeCurrentScope ?? authorization.authorizeCurrentEntity)(transaction)
    return operation(transaction)
  })
}
