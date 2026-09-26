import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { getForm } from '../forms.ts'
export default defineGcsExtensionRouteHandler(getForm)
