import { expect, it, vi } from 'vitest'

const projectAgreement = vi.hoisted(() => vi.fn())
const queuePortalClient = vi.hoisted(() => vi.fn())
vi.mock('../server/agreement-projection.ts', () => ({ projectAgreement }))
vi.mock('../server/operations.ts', () => ({ queuePortalClient }))
vi.mock('../server/connection.ts', () => ({ readPortalCredentialFromDb: async () => 'credential' }))

import { publishAgreementCore } from '../server/publish-agreement.ts'

it.each(['source', 'status selection', 'remote revision'])('publishes new revision sets after partial delivery and changed %s', async change => {
  queuePortalClient.mockClear()
  const source = {
    agreement: { agreement_id: '31', agreement_number: 'A-31', title_en: 'Original', title_fr: 'Initial',
      program_id: '11', program_name_en: 'Program', program_name_fr: 'Programme',
      stream_id: '21', stream_name_en: 'Stream', stream_name_fr: 'Volet',
      status_id: '91', status_name_en: 'Active', status_name_fr: 'Actif', status_colour: '#123456', terminal: false },
    fiscalYears: [{ id: '41', start_year: 2026 }],
    lines: [{ id: '51', fiscal_year_id: '41', name_en: 'Costs', name_fr: 'Coûts', category_en: 'Operations',
      subsection: '', program_funding: '100.00', currency: 'CAD' }]
  }
  projectAgreement.mockImplementation(async () => structuredClone(source))
  const connection = { portal_url: 'https://portal.example/', portal_agency_id: 'G-ABCDE', portal_status_ids: [] as string[] }
  const db = {
    selectFrom: (table: string) => {
      const query = { select: () => query, selectAll: () => query, where: () => query,
        executeTakeFirst: async () => table.endsWith('verification') ? { portal_organization_id: 'N-ABCDE' } : connection }
      return query
    },
    transaction: () => ({ execute: async (run: (transaction: unknown) => Promise<void>) => run({
      insertInto: () => ({ values: () => ({ onConflict: () => ({ execute: async () => {} }) }) })
    }) })
  }
  let agreement: Record<string, any> | null = null
  const sets: Array<Record<string, any>> = []
  const replay = new Map<string, unknown>()
  let failForecast = true
  queuePortalClient.mockImplementation((_db, _agency, _connection, scope: string) => {
    const once = async (step: string, body: unknown, run: () => unknown) => {
      const key = `${scope}:${step}:${JSON.stringify(body)}`
      if (replay.has(key)) return replay.get(key)
      const result = run()
      replay.set(key, result)
      return result
    }
    return {
      structure: async () => ({ programs: [{ id: 'P-ABCDE', sourceSystem: 'gcs-ssc', foreignSystemId: '11' }],
        streams: [{ id: 'S-ABCDE', sourceSystem: 'gcs-ssc', foreignSystemId: '21' }] }),
      agreements: async () => ({ agreements: agreement ? [structuredClone(agreement)] : [] }),
      createAgreement: (value: object) => once('create-agreement', value, () => {
        agreement = { ...value, id: 'A-ABCDE', revision: 1 }
        return 'A-ABCDE'
      }),
      updateAgreement: (id: string, input: { value: object }) => once(`update-agreement:${id}`, input, () => {
        agreement = { ...input.value, id, revision: agreement!.revision + 1 }
        return { agreement: { revision: agreement.revision } }
      }),
      linkOrganization: async () => {},
      sets: async () => ({ sets: structuredClone(sets) }),
      createSet: (input: Record<string, any>) => once('create-set', input, () => {
        if (input.items[0].kind === 'forecast' && failForecast) {
          failForecast = false
          throw new Error('Portal unavailable after first set publication')
        }
        const set = { ...input, id: `R-${sets.length + 1}`, revision: 1, published: false, snapshot: null }
        sets.push(set)
        return { id: set.id, revision: set.revision }
      }),
      withdrawSet: (id: string, revision: number) => once(`withdraw:${id}`, revision, () => {
        const set = sets.find(row => row.id === id)!
        set.published = false
        set.revision++
        return {}
      }),
      publishSet: (id: string, revision: number) => once(`publish:${id}`, revision, () => {
        const set = sets.find(row => row.id === id)!
        set.published = true
        set.revision++
        set.snapshot = { agreement: { revision: agreement!.revision } }
        return {}
      })
    }
  })
  const input = { agreementId: '31', proponentId: '61', portalOrganizationId: 'N-ABCDE' }
  await expect(publishAgreementCore(db as never, '1', input, 'agreement-delivery:71')).rejects.toThrow('Portal unavailable')
  expect(sets.filter(row => row.published)).toHaveLength(1)
  if (change === 'source') source.agreement.title_en = 'Updated Agreement'
  else if (change === 'status selection') connection.portal_status_ids.push('91')
  else agreement!.revision++
  const result = await publishAgreementCore(db as never, '1', input, 'agreement-delivery:71')
  expect(result.revision).toBe(2)
  const published = sets.filter(row => row.published)
  expect(published).toHaveLength(2)
  expect(published.every(row => row.snapshot.agreement.revision === 2)).toBe(true)
  expect(result.setIds).toEqual(published.map(row => row.id))
  const setScopes = queuePortalClient.mock.calls.map(call => call[3]).filter(scope => scope.includes(':sets:'))
  expect(setScopes).toEqual(['agreement-delivery:71:sets:A-ABCDE:1', 'agreement-delivery:71:sets:A-ABCDE:2'])
})
