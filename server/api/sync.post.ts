import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { syncPortal } from '../sync.ts'

export default defineGcsExtensionRouteHandler(syncPortal)
