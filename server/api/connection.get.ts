import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { getConnection } from '../connection.ts'

export default defineGcsExtensionRouteHandler(getConnection)
