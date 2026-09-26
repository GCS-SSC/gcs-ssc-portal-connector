import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { verifyOrganization } from '../organizations.ts'

export default defineGcsExtensionRouteHandler(verifyOrganization)
