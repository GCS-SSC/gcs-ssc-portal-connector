import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { manageOpportunity } from '../opportunities.ts'

export default defineGcsExtensionRouteHandler(manageOpportunity)
