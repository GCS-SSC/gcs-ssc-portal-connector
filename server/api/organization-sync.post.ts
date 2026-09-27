import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { refreshOrganizations } from '../organizations.ts'

export default defineGcsExtensionRouteHandler(refreshOrganizations)
