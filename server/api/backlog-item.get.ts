import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { getOutboxItem } from '../outbox.ts'

export default defineGcsExtensionRouteHandler(getOutboxItem)
