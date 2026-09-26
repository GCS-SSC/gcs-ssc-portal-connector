import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { manageForm } from '../forms.ts'
export default defineGcsExtensionRouteHandler(manageForm)
