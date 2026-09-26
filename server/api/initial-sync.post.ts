import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { enqueueInitialSync } from '../organizations.ts'

export default defineGcsExtensionRouteHandler(enqueueInitialSync)
