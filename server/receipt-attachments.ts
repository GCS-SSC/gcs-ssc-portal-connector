import { createHash } from 'node:crypto'
import type { z } from 'zod'
import { createGcsExtensionUserError, type GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { getReceipt } from './sync.ts'
import { asConnectorDb } from './db.ts'
import { readPortalCredentialFromDb } from './connection.ts'
import { receiptAttachmentMessages } from '../i18n/receipt-attachments.ts'
import type { PortalConnection } from './portal-client.ts'

import { receiptAttachmentSchema } from '../shared/receipt-attachments.ts'
const unavailable = () => createGcsExtensionUserError({ code: 'GCS_PORTAL_ATTACHMENT_UNAVAILABLE', statusCode: 404,
  message: { en: receiptAttachmentMessages.en.receiptAttachmentUnavailable, fr: receiptAttachmentMessages.fr.receiptAttachmentUnavailable } })
const failed = () => createGcsExtensionUserError({ code: 'GCS_PORTAL_ATTACHMENT_DOWNLOAD_FAILED', statusCode: 502,
  message: { en: receiptAttachmentMessages.en.receiptAttachmentDownloadFailed, fr: receiptAttachmentMessages.fr.receiptAttachmentDownloadFailed } })

/** Fetch only original immutable receipt evidence; never forward remote headers or the bearer to a redirect. */
export const fetchReceiptAttachment = async (connection: PortalConnection, submissionId: string,
  attachment: z.infer<typeof receiptAttachmentSchema>, transport: typeof fetch = fetch): Promise<Response> => {
  const path = `api/government/submissions/${encodeURIComponent(submissionId)}/attachments/${encodeURIComponent(attachment.id)}`
  let response: Response
  try { response = await transport(new URL(path, connection.portalUrl), { redirect: 'manual',
    signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${connection.key}`, Accept: 'application/octet-stream' } }) }
  catch { throw failed() }
  if (!response.ok || !response.body) { await response.body?.cancel(); throw failed() }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      length += result.value.byteLength
      if (length > attachment.size) { await reader.cancel(); throw failed() }
      chunks.push(result.value)
    }
  } catch { await reader.cancel().catch(() => {}); throw failed() }
  if (length !== attachment.size) throw failed()
  const bytes = Buffer.concat(chunks)
  if (createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) throw failed()
  const filename = attachment.filename.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_') || 'attachment'
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encoded}`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': 'sandbox' } })
}

export const getReceiptAttachment = async (context: GcsExtensionRouteContext, transport: typeof fetch = fetch) => {
  const { receipt } = await getReceipt(context)
  const exportValue = receipt.source_export as { attachments?: unknown[] } | null
  const attachment = (Array.isArray(exportValue?.attachments) ? exportValue.attachments : [])
    .map(value => receiptAttachmentSchema.safeParse(value)).find(value => value.success && value.data.id === context.params.attachmentId)
  if (!attachment?.success) throw unavailable()
  const db = asConnectorDb(context.db)
  const connection = await db.selectFrom('extensions.gcs_portal_connection').select(['portal_url', 'portal_agency_id'])
    .where('agency_id', '=', context.params.agencyId!).executeTakeFirst()
  if (!connection) throw unavailable()
  return fetchReceiptAttachment({ portalUrl: connection.portal_url, portalAgencyId: connection.portal_agency_id,
    key: await readPortalCredentialFromDb(db, context.params.agencyId!) }, receipt.submission_id, attachment.data, transport)
}
