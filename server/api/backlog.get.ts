import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listOutbox } from '../outbox.ts'

export default defineGcsExtensionRouteHandler(listOutbox)
