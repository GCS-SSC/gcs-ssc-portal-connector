import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listFormOptionStreams } from '../form-options.ts'

export default defineGcsExtensionRouteHandler(listFormOptionStreams)
