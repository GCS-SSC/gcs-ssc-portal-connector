import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { Kysely } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import type { GcsExtensionRouteContext, GcsExtensionWriteAuthorization } from '@gcs-ssc/extensions/server'

const host = vi.hoisted(() => ({ lifecycle: vi.fn(), projection: vi.fn(), client: vi.fn() }))
vi.mock('@gcs-ssc/extensions/server', async importOriginal => ({
  ...await importOriginal<typeof import('@gcs-ssc/extensions/server')>(),
  lockGcsExtensionLifecycleScope: host.lifecycle
}))
vi.mock('../server/agreement-projection.ts', () => ({ projectAgreement: host.projection }))
vi.mock('../server/operations.ts', () => ({ queuePortalClient: host.client }))
import { publishAgreement } from '../server/publish-agreement.ts'

describe('Agreement publication authorization', () => {
  const engine = new PGlite()
  const db = new Kysely<unknown>({ dialect: new KyselyPGlite(engine).dialect })
  const order: string[] = []
  const authorization: GcsExtensionWriteAuthorization = {
    lockAuthState: async () => { order.push('auth lock') },
    authorizeCurrentScope: async () => { order.push('current scope') },
    authorizeCurrentEntity: async () => { throw new Error('Unexpected entity fallback') }
  }
  const context = (): GcsExtensionRouteContext => ({
    event: { context: { $db: db } }, db, params: { agencyId: '1' }, config: {}, agencyConfig: {},
    readBody: async () => JSON.parse(JSON.stringify({ agreementId: '31', proponentId: '71', portalOrganizationId: 'N-ABCDE' })),
    getHeader: () => undefined, writeAuthorization: authorization
  })
  beforeAll(async () => {
    await engine.exec(`CREATE SCHEMA extensions;
      CREATE TABLE extensions.gcs_ssc_portal_connector_identity (agency_id text, portal_organization_id text, proponent_id text);
      CREATE TABLE extensions.gcs_ssc_portal_connector_verification (portal_organization_id text, proponent_id text, portal_active boolean);`)
  })
  beforeEach(async () => {
    vi.resetAllMocks()
    order.length = 0
    delete authorization.lockAndAuthorizeAgreement
    host.lifecycle.mockImplementation(async () => { order.push('lifecycle lock') })
    host.projection.mockResolvedValue({ agreement: { stream_id: '21' } })
    await engine.exec(`TRUNCATE extensions.gcs_ssc_portal_connector_identity, extensions.gcs_ssc_portal_connector_verification;
      INSERT INTO extensions.gcs_ssc_portal_connector_identity VALUES ('1','N-ABCDE','71');
      INSERT INTO extensions.gcs_ssc_portal_connector_verification VALUES ('N-ABCDE','71',true);`)
  })
  afterAll(async () => { await db.destroy() })

  it.each(['missing', 'different'] as const)('does not publish an organization with a %s verified recipient', async state => {
    if (state === 'missing') await engine.exec(`DELETE FROM extensions.gcs_ssc_portal_connector_identity`)
    else await engine.exec(`UPDATE extensions.gcs_ssc_portal_connector_identity SET proponent_id='72'`)
    await expect(publishAgreement(context())).rejects.toThrow('Verify the portal organization and recipient')
    expect(order).toEqual(['auth lock', 'lifecycle lock', 'current scope'])
    expect(host.projection).not.toHaveBeenCalled()
    expect(host.client).not.toHaveBeenCalled()
  })
  it('does not project or send an Agreement after its organization becomes inactive', async () => {
    await engine.exec(`UPDATE extensions.gcs_ssc_portal_connector_verification SET portal_active=false`)
    await expect(publishAgreement(context())).rejects.toThrow('organization is inactive')
    expect(host.projection).not.toHaveBeenCalled()
    expect(host.client).not.toHaveBeenCalled()
  })
  it.each(['unavailable', 'revoked'] as const)('requires the current assigned Contributor service when it is %s', async state => {
    const authorize = vi.fn(async () => false)
    if (state === 'revoked') authorization.lockAndAuthorizeAgreement = authorize
    await expect(publishAgreement(context())).rejects.toThrow('current assigned Contributor access')
    expect(host.projection).toHaveBeenCalledTimes(1)
    if (state === 'revoked') expect(authorize).toHaveBeenCalledWith(expect.anything(), { agreementId: '31', streamId: '21', action: 'update' })
    expect(host.client).not.toHaveBeenCalled()
  })
})
