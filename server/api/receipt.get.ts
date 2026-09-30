import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { getReceipt } from '../sync.ts'
export default defineGcsExtensionRouteHandler(getReceipt)
