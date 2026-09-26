import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listOrganizations } from '../organizations.ts'

export default defineGcsExtensionRouteHandler(listOrganizations)
