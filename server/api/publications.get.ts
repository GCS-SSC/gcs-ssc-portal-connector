import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listPublications } from '../publications.ts'

export default defineGcsExtensionRouteHandler(listPublications)
