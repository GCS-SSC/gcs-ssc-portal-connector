import { describe, expect, it } from 'vitest'
import { agreementTargetsForScope, foreignId, publishedAgreementTargets } from '../server/forms.ts'

const agreements = [
  { id: 'A-1', organizationId: 'N-1', streamId: 'S-1' },
  { id: 'A-2', organizationId: 'N-2', streamId: 'S-2' },
  { id: 'A-3', organizationId: 'N-3', streamId: 'S-3' }
]
const streams = [
  { id: 'S-1', programId: 'P-1', sourceSystem: 'gcs-ssc' },
  { id: 'S-2', programId: 'P-1', sourceSystem: 'gcs-ssc' },
  { id: 'S-3', programId: 'P-1', sourceSystem: 'other' }
]

describe('form publication scopes', () => {
  it('expands a Program only to eligible Agreements in GCS Streams', () => {
    expect(agreementTargetsForScope(agreements, streams, 'program', 'P-1')).toEqual([
      { agreementId: 'A-1', organizationId: 'N-1' },
      { agreementId: 'A-2', organizationId: 'N-2' }
    ])
  })

  it('expands a Stream to its Agreements and ignores a non-GCS Stream', () => {
    expect(agreementTargetsForScope(agreements, streams, 'stream', 'S-2')).toEqual([
      { agreementId: 'A-2', organizationId: 'N-2' }
    ])
    expect(agreementTargetsForScope(agreements, streams, 'stream', 'S-3')).toEqual([])
  })

  it('gives organization-level sets a different stable identity from Agreement sets', () => {
    expect(foreignId('form-set:V-ABCDE:2:organization:N-ABCDE'))
      .not.toBe(foreignId('form-set:V-ABCDE:2:G-ABCDE:N-ABCDE'))
  })

  it('keeps a replacement organization eligible through its published Agreement link', () => {
    const portalAgreements = [{ id: 'A-1', organizationId: 'N-OLD', streamId: 'S-1', active: true }] as unknown as Parameters<typeof publishedAgreementTargets>[0]
    const targets = publishedAgreementTargets(portalAgreements, [
      { portal_agreement_id: 'A-1', portal_organization_id: 'N-OLD' },
      { portal_agreement_id: 'A-1', portal_organization_id: 'N-NEW' },
      { portal_agreement_id: 'A-1', portal_organization_id: 'N-NEW' }
    ], new Set(['N-NEW']))
    expect(targets.map(item => ({ id: item.id, organizationId: item.organizationId })))
      .toEqual([{ id: 'A-1', organizationId: 'N-NEW' }])
  })
})
