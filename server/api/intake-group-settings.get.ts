import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { getIntakeGroupSettings } from '../intake-group-settings.ts'
export default defineGcsExtensionRouteHandler(getIntakeGroupSettings)
