import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listIntakes } from '../intakes.ts'
export default defineGcsExtensionRouteHandler(listIntakes)
