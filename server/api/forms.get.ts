import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listForms } from '../forms.ts'
export default defineGcsExtensionRouteHandler(listForms)
