import { createServer, type Server } from 'node:http'
import { createApp, createRouter, toNodeListener, type H3Event } from 'h3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { asConnectorDb, type ConnectorDatabase } from '../server/db.ts'
import { capturePortalWrite, drainOperations, PortalOperationPendingError, queuePortalClient } from '../server/operations.ts'
import { pullDueAgencies } from '../server/pull.ts'
import { drainOutbox, enqueueAgreement } from '../server/outbox.ts'
import { drainOutcomeOutbox } from '../server/outcomes.ts'
import { syncPortal } from '../server/sync.ts'
import { importSurvey } from '../server/survey-import.ts'
import { migrateQueueFixture, resetQueueFixture } from './fixtures/queue-database.ts'
import organizationSync from '../server/api/organization-sync.post.ts'
import connectionSave from '../server/api/connection.put.ts'
import organizationVerify from '../server/api/organizations.post.ts'

const nativeFetch = fetch
const rootKey = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
const connection = { portalUrl: 'https://portal.example/', portalAgencyId: 'G-ABCDE', portalKey: `gcs_${'a'.repeat(43)}` }
const namespaceError = 'The Portal connection changed. Reload before retrying this change.'

/** @returns A deterministic remote-settlement barrier. */
const deferred = () => {
  let resolve = () => {}
  const promise = new Promise<void>(complete => {
    resolve = complete
  })
  return { promise, resolve }
}
const organization = { id: 'N-ABCDE', name: 'Original organization', description: '', active: true, verified: false,
  ownerName: 'Owner', ownerEmail: 'owner@example.test', memberCount: 1, agreementCount: 0,
  foreignApplicantRecipientId: null }
const update = { eventId: '71', kind: 'organization_detail', submissionId: 'submission-1',
  itemSubmissionId: null, detailId: 'detail-1', createdAt: '2026-11-11T00:00:00.000Z',
  consumedAt: null, remoteReference: null }
const definition = { schemaVersion: 3, title: { en: 'Report', fr: 'Rapport' },
  questions: [{ id: 'title', type: 'text', label: { en: 'Title', fr: 'Titre' }, required: true, maxLength: 500 }],
  pages: [{ id: 'page_1', title: { en: 'Details', fr: 'Détails' }, questionIds: ['title'], groups: [], branches: [] }] }

describe('captured Portal namespace at local admission', () => {
  let db: Kysely<ConnectorDatabase>
  let server: Server
  let origin: string
  let denied = false
  const transport = vi.fn<typeof fetch>()

  /** @returns A current host authorization fixture with real local transactions. */
  const context = (): GcsExtensionRouteContext => ({
    db, params: { agencyId: '11' }, config: {}, agencyConfig: {},
    event: { context: { $db: db } }, readBody: async () => { throw new Error('No body read in this fixture') }, getHeader: () => undefined,
    writeAuthorization: {
      lockAuthState: async () => undefined,
      authorizeCurrentEntity: async () => { throw new Error('Unexpected entity fallback') },

      /**
       * @param transaction - Current protected transaction.
       */
      authorizeCurrentScope: async transaction => {
        if (denied) throw new Error('Current scope denied')
        const enabled = (await sql`SELECT agency_id FROM extensions.agency_enablement
          WHERE agency_id=11 AND enabled=true`.execute(asConnectorDb(transaction))).rows[0]
        if (!enabled) throw new Error('Current extension disabled')
      }
    }
  })
  const call = (path: string, method = 'POST', body: unknown = {}) => nativeFetch(`${origin}/agencies/11${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  const replace = async (replacement: object) => {
    const response = await call('/connection', 'PUT', { ...connection, ...replacement })
    expect(response.status).toBe(200)
  }
  const cacheRows = () => db.selectFrom('extensions.gcs_ssc_portal_connector_organization')
    .select(['portal_organization_id', 'name', 'active']).where('agency_id', '=', '11').execute()

  beforeAll(async () => {
    db = new Kysely<ConnectorDatabase>({ dialect: new KyselyPGlite({ parsers: { 20: value => value } }).dialect })
    await migrateQueueFixture(db)
    await sql`ALTER TABLE "Applicant_Recipient_Profile" ADD COLUMN _deleted boolean DEFAULT false`.execute(db)
    await sql`ALTER TABLE "Funding_Case_Agreement_Profile" ADD COLUMN egcs_fc_transferpaymentstream bigint,
      ADD COLUMN _deleted boolean DEFAULT false`.execute(db)
    await sql`ALTER TABLE "Funding_Case_Agreement_Applicant_Recipient" ADD COLUMN egcs_fc_fundingagreement bigint,
      ADD COLUMN egcs_fc_applicantrecipient bigint, ADD COLUMN _deleted boolean DEFAULT false`.execute(db)
    await sql`CREATE TABLE "Transfer_Payment_Profile"(id bigint PRIMARY KEY,egcs_tp_agency bigint,_deleted boolean DEFAULT false)`.execute(db)
    await sql`CREATE TABLE "Transfer_Payment_Stream"(id bigint PRIMARY KEY,egcs_tp_transferpaymentprofile bigint,_deleted boolean DEFAULT false)`.execute(db)
    await sql`INSERT INTO "Transfer_Payment_Profile" VALUES (301,11,false)`.execute(db)
    await sql`INSERT INTO "Transfer_Payment_Stream" VALUES (401,301,false)`.execute(db)
    await sql`UPDATE "Funding_Case_Agreement_Profile" SET egcs_fc_transferpaymentstream=401 WHERE id=201`.execute(db)
    await sql`INSERT INTO "Funding_Case_Agreement_Applicant_Recipient" VALUES (1,201,101,false)`.execute(db)
    await sql`ALTER TABLE "Funding_Case_Agreement_Profile" ADD COLUMN egcs_fc_agreementnumber text DEFAULT 'A-201',
      ADD COLUMN egcs_fc_title_en text DEFAULT 'Agreement', ADD COLUMN egcs_fc_title_fr text DEFAULT 'Entente',
      ADD COLUMN egcs_fc_status bigint`.execute(db)
    await sql`ALTER TABLE "Transfer_Payment_Profile" ADD COLUMN egcs_tp_name_en text DEFAULT 'Program',
      ADD COLUMN egcs_tp_name_fr text DEFAULT 'Programme'`.execute(db)
    await sql`ALTER TABLE "Transfer_Payment_Stream" ADD COLUMN egcs_tp_name_en text DEFAULT 'Stream',
      ADD COLUMN egcs_tp_name_fr text DEFAULT 'Volet'`.execute(db)
    await sql`ALTER TABLE "Common_Status" ADD COLUMN egcs_cn_terminal boolean DEFAULT false`.execute(db)
    await sql`ALTER TABLE "Funding_Case_Agreement_Budget_Fiscal_Year"
      ADD COLUMN egcs_fc_originalbudgetfiscalyear bigint, ADD COLUMN egcs_fc_budgetversion bigint,
      ADD COLUMN egcs_fc_fiscalyear bigint, ADD COLUMN egcs_fc_fundingagreement bigint,
      ADD COLUMN _deleted boolean DEFAULT false`.execute(db)
    await sql`ALTER TABLE "Funding_Case_Agreement_Budget_Version"
      ADD COLUMN egcs_fc_iscurrent boolean DEFAULT true, ADD COLUMN egcs_fc_fundingagreement bigint,
      ADD COLUMN _deleted boolean DEFAULT false`.execute(db)
    await sql`ALTER TABLE "Funding_Case_Agreement_Budget_Line_Item"
      ADD COLUMN egcs_fc_originalbudgetlineitem bigint, ADD COLUMN egcs_fc_fundingagreementbudgetfiscalyear bigint,
      ADD COLUMN egcs_fc_organizationcostcategory bigint, ADD COLUMN egcs_fc_costsubsection text DEFAULT '', ADD COLUMN egcs_fc_costsubsection_fr text DEFAULT '',
      ADD COLUMN egcs_fc_programfunding numeric DEFAULT 10000, ADD COLUMN egcs_fc_currency text DEFAULT 'CAD',
      ADD COLUMN _deleted boolean DEFAULT false`.execute(db)
    await sql`CREATE TABLE "Agency_Fiscal_Year"(id bigint PRIMARY KEY,egcs_ay_fiscalyear integer,_deleted boolean DEFAULT false)`.execute(db)
    await sql`CREATE TABLE "Transfer_Payment_Stream_Cost_Category_Line_Item"(id bigint PRIMARY KEY,
      egcs_tp_organizationcostcategory bigint,_deleted boolean DEFAULT false,egcs_tp_active boolean DEFAULT true)`.execute(db)
    await sql`CREATE TABLE "Agency_Cost_Category_Line_Item"(id bigint PRIMARY KEY,egcs_ay_name_en text,egcs_ay_name_fr text,
      egcs_ay_organizationcostcategory bigint,_deleted boolean DEFAULT false,egcs_ay_active boolean DEFAULT true)`.execute(db)
    await sql`CREATE TABLE "Agency_Cost_Category"(id bigint PRIMARY KEY,egcs_ay_name_en text,
      _deleted boolean DEFAULT false,egcs_ay_active boolean DEFAULT true)`.execute(db)
    await sql`INSERT INTO "Agency_Fiscal_Year" VALUES (41,2026,false)`.execute(db)
    await sql`INSERT INTO "Funding_Case_Agreement_Budget_Version"(id,egcs_fc_fundingagreement) VALUES (51,201)`.execute(db)
    await sql`INSERT INTO "Funding_Case_Agreement_Budget_Fiscal_Year"
      (id,egcs_fc_budgetversion,egcs_fc_fiscalyear,egcs_fc_fundingagreement) VALUES (61,51,41,201)`.execute(db)
    await sql`INSERT INTO "Agency_Cost_Category"(id,egcs_ay_name_en) VALUES (71,'Costs')`.execute(db)
    await sql`INSERT INTO "Agency_Cost_Category_Line_Item"(id,egcs_ay_name_en,egcs_ay_name_fr,egcs_ay_organizationcostcategory)
      VALUES (81,'Equipment','Équipement',71)`.execute(db)
    await sql`INSERT INTO "Transfer_Payment_Stream_Cost_Category_Line_Item"(id,egcs_tp_organizationcostcategory) VALUES (91,81)`.execute(db)
    await sql`INSERT INTO "Funding_Case_Agreement_Budget_Line_Item"
      (id,egcs_fc_fundingagreementbudgetfiscalyear,egcs_fc_organizationcostcategory) VALUES (101,61,91)`.execute(db)
    const app = createApp()
    app.use(event => {
      event.context.$db = db
      event.context.params = { agencyId: '11' }
      event.context.$authContext = { userId: '9', userAbilities: { authorize: () => true } }
      event.context.gcsExtension = { extensionKey: 'gcs-ssc-portal-connector', writeAuthorization: context().writeAuthorization }
    })
    const router = createRouter()
    /**
     * @param event - Real H3 event receiving the fixture database.
     * @returns The same native event with an explicitly typed injected database.
     */
    const withDatabase = (event: H3Event) => Object.assign(event, {
      context: Object.assign(event.context, { $db: db })
    })
    router.post('/agencies/:agencyId/organization-sync', event => organizationSync(withDatabase(event)))
    router.put('/agencies/:agencyId/connection', event => connectionSave(withDatabase(event)))
    router.post('/agencies/:agencyId/organizations', event => organizationVerify(withDatabase(event)))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing native HTTP listener')
    origin = `http://127.0.0.1:${address.port}`
  }, 30_000)
  beforeEach(async () => {
    denied = false
    vi.stubEnv('GCS_EXTENSION_SECRETS_KEY', rootKey)
    await resetQueueFixture(db)
    await sql`TRUNCATE extensions.gcs_ssc_portal_connector_organization,
      extensions.gcs_ssc_portal_connector_form, extensions.gcs_ssc_portal_connector_publication CASCADE`.execute(db)
    transport.mockReset().mockImplementation(async () => Response.json({ programs: [], streams: [], calls: [] }))
    vi.stubGlobal('fetch', transport)
    await replace({})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await db.destroy()
  })

  it.each([{ portalUrl: 'https://replacement.example/' }, { portalAgencyId: 'G-FGHJK' }])(
    'rejects old native organization refresh after namespace replacement %j', async replacement => {
      const entered = deferred()
      const release = deferred()
      transport.mockImplementation(async (input, request) => {
        const url = new URL(String(input))
        if (request?.method === 'GET' && url.pathname.endsWith('/organizations')) {
          entered.resolve()
          await release.promise
          return Response.json({ organizations: [organization], nextAfter: null })
        }
        return Response.json({ programs: [], streams: [], calls: [] })
      })
      const pending = call('/organization-sync')
      try {
        await entered.promise
        await replace(replacement)
        release.resolve()
        expect((await pending).status).toBe(500)
        expect(await cacheRows()).toEqual([])
        expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_identity').selectAll().execute()).toEqual([])
        expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_outbox').selectAll().execute()).toEqual([])
        expect((await call('/organizations', 'POST', {
          organizationId: organization.id, proponentId: '101', note: 'Confirmed original documents'
        })).status).toBe(500)
        expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation').selectAll().execute()).toEqual([])
      } finally {
        release.resolve()
        await pending
      }
    })

  it('adopts same-namespace catalog evidence after normalized origin and credential rotation, then verifies durably', async () => {
    const entered = deferred()
    const release = deferred()
    transport.mockImplementation(async (input, request) => {
      if (request?.method === 'GET' && new URL(String(input)).pathname.endsWith('/organizations')) {
        entered.resolve()
        await release.promise
        return Response.json({ organizations: [organization], nextAfter: null })
      }
      return Response.json(request?.method === 'GET' ? { programs: [], streams: [], calls: [] } : {})
    })
    const pending = call('/organization-sync')
    try {
      await entered.promise
      await replace({ portalUrl: 'https://PORTAL.example:443/', portalKey: `gcs_${'b'.repeat(43)}` })
      release.resolve()
      expect((await pending).status).toBe(200)
      expect(await cacheRows()).toEqual([{ portal_organization_id: organization.id, name: organization.name, active: true }])
      expect((await call('/organizations', 'POST', {
        organizationId: organization.id, proponentId: '101', note: 'Confirmed original documents'
      })).status).toBe(200)
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_identity').select('proponent_id').execute())
        .toEqual([{ proponent_id: '101' }])
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation').select('state').execute())
        .toEqual([{ state: 'delivered' }])
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_outbox').select('agreement_id').execute())
        .toEqual([{ agreement_id: '201' }])
    } finally {
      release.resolve()
      await pending
    }
  })

  it.each(['permission', 'enablement'])('rechecks fresh %s before catalog adoption', async mode => {
    const entered = deferred()
    const release = deferred()
    transport.mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return Response.json({ organizations: [organization], nextAfter: null })
    })
    const pending = call('/organization-sync')
    try {
      await entered.promise
      if (mode === 'permission') denied = true
      else await sql`UPDATE extensions.agency_enablement SET enabled=false WHERE agency_id=11`.execute(db)
      release.resolve()
      expect((await pending).status).toBe(500)
      expect(await cacheRows()).toEqual([])
    } finally {
      release.resolve()
      await pending
    }
  })

  it.each(['updates', 'response'])('rejects old staff %s evidence before inbox/receipt/cursor adoption', async held => {
    const entered = deferred()
    const release = deferred()
    transport.mockImplementation(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith(`/${held}`)) {
        entered.resolve()
        await release.promise
      }
      if (path.endsWith('/updates')) return Response.json({ updates: [update], nextCursor: null })
      if (path.endsWith('/response')) return Response.json({ documentation: 'Original namespace' })
      return Response.json({ programs: [], streams: [], calls: [] })
    })
    const pending = syncPortal(context())
    const settled = pending.then(value => ({ value }), error => ({ error }))
    try {
      await entered.promise
      await replace({ portalUrl: 'https://replacement.example/' })
      release.resolve()
      expect(await settled).toMatchObject({ error: { message: namespaceError } })
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_receipt').selectAll().execute()).toEqual([])
      const inbox = await db.selectFrom('extensions.gcs_ssc_portal_connector_inbox').select(['event_id', 'last_error']).execute()
      expect(inbox).toEqual(held === 'updates' ? [] : [{ event_id: update.eventId, last_error: null }])
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_connection').select('scan_cursor')
        .where('agency_id', '=', '11').executeTakeFirst()).toEqual({ scan_cursor: null })
    } finally {
      release.resolve()
      await settled
    }
  })

  it('retains ordinary unsupported receipt evidence and advances only the captured current feed', async () => {
    transport.mockImplementation(async input => Response.json(new URL(String(input)).pathname.endsWith('/updates')
      ? { updates: [update], nextCursor: null }
      : { documentation: 'Original namespace' }))
    expect((await syncPortal(context())).pending).toHaveLength(1)
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_receipt').select(['kind', 'state']).execute())
      .toEqual([{ kind: 'organization_detail', state: 'unsupported' }])
  })

  it('rejects old survey receipt adoption through the required captured import writer', async () => {
    const client = queuePortalClient(db, '11', { ...connection, key: connection.portalKey }, { kind: 'route', context: context() })
    await replace({ portalAgencyId: 'G-FGHJK' })
    const item = { kind: 'survey', itemSubmissionId: 'item-1', answers: { title: 'Original' },
      survey: { id: 'form', kind: 'survey', surveyId: 'V-ABCDE', surveyRevision: 1 }, definition }
    await expect(importSurvey(context(), '11', { ...update, kind: 'submission_item', itemSubmissionId: item.itemSubmissionId }, {
      schemaVersion: 2, submissionId: update.submissionId, organizationId: organization.id,
      sourceSystem: 'gcs-ssc-form', agreementReference: null, items: [item]
    }, client, 'original-portal', client.write)).rejects.toThrow(namespaceError)
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_receipt').selectAll().execute()).toEqual([])
  })

  it('binds local admission to immutable normalized origin and Portal Agency strings', async () => {
    const captured = { portalUrl: connection.portalUrl, portalAgencyId: connection.portalAgencyId }
    const write = capturePortalWrite(db, '11', captured, { kind: 'route', context: context() })
    captured.portalUrl = 'https://replacement.example/'
    await replace({ portalUrl: captured.portalUrl })
    await expect(write(async transaction => transaction.insertInto('extensions.gcs_ssc_portal_connector_identity')
      .values({ agency_id: '11', portal_organization_id: organization.id, proponent_id: '101' }).execute()))
      .rejects.toThrow(namespaceError)
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_identity').selectAll().execute()).toEqual([])
  })

  it.each(['namespace', 'enablement'])('rejects old background feed after %s replacement without stale feedback', async mode => {
    await sql`UPDATE extensions.gcs_ssc_portal_connector_connection SET pull_interval_minutes=NULL WHERE agency_id=22`.execute(db)
    const entered = deferred()
    const release = deferred()
    transport.mockImplementation(async input => {
      if (new URL(String(input)).pathname.endsWith('/updates')) {
        entered.resolve()
        await release.promise
        return Response.json({ updates: [update], nextCursor: null })
      }
      return Response.json({ programs: [], streams: [], calls: [] })
    })
    const pending = pullDueAgencies(db)
    try {
      await entered.promise
      if (mode === 'namespace') await replace({ portalAgencyId: 'G-FGHJK' })
      else await sql`UPDATE extensions.agency_enablement SET enabled=false WHERE agency_id=11`.execute(db)
      release.resolve()
      expect((await pending).results[0]).toMatchObject({ agencyId: '11', found: 0, error: expect.any(String) })
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_inbox').selectAll().execute()).toEqual([])
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_connection').select('last_pull_error')
        .where('agency_id', '=', '11').executeTakeFirst()).toEqual({ last_pull_error: null })
    } finally {
      release.resolve()
      await pending
    }
  })

  it('does not adopt a delivered form identity or response after an external namespace replacement', async () => {
    await db.insertInto('extensions.gcs_ssc_portal_connector_form').values({ id: 'V-ABCDE', agency_id: '11',
      definition, revision: 1, portal_id: null, portal_revision: null }).execute()
    await db.insertInto('extensions.gcs_ssc_portal_connector_operation').values({ agency_id: '11', kind: 'form',
      method: null, path: null, body: { definition, revision: 1 }, form_id: 'V-ABCDE',
      last_error: null, response: null, delivered_at: null }).execute()
    const entered = deferred()
    const release = deferred()
    transport.mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return Response.json({ survey: { id: 'V-FGHJK', revision: 1 } })
    })
    const pending = drainOperations(db, 1, '11')
    try {
      await entered.promise
      // Ordinary connection save refuses nondelivered operations; this models an external repair.
      await sql`UPDATE extensions.gcs_ssc_portal_connector_connection SET portal_url='https://replacement.example/' WHERE agency_id=11`.execute(db)
      release.resolve()
      expect((await pending).results[0]).toMatchObject({ delivered: false, error: namespaceError })
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_form').select(['portal_id', 'portal_revision']).execute())
        .toEqual([{ portal_id: null, portal_revision: null }])
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation').select(['state', 'response', 'last_error']).execute())
        .toEqual([{ state: 'leased', response: null, last_error: null }])
    } finally {
      release.resolve()
      await pending
    }
  })

  it.each([false, true])('settles real publication and Agreement outbox evidence only in its captured namespace (replace=%s)', async replacement => {
    await db.insertInto('extensions.gcs_ssc_portal_connector_verification').values({
      portal_organization_id: organization.id, proponent_id: '101', origin_agency_id: '11',
      verification_note: null, verified_by_user_id: null, portal_active: true
    }).execute()
    await enqueueAgreement(db, '11', '201', organization.id, '101')
    const entered = deferred()
    const release = deferred()
    transport.mockImplementation(async (input, request) => {
      const path = new URL(String(input)).pathname
      if (request?.method === 'GET' && path.endsWith('/sets')) {
        entered.resolve()
        await release.promise
        return Response.json({ sets: ['claim', 'forecast'].map((kind, index) => ({
          id: `R-${index}`, organizationId: organization.id, agreementId: 'A-ABCDE', published: true,
          revision: 1, sourceSystem: 'gcs-ssc-portal-connector', foreignSystemId: null,
          snapshot: { agreement: { revision: 1 } }, items: [{ id: kind, kind, fiscalYearId: '61' }]
        })) })
      }
      if (request?.method === 'GET' && path.endsWith('/agreements')) return Response.json({ agreements: [] })
      if (request?.method === 'GET') return Response.json({
        programs: [{ id: 'P-ABCDE', sourceSystem: 'gcs-ssc', foreignSystemId: '301' }],
        streams: [{ id: 'S-ABCDE', nameEn: 'Stream', nameFr: 'Volet', sourceSystem: 'gcs-ssc', foreignSystemId: '401' }], calls: []
      })
      return Response.json(path.endsWith('/agreements') ? { agreement: { id: 'A-ABCDE' } } : {})
    })
    const pending = drainOutbox(db, 1, '11')
    try {
      await entered.promise
      if (replacement) await sql`UPDATE extensions.gcs_ssc_portal_connector_connection
        SET portal_agency_id='G-FGHJK' WHERE agency_id=11`.execute(db)
      release.resolve()
      expect((await pending).results[0]).toMatchObject({ delivered: !replacement })
      const publications = await db.selectFrom('extensions.gcs_ssc_portal_connector_publication')
        .select('portal_agreement_id').execute()
      expect(publications).toEqual(replacement ? [] : [{ portal_agreement_id: 'A-ABCDE' }])
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_outbox').select(['state', 'last_error']).execute())
        .toEqual([{ state: replacement ? 'leased' : 'delivered', last_error: null }])
    } finally {
      release.resolve()
      await pending
    }
  })

  it.each([false, true])('settles outcome evidence after a response-only no-op only in its captured namespace (replace=%s)', async replacement => {
    await sql`INSERT INTO "Funding_Case_Agreement_Claim"(id,egcs_fc_status) VALUES (301,401)`.execute(db)
    const receipt = await db.insertInto('extensions.gcs_ssc_portal_connector_receipt').values({
      agency_id: '11', event_id: '71', submission_id: 'submission-1', item_submission_id: 'item-1',
      kind: 'claim', source_export: {}, gcs_entity_type: 'fundingcaseagreementclaim', gcs_entity_id: '301', state: 'imported'
    }).returning('id').executeTakeFirstOrThrow()
    const queued = await db.selectFrom('extensions.gcs_ssc_portal_connector_outcome_outbox').select('id')
      .where('receipt_id', '=', String(receipt.id)).executeTakeFirst()
    if (!queued) await db.insertInto('extensions.gcs_ssc_portal_connector_outcome_outbox').values({
      agency_id: '11', receipt_id: String(receipt.id), status_id: '401', last_error: null, delivered_at: null
    }).execute()
    const entered = deferred()
    const release = deferred()
    transport.mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return Response.json({ outcomes: [{ itemSubmissionId: 'item-1', remoteReference: '301', revision: 1, gcsStatus: null }] })
    })
    const pending = drainOutcomeOutbox(db, 1, '11')
    try {
      await entered.promise
      if (replacement) await sql`UPDATE extensions.gcs_ssc_portal_connector_connection
        SET portal_url='https://replacement.example/' WHERE agency_id=11`.execute(db)
      release.resolve()
      expect((await pending).results[0]).toMatchObject({ delivered: !replacement })
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_outcome_outbox').select(['state', 'last_error']).execute())
        .toEqual([{ state: replacement ? 'leased' : 'delivered', last_error: null }])
      expect(transport.mock.calls.every(([, request]) => request?.method === 'GET')).toBe(true)
    } finally {
      release.resolve()
      await pending
    }
  })

  it('returns successful dispatch and its stored response without adopting an error variant', async () => {
    transport.mockClear().mockResolvedValue(Response.json({ id: 'D-ABCDE' }))
    const client = queuePortalClient(db, '11', { ...connection, key: connection.portalKey },
      { kind: 'worker' }, 'result-variant-success')
    expect(await client.createCall({ nameEn: 'First' })).toBe('D-ABCDE')
    expect(await client.createCall({ nameEn: 'First' })).toBe('D-ABCDE')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation').select(['state', 'response']).execute())
      .toEqual([{ state: 'delivered', response: { id: 'D-ABCDE' } }])
  })

  it('keeps actual delivery failure and queued/deferred work out of the success path', async () => {
    transport.mockClear().mockImplementation(async () => Response.json({}, { status: 503 }))
    const client = queuePortalClient(db, '11', { ...connection, key: connection.portalKey }, { kind: 'worker' })
    const failed = client.createCall({ nameEn: 'First' })
    await expect(failed).rejects.toBeInstanceOf(PortalOperationPendingError)
    await expect(failed).rejects.toThrow('Portal request failed (503) at calls.')
    const queued = client.createCall({ nameEn: 'Second' })
    await expect(queued).rejects.toBeInstanceOf(PortalOperationPendingError)
    await expect(queued).rejects.toThrow('Portal operation is queued behind an earlier delivery.')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation')
      .select(['state', 'response']).orderBy('id').execute())
      .toEqual([{ state: 'pending', response: null }, { state: 'pending', response: null }])
  })

  it.each(['lease', 'namespace'])('rejects actual %s retirement after queued dispatch rather than returning success', async retirement => {
    const entered = deferred()
    const release = deferred()
    transport.mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return Response.json({ id: 'D-ABCDE' })
    })
    const client = queuePortalClient(db, '11', { ...connection, key: connection.portalKey }, { kind: 'worker' })
    const settled = client.createCall({ nameEn: 'First' }).then(value => ({ value }), error => ({ error }))
    try {
      await entered.promise
      if (retirement === 'lease') await sql`UPDATE extensions.gcs_ssc_portal_connector_operation
        SET attempts=attempts+1 WHERE state='leased'`.execute(db)
      else await sql`UPDATE extensions.gcs_ssc_portal_connector_connection
        SET portal_url='https://replacement.example/' WHERE agency_id=11`.execute(db)
      release.resolve()
      const result = await settled
      expect(result).not.toHaveProperty('value')
      expect(result).toHaveProperty('error', expect.any(PortalOperationPendingError))
      expect(result).toMatchObject({ error: { message: retirement === 'lease'
        ? 'Portal operation lease expired.'
        : namespaceError } })
      expect(await db.selectFrom('extensions.gcs_ssc_portal_connector_operation')
        .select(['state', 'response', 'last_error']).execute())
        .toEqual([{ state: 'leased', response: null, last_error: null }])
    } finally {
      release.resolve()
      await settled
    }
  })
})
