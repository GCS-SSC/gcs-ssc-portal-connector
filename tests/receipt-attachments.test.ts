import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { Kysely } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
vi.mock('../server/authorization.ts', () => ({ agencyIdFromContext: (context: { params: { agencyId: string } }) => context.params.agencyId }))
vi.mock('../server/connection.ts', () => ({ readPortalCredentialFromDb: vi.fn(async () => 'private-bearer') }))
import { fetchReceiptAttachment, getReceiptAttachment } from '../server/receipt-attachments.ts'
const bytes = new TextEncoder().encode('Original community health evidence.\n')
const metadata = { id: 'X-ABCDE', filename: 'community-health-evidence.txt', size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), status: 'ready' as const }
const connection = { portalUrl: 'https://portal.test/base/', portalAgencyId: 'G-ABCDE', key: 'private-bearer' }
describe('verified original receipt attachment', () => {
  it('forces safe download headers and verifies exact original bytes through encoded scoped path', async () => {
    const transport = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => new Response(bytes, { headers: { 'content-type': 'text/html' } }))
    const response = await fetchReceiptAttachment(connection, 'K-ABCDE/?', { ...metadata, filename: '../health\r\n".txt' }, transport)
    expect(transport.mock.calls[0]?.[0]?.toString()).toBe('https://portal.test/base/api/government/submissions/K-ABCDE%2F%3F/attachments/X-ABCDE')
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual', headers: { Authorization: 'Bearer private-bearer' } })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="download"; filename*=UTF-8\'\'.._health%22.txt')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
  })
  it('rejects remote denial/redirect and size or digest mismatch', async () => {
    for (const status of [302, 403, 404]) await expect(fetchReceiptAttachment(connection, 'K-ABCDE', metadata, async () => new Response(null, { status }))).rejects.toMatchObject({ code: 'GCS_PORTAL_ATTACHMENT_DOWNLOAD_FAILED' })
    await expect(fetchReceiptAttachment(connection, 'K-ABCDE', { ...metadata, size: bytes.length + 1 }, async () => new Response(bytes))).rejects.toMatchObject({ code: 'GCS_PORTAL_ATTACHMENT_DOWNLOAD_FAILED' })
    await expect(fetchReceiptAttachment(connection, 'K-ABCDE', { ...metadata, sha256: '0'.repeat(64) }, async () => new Response(bytes))).rejects.toMatchObject({ code: 'GCS_PORTAL_ATTACHMENT_DOWNLOAD_FAILED' })
  })
  it('stops an oversized streaming body before consuming later chunks even with false Content-Length', async () => {
    const cancel = vi.fn(); let reads = 0
    const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(metadata.size + 1)) }, cancel })
    await expect(fetchReceiptAttachment(connection, 'K-ABCDE', metadata, async () => new Response(body, { headers: { 'content-length': '1' } }))).rejects.toMatchObject({ code: 'GCS_PORTAL_ATTACHMENT_DOWNLOAD_FAILED' })
    expect(cancel).toHaveBeenCalled(); expect(reads).toBeLessThanOrEqual(2)
  })
})

describe('agency-scoped frozen attachment route', () => {
  let engine: PGlite; let db: Kysely<unknown>
  beforeEach(async () => {
    engine = new PGlite(); db = new Kysely({ dialect: new KyselyPGlite(engine).dialect })
    await engine.exec(`CREATE SCHEMA extensions; CREATE TABLE extensions.gcs_portal_receipt(id bigserial,agency_id text,submission_id text,source_export jsonb,kind text,state text); CREATE TABLE extensions.gcs_portal_connection(agency_id text,portal_url text,portal_agency_id text);`)
    await db.insertInto('extensions.gcs_portal_receipt' as never).values({ agency_id: '1', submission_id: 'K-ABCDE', source_export: { attachments: [metadata, { ...metadata, id: 'X-NOTREADY', status: 'pending' }] }, kind: 'other_form', state: 'received' } as never).execute()
    await db.insertInto('extensions.gcs_portal_connection' as never).values({ agency_id: '1', portal_url: connection.portalUrl, portal_agency_id: connection.portalAgencyId } as never).execute()
  })
  afterEach(async () => { await db.destroy() })
  const context = (agencyId = '1', attachmentId = metadata.id) => ({ db, params: { agencyId, receiptId: '1', attachmentId } })
  it('requires owning receipt agency and frozen ready ID before remote access', async () => {
    const transport = vi.fn(async () => new Response(bytes))
    await expect(getReceiptAttachment(context('2') as never, transport)).rejects.toMatchObject({ code: 'GCS_PORTAL_RECEIPT_NOT_FOUND' })
    for (const id of ['X-UNKNOWN', 'X-NOTREADY']) await expect(getReceiptAttachment(context('1', id) as never, transport)).rejects.toMatchObject({ code: 'GCS_PORTAL_ATTACHMENT_UNAVAILABLE' })
    expect(transport).not.toHaveBeenCalled()
    const response = await getReceiptAttachment(context() as never, transport)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
