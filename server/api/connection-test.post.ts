import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { testConnection } from '../connection.ts'

export default defineGcsExtensionRouteHandler(testConnection)
