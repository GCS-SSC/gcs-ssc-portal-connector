import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { publishAgreement } from '../publish-agreement.ts'

export default defineGcsExtensionRouteHandler(publishAgreement)
