import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setEncryptedExtensionSecret, type GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { asConnectorDb } from '../server/db.ts'
import migration7 from '../server/migrations/0007_organization_verification.ts'
import migration10 from '../server/migrations/0010_portal_operations.ts'
import { enqueueInitialSync, listOrganizations, listProponentVerifications, refreshOrganizations, verifyOrganization, verifyProponentOrganization } from '../server/organizations.ts'

const db = new Kysely<unknown>({ dialect: new KyselyPGlite({ parsers: { 20: value => value } }).dialect })
const executeFixtureSql = async (source: string) => {
  for (const statement of source.split(';').filter(part => part.trim())) await sql.raw(statement).execute(db)
}
const rootKey = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
const body = { organizationId: 'N-ABCDE', proponentId: '101', note: ' Checked documents. ' }
let denied = false
let manager = true
const context = (params = { agencyId: '11', proponentId: '101' }, input: unknown = body) => ({
  db, params, readBody: async () => input,
  auth: { userId: '9', userAbilities: { authorize: () => manager } },
  writeAuthorization: { lockAuthState: async () => undefined,
    authorizeCurrentScope: async () => { if (denied) throw new Error('Scope denied') } }
} as unknown as GcsExtensionRouteContext)
const transport = vi.fn<typeof fetch>()
const org = (id = 'N-ABCDE', active = true) => ({ id, active, name: `Organization ${id}`, description: 'Description',
  ownerName: 'Owner', ownerEmail: 'owner@example.com', memberCount: 2, agreementCount: 1,
  verified: false, foreignApplicantRecipientId: null })
const cache = async (id = 'N-ABCDE', agency = 11, active = true) => {
  await sql`INSERT INTO extensions.gcs_ssc_portal_connector_organization
    (agency_id,portal_organization_id,name,active) VALUES (${agency},${id},${`Organization ${id}`},${active})`.execute(db)
}
const link = async (id = 'N-ABCDE', proponent = 101, active = true) => {
  await sql`INSERT INTO extensions.gcs_ssc_portal_connector_verification
    (portal_organization_id,proponent_id,origin_agency_id,portal_active) VALUES (${id},${proponent},22,${active})`.execute(db)
}
beforeAll(async () => {
  await executeFixtureSql(`CREATE SCHEMA extensions;
    CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY,_deleted boolean DEFAULT false);
    INSERT INTO "Agency_Profile" VALUES (11,false),(22,false);
    CREATE TABLE "Applicant_Recipient_Profile" (id bigint PRIMARY KEY,_deleted boolean DEFAULT false);
    INSERT INTO "Applicant_Recipient_Profile" VALUES (101,false),(102,false),(103,true);
    CREATE TABLE "user" (id bigint PRIMARY KEY,name text,email text);
    CREATE TABLE "Transfer_Payment_Profile" (id bigint PRIMARY KEY,egcs_tp_agency bigint,_deleted boolean DEFAULT false);
    INSERT INTO "Transfer_Payment_Profile" VALUES (301,11,false),(302,22,false);
    CREATE TABLE "Transfer_Payment_Stream" (id bigint PRIMARY KEY,egcs_tp_transferpaymentprofile bigint,_deleted boolean DEFAULT false);
    INSERT INTO "Transfer_Payment_Stream" VALUES (401,301,false),(402,302,false);
    CREATE TABLE "Funding_Case_Agreement_Profile" (id bigint PRIMARY KEY,egcs_fc_transferpaymentstream bigint,_deleted boolean DEFAULT false);
    INSERT INTO "Funding_Case_Agreement_Profile" VALUES (201,401,false),(202,402,false),(203,401,true);
    CREATE TABLE "Funding_Case_Agreement_Applicant_Recipient" (egcs_fc_fundingagreement bigint,egcs_fc_applicantrecipient bigint,_deleted boolean DEFAULT false);
    INSERT INTO "Funding_Case_Agreement_Applicant_Recipient" VALUES (201,101,false),(202,101,false),(203,101,false);
    CREATE TABLE extensions.agency_enablement (agency_id bigint,extension_key text,enabled boolean,_deleted boolean,config jsonb);
    INSERT INTO extensions.agency_enablement VALUES (11,'gcs-ssc-portal-connector',true,false,'{}');
    CREATE TABLE extensions.gcs_ssc_portal_connector_identity (agency_id bigint,portal_organization_id text,proponent_id bigint,
      verified_at timestamptz DEFAULT now(),PRIMARY KEY(agency_id,portal_organization_id),UNIQUE(agency_id,proponent_id));
    CREATE TABLE extensions.gcs_ssc_portal_connector_outbox (id bigserial PRIMARY KEY,agency_id bigint,agreement_id bigint,
      portal_organization_id text,proponent_id bigint,state text DEFAULT 'pending' CHECK(state IN ('pending','leased','delivered')),
      last_error text,delivered_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE extensions.gcs_ssc_portal_connector_connection (agency_id bigint PRIMARY KEY,portal_url text,portal_agency_id text);
    INSERT INTO extensions.gcs_ssc_portal_connector_connection VALUES (11,'https://portal.example/','G-ABCDE');
    CREATE TABLE extensions.secret_entry (id bigserial PRIMARY KEY,extension_key text,owner_type text,owner_id text,secret_key text,
      ciphertext text,iv text,auth_tag text,algorithm text,key_version integer,metadata jsonb,
      created_at timestamptz DEFAULT now(),updated_at timestamptz,_deleted boolean DEFAULT false)`)
  await migration7.up(db)
  await migration10.up(db)
  await setEncryptedExtensionSecret(asConnectorDb(db), { rootKey, extensionKey: 'gcs-ssc-portal-connector', ownerType: 'agency',
    ownerId: '11', secretKey: 'portal-key', value: { key: `gcs_${'a'.repeat(43)}` } })
}, 30_000)
beforeEach(async () => {
  denied = false; manager = true
  transport.mockReset().mockImplementation(async () => Response.json({}))
  vi.stubGlobal('fetch', transport)
  vi.stubEnv('GCS_EXTENSION_SECRETS_KEY', rootKey)
  await executeFixtureSql(`TRUNCATE extensions.gcs_ssc_portal_connector_organization,extensions.gcs_ssc_portal_connector_verification,
    extensions.gcs_ssc_portal_connector_identity,extensions.gcs_ssc_portal_connector_outbox,extensions.gcs_ssc_portal_connector_operation;
    UPDATE extensions.agency_enablement SET config='{}'`)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(async () => { await db.destroy() })

describe('organization synchronization and verification', () => {
  it('delivers verification durably and queues only live Agreements in the current agency', async () => {
    await cache()
    expect(await verifyOrganization(context())).toEqual({ verified: true, queued: 1 })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(String(transport.mock.calls[0]?.[0])).toContain('/organizations/N-ABCDE/verify')
    expect((await sql`SELECT verification_note,verified_by_user_id FROM extensions.gcs_ssc_portal_connector_verification`.execute(db)).rows)
      .toEqual([{ verification_note: 'Checked documents.', verified_by_user_id: '9' }])
    expect((await sql`SELECT agreement_id::text FROM extensions.gcs_ssc_portal_connector_outbox`.execute(db)).rows).toEqual([{ agreement_id: '201' }])
    expect(await verifyOrganization(context())).toEqual({ verified: true, queued: 1 })
    expect((await sql`SELECT count(*)::text AS count FROM extensions.gcs_ssc_portal_connector_identity`.execute(db)).rows).toEqual([{ count: '1' }])
  })
  it.each(['103', '999'])('rejects deleted or absent Proponent %s', async proponentId => {
    await cache()
    await expect(verifyOrganization(context(undefined, { ...body, proponentId }))).rejects.toThrow('does not exist')
    expect(transport).not.toHaveBeenCalled()
  })
  it.each([false, true])('rejects inactive or other-agency organization (%s)', async otherAgency => {
    await cache('N-ABCDE', otherAgency ? 22 : 11, otherAgency)
    await expect(verifyOrganization(context())).rejects.toThrow('Choose an active')
    expect(transport).not.toHaveBeenCalled()
  })
  it('validates page identity, payloads and scope IDs', async () => {
    await expect(verifyProponentOrganization(context({ agencyId: '11', proponentId: '102' }))).rejects.toThrow('does not match')
    await expect(verifyOrganization(context(undefined, { ...body, note: ' ' }))).rejects.toThrow()
    await expect(listProponentVerifications(context({ agencyId: '11', proponentId: '0' }))).rejects.toThrow('valid Proponent')
    await expect(listOrganizations(context({ agencyId: '0', proponentId: '101' }))).rejects.toThrow('valid agency')
  })
  it.each(['global', 'replacement', 'local'])('rejects %s identity conflicts before delivery', async mode => {
    await cache()
    if (mode === 'global') await link('N-ABCDE', 102)
    if (mode === 'replacement') await link('N-BCDEF')
    if (mode === 'local') await sql`INSERT INTO extensions.gcs_ssc_portal_connector_identity
      (agency_id,portal_organization_id,proponent_id) VALUES (11,'N-ABCDE',102)`.execute(db)
    await expect(verifyOrganization(context())).rejects.toThrow(mode === 'replacement' ? 'previous Portal' : 'already linked')
    expect(transport).not.toHaveBeenCalled()
  })
  it.each(['off', 'manager', 'contributor'])('enforces Proponent page configuration %s', async access => {
    await cache()
    await sql`UPDATE extensions.agency_enablement SET config=${JSON.stringify({ portalProponentVerificationAccess: access })}::jsonb`.execute(db)
    manager = false
    if (access === 'contributor') expect(await verifyProponentOrganization(context())).toEqual({ verified: true, queued: 1 })
    else {
      await expect(verifyProponentOrganization(context())).rejects.toThrow(access === 'off' ? 'disabled' : 'Manager access')
      expect(transport).not.toHaveBeenCalled()
    }
  })
  it('permits a Manager under Manager-only configuration', async () => {
    await cache()
    await sql`UPDATE extensions.agency_enablement SET config='{"portalProponentVerificationAccess":"manager"}'`.execute(db)
    expect(await verifyProponentOrganization(context())).toEqual({ verified: true, queued: 1 })
  })
  it('rechecks host write authorization before any remote mutation or initial synchronization', async () => {
    await cache(); denied = true
    await expect(verifyOrganization(context())).rejects.toThrow('Scope denied')
    await expect(refreshOrganizations(context())).rejects.toThrow('Scope denied')
    await expect(enqueueInitialSync(context())).rejects.toThrow('Scope denied')
    expect(transport).not.toHaveBeenCalled()
    expect((await sql`SELECT * FROM extensions.gcs_ssc_portal_connector_outbox`.execute(db)).rows).toEqual([])
  })
  it('lists the agency cache with nullable verification history', async () => {
    await cache(); await cache('N-BCDEF'); await cache('N-CDEFG', 22); await link()
    const result = await listOrganizations(context())
    expect(result.organizations).toHaveLength(2)
    expect(result.organizations[0]).toMatchObject({ id: 'N-ABCDE', verified: true })
    expect(result.organizations[0]?.verifiedAt).toMatch(/^\d{4}-/)
    expect(result.organizations[1]).toMatchObject({ id: 'N-BCDEF', verified: false, verifiedAt: null })
  })
  it('paginates and updates caches, attaches global verification and cancels inactive work', async () => {
    await cache(); await cache('N-BCDEF'); await cache('N-CDEFG', 22)
    await link('N-BCDEF', 102); await link('N-ABCDE', 101, false)
    await sql`INSERT INTO extensions.gcs_ssc_portal_connector_outbox
      (agency_id,agreement_id,portal_organization_id,proponent_id) VALUES (11,201,'N-BCDEF',102)`.execute(db)
    transport.mockImplementation(async (url, options) => options?.method === 'POST' ? Response.json({}) :
      Response.json({ organizations: String(url).includes('after=') ? [org('N-DEFGH', false)] : [org()],
        nextAfter: String(url).includes('after=') ? null : 'next cursor' }))
    expect(await refreshOrganizations(context())).toEqual({ synced: 2 })
    expect(transport.mock.calls.some(call => String(call[0]).includes('after=next%20cursor'))).toBe(true)
    expect((await sql`SELECT portal_active FROM extensions.gcs_ssc_portal_connector_verification ORDER BY portal_organization_id`.execute(db)).rows)
      .toEqual([{ portal_active: true }, { portal_active: false }])
    expect((await sql`SELECT state FROM extensions.gcs_ssc_portal_connector_outbox ORDER BY id`.execute(db)).rows)
      .toEqual([{ state: 'cancelled' }, { state: 'pending' }])
    expect((await listOrganizations(context())).organizations.find(item => item.id === 'N-BCDEF')?.active).toBe(false)
    expect((await listOrganizations(context({ agencyId: '22', proponentId: '101' }))).organizations[0]?.active).toBe(true)
    expect(await enqueueInitialSync(context())).toEqual({ queued: 1 })
  })
  it('handles empty catalogs while retaining cache and verification evidence', async () => {
    await cache(); await link()
    transport.mockImplementation(async () => Response.json({ organizations: [], nextAfter: null }))
    expect(await refreshOrganizations(context())).toEqual({ synced: 0 })
    expect((await listOrganizations(context())).organizations[0]).toMatchObject({ active: false, verified: true })
    expect((await sql`SELECT portal_active FROM extensions.gcs_ssc_portal_connector_verification`.execute(db)).rows).toEqual([{ portal_active: false }])
  })
  it('rejects repeated cursors before persisting partial data', async () => {
    transport.mockImplementation(async () => Response.json({ organizations: [org()], nextAfter: 'again' }))
    await expect(refreshOrganizations(context())).rejects.toThrow('repeated a cursor')
    expect(transport).toHaveBeenCalledTimes(2)
    expect((await listOrganizations(context())).organizations).toEqual([])
  })
  it('enforces the pagination limit without persisting partial data', async () => {
    let page = 0
    transport.mockImplementation(async () => Response.json({ organizations: [], nextAfter: String(++page) }))
    await expect(refreshOrganizations(context())).rejects.toThrow('pagination limit')
    expect(transport).toHaveBeenCalledTimes(1000)
    expect((await listOrganizations(context())).organizations).toEqual([])
  })
})
