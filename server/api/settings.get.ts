import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { getSettings } from '../settings.ts'

export default defineGcsExtensionRouteHandler(getSettings)
