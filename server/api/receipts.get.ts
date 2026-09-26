import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listReceipts } from '../sync.ts'

export default defineGcsExtensionRouteHandler(listReceipts)
