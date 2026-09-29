import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { getOpportunityForm } from '../opportunities.ts'

export default defineGcsExtensionRouteHandler(getOpportunityForm)
