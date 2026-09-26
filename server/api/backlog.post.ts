import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { pushOutbox } from '../outbox.ts'

export default defineGcsExtensionRouteHandler(pushOutbox)
