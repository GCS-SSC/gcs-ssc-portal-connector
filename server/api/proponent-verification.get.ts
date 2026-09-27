import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listProponentVerifications } from '../organizations.ts'

export default defineGcsExtensionRouteHandler(listProponentVerifications)
