import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { getReceiptAttachment } from '../receipt-attachments.ts'
export default defineGcsExtensionRouteHandler(context => getReceiptAttachment(context))
