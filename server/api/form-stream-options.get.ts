import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { getFormOptions } from '../form-options.ts'

export default defineGcsExtensionRouteHandler(getFormOptions)
