import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { verifyProponentOrganization } from '../organizations.ts'

export default defineGcsExtensionRouteHandler(verifyProponentOrganization)
