import { describe, expect, it, vi } from 'vitest'
import { createPortalClient } from '../server/portal-client.ts'

const connection = {
  portalUrl: 'https://portal.example.test/',
  portalAgencyId: 'G-ABCDE',
  key: `gcs_${'a'.repeat(43)}`
}

describe('portal transport', () => {
  it('rejects redirects without forwarding its bearer key', async () => {
    const transport = vi.fn(async () => new Response(null, {
      status: 302, headers: { Location: 'https://other.example.test/' }
    })) as unknown as typeof fetch
    await expect(createPortalClient(connection, transport).updates()).rejects.toThrow('302')
    expect(transport).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(transport).mock.calls[0]!
    expect(String(url)).toBe('https://portal.example.test/api/government/agencies/G-ABCDE/updates')
    expect(options?.redirect).toBe('manual')
    expect((options?.headers as Record<string, string>).Authorization).toBe(`Bearer ${connection.key}`)
  })

  it('uses an item outcome before acknowledging an imported claim', async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    const transport = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      requests.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path.endsWith('/response')) return Response.json({ outcomes: [] })
      return Response.json({ eventId: '1', remoteReference: '9007199254740993', consumedAt: '2026-09-26T00:00:00.000Z' })
    }) as unknown as typeof fetch
    const client = createPortalClient(connection, transport)
    await client.publishItemReference('C-ABCDE', 'C-ABCDE-Y-ABCDE', '9007199254740993')
    await client.consume('1', '9007199254740993')
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/government/submissions/C-ABCDE/response',
      'PUT /api/government/submissions/C-ABCDE/items/C-ABCDE-Y-ABCDE/outcome',
      'POST /api/government/agencies/G-ABCDE/updates/1/consume'
    ])
    expect(requests[1]?.body).toEqual({ expectedRevision: 0, remoteReference: '9007199254740993', gcsStatus: null })
  })

  it('publishes a changed status without replacing the immutable GCS reference', async () => {
    const writes: unknown[] = []
    const transport = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url).endsWith('/response')) return Response.json({ outcomes: [{
        itemSubmissionId: 'C-ABCDE-Y-ABCDE', remoteReference: '91', revision: 3,
        gcsStatus: { en: 'Draft', fr: 'Brouillon', colour: '#123456' }
      }] })
      writes.push(JSON.parse(String(init?.body)))
      return Response.json({})
    }) as unknown as typeof fetch
    const client = createPortalClient(connection, transport)
    await client.publishItemStatus('C-ABCDE', 'C-ABCDE-Y-ABCDE', '91',
      { en: 'Approved', fr: 'Approuvé', colour: '#12AB34' })
    expect(writes).toEqual([{ expectedRevision: 3, remoteReference: '91',
      gcsStatus: { en: 'Approved', fr: 'Approuvé', colour: '#12AB34' } }])
    await expect(client.publishItemStatus('C-ABCDE', 'C-ABCDE-Y-ABCDE', '92', null))
      .rejects.toThrow('another GCS record')
  })

  it('loads a paginated Portal organization choice with description, owner and counts', async () => {
    const transport = vi.fn(async () => Response.json({ organizations: [{
      id: 'N-ABCDE', name: 'Example', description: 'Community group', active: true,
      verified: false, ownerName: 'Alex', ownerEmail: 'alex@example.ca',
      memberCount: 4, agreementCount: 2, foreignApplicantRecipientId: null
    }], nextAfter: 'N-ABCDE' })) as unknown as typeof fetch
    const result = await createPortalClient(connection, transport).organizations('N-AAAAA')
    expect(result.organizations[0]).toMatchObject({ description: 'Community group', ownerName: 'Alex',
      ownerEmail: 'alex@example.ca', memberCount: 4, agreementCount: 2 })
    expect(String(vi.mocked(transport).mock.calls[0]?.[0])).toBe(
      'https://portal.example.test/api/government/agencies/G-ABCDE/organizations?after=N-AAAAA')
  })
})
