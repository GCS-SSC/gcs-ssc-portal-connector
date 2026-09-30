import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { saveIntakeGroupSettings } from '../intake-group-settings.ts'
export default defineGcsExtensionRouteHandler(saveIntakeGroupSettings)
