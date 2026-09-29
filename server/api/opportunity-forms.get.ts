import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listOpportunityForms } from '../opportunities.ts'

export default defineGcsExtensionRouteHandler(listOpportunityForms)
