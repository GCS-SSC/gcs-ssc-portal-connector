import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { saveConnection } from '../connection.ts'

export default defineGcsExtensionRouteHandler(saveConnection)
