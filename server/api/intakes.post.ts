import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { manageIntake } from '../intakes.ts'
export default defineGcsExtensionRouteHandler(manageIntake)
