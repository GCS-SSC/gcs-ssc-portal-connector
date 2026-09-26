import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { saveSettings } from '../settings.ts'

export default defineGcsExtensionRouteHandler(saveSettings)
