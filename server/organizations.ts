import { sql } from 'kysely'
import { z } from 'zod'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { agencyIdFromContext, authorizedWrite } from './authorization.ts'
import { readPortalCredential } from './connection.ts'
import { asConnectorDb, type ConnectorDb } from './db.ts'
import { enqueueAgreement } from './outbox.ts'
import { queuePortalClient } from './operations.ts'

const inputSchema = z.object({
  organizationId: z.string().regex(/^N-[A-HJKMNP-Z2-9]{5,}$/),
  proponentId: z.string().regex(/^[1-9]\d{0,18}$/),
  note: z.string().trim().min(1).max(4000)
}).strict()

const portalClient = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const connection = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_connection')
    .selectAll().where('agency_id', '=', agencyId).executeTakeFirst()
  if (!connection) throw new Error('Connect the portal first.')
  return queuePortalClient(asConnectorDb(context.db), agencyId, { portalUrl: connection.portal_url,
    portalAgencyId: connection.portal_agency_id,
    key: await readPortalCredential(context, agencyId) })
}

/** Reads synchronized choices and app-wide verification history. */
export const listOrganizations = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const rows = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_organization as organization')
    .leftJoin('extensions.gcs_portal_verification as verification',
      'verification.portal_organization_id', 'organization.portal_organization_id')
    .select([
      'organization.portal_organization_id as id', 'organization.name', 'organization.description',
      'organization.owner_name as ownerName', 'organization.owner_email as ownerEmail',
      'organization.member_count as memberCount', 'organization.agreement_count as agreementCount',
      'organization.active', 'organization.synced_at as syncedAt',
      'verification.proponent_id as proponentId', 'verification.verification_note as note',
      'verification.verified_at as verifiedAt'
    ])
    .where('organization.agency_id', '=', agencyId)
    .orderBy('organization.name').execute()
  return { organizations: rows.map(row => ({ ...row,
    verified: row.proponentId !== null,
    verifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : null,
    syncedAt: new Date(row.syncedAt).toISOString()
  })) }
}

/** Reads the Proponent's global verification record independently of agency catalog caches. */
export const listProponentVerifications = async (context: GcsExtensionRouteContext) => {
  const proponentId = context.params.proponentId
  if (!proponentId || !/^[1-9]\d{0,18}$/.test(proponentId)) throw new Error('A valid Proponent is required.')
  const result = await sql<{
    organizationId: string; organizationName: string; originAgencyId: string
    note: string | null; verifiedAt: Date; active: boolean
    verifierName: string | null; verifierEmail: string | null
  }>`
    SELECT verification.portal_organization_id AS "organizationId",
      COALESCE(organization.name, verification.portal_organization_id) AS "organizationName",
      verification.origin_agency_id::text AS "originAgencyId",
      verification.verification_note AS note,
      verification.verified_at AS "verifiedAt",
      verification.portal_active AS active,
      verifier.name AS "verifierName",
      verifier.email AS "verifierEmail"
    FROM extensions.gcs_portal_verification verification
    LEFT JOIN LATERAL (
      SELECT name FROM extensions.gcs_portal_organization
      WHERE portal_organization_id = verification.portal_organization_id
      ORDER BY (agency_id = verification.origin_agency_id) DESC, synced_at DESC
      LIMIT 1
    ) organization ON true
    LEFT JOIN "user" verifier ON verifier.id::text = verification.verified_by_user_id
    WHERE verification.proponent_id = ${proponentId}::bigint
    ORDER BY verification.portal_active DESC, verification.verified_at DESC
  `.execute(asConnectorDb(context.db))
  return { verifications: result.rows.map(row => ({ ...row,
    verifiedAt: new Date(row.verifiedAt).toISOString()
  })) }
}

/** Copies the complete paginated Portal organization catalog into extension-owned storage. */
export const refreshOrganizations = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const client = await portalClient(context)
  await authorizedWrite(context, async () => undefined)
  const organizations: Awaited<ReturnType<typeof client.organizations>>['organizations'] = []
  let after: string | undefined
  const seen = new Set<string>()
  for (let page = 0; page < 1000; page++) {
    const result = await client.organizations(after)
    organizations.push(...result.organizations)
    if (!result.nextAfter) break
    if (seen.has(result.nextAfter)) throw new Error('Portal organization pagination repeated a cursor.')
    seen.add(result.nextAfter)
    after = result.nextAfter
    if (page === 999) throw new Error('Portal organization catalog exceeds the supported pagination limit.')
  }
  const activeIds = organizations.filter(item => item.active).map(item => item.id)
  const globalLinks = activeIds.length ? await asConnectorDb(context.db)
    .selectFrom('extensions.gcs_portal_verification')
    .select(['portal_organization_id', 'proponent_id'])
    .where('portal_organization_id', 'in', activeIds).execute() : []
  const localLinks = await asConnectorDb(context.db).selectFrom('extensions.gcs_portal_identity')
    .select('portal_organization_id').where('agency_id', '=', agencyId).execute()
  const localIds = new Set(localLinks.map(item => item.portal_organization_id))
  const toAttach = globalLinks.filter(item => !localIds.has(item.portal_organization_id))
  for (const link of toAttach) await client.verifyOrganization(link.portal_organization_id, link.proponent_id)
  await authorizedWrite(context, async transaction => {
    for (const organization of organizations) {
      await transaction.insertInto('extensions.gcs_portal_organization').values({
        agency_id: agencyId, portal_organization_id: organization.id,
        name: organization.name, description: organization.description,
        owner_name: organization.ownerName, owner_email: organization.ownerEmail,
        member_count: organization.memberCount, agreement_count: organization.agreementCount,
        active: organization.active
      }).onConflict(conflict => conflict.columns(['agency_id', 'portal_organization_id']).doUpdateSet({
        name: organization.name, description: organization.description,
        owner_name: organization.ownerName, owner_email: organization.ownerEmail,
        member_count: organization.memberCount, agreement_count: organization.agreementCount,
        active: organization.active, synced_at: new Date()
      })).execute()
    }
    await transaction.updateTable('extensions.gcs_portal_organization')
      .set({ active: false, synced_at: new Date() })
      .where('agency_id', '=', agencyId)
      .where('portal_organization_id', 'not in', organizations.length ? organizations.map(item => item.id) : [''])
      .execute()
    await transaction.updateTable('extensions.gcs_portal_verification')
      .set({ portal_active: false })
      .where('portal_organization_id', 'not in', activeIds.length ? activeIds : [''])
      .execute()
    for (const organization of organizations.filter(item => item.active)) {
      await sql`UPDATE extensions.gcs_portal_verification verification SET portal_active=true
        WHERE verification.portal_organization_id=${organization.id}
          AND NOT EXISTS (SELECT 1 FROM extensions.gcs_portal_verification other
            WHERE other.proponent_id=verification.proponent_id AND other.portal_active=true
              AND other.portal_organization_id<>verification.portal_organization_id)`.execute(transaction)
    }
    await sql`UPDATE extensions.gcs_portal_outbox outbox SET state='cancelled',
      last_error='Portal organization inactive', updated_at=now()
      WHERE agency_id=${agencyId}::bigint AND state='pending'
        AND EXISTS (SELECT 1 FROM extensions.gcs_portal_verification verification
          WHERE verification.portal_organization_id=outbox.portal_organization_id
            AND verification.portal_active=false)`.execute(transaction)
    for (const link of toAttach) {
      await transaction.insertInto('extensions.gcs_portal_identity').values({
        agency_id: agencyId, portal_organization_id: link.portal_organization_id,
        proponent_id: link.proponent_id
      }).onConflict(conflict => conflict.columns(['agency_id', 'portal_organization_id']).doNothing()).execute()
    }
    if (toAttach.length) await enqueueAllVerifiedAgreements(transaction, agencyId)
  })
  return { synced: organizations.length }
}

const assertProponentPageAccess = async (context: GcsExtensionRouteContext, transaction: ConnectorDb, agencyId: string) => {
  const result = await sql<{ config: unknown }>`SELECT config FROM extensions.agency_enablement
    WHERE extension_key='gcs-ssc-portal-connector' AND agency_id=${agencyId}::bigint
      AND enabled=true AND _deleted=false`.execute(transaction)
  const config = result.rows[0]?.config
  const access = config && typeof config === 'object' && 'portalProponentVerificationAccess' in config
    ? (config as { portalProponentVerificationAccess: unknown }).portalProponentVerificationAccess : 'off'
  if (access !== 'manager' && access !== 'contributor') throw new Error('Proponent verification is disabled for this agency.')
  if (access === 'manager' && !context.auth?.userAbilities.authorize('applicant_recipient', 'delete', {
    type: 'agency', agencyId
  })) throw new Error('Manager access is required to verify from a Proponent page.')
}

export const verifyOrganization = async (context: GcsExtensionRouteContext, options: { fromProponent?: boolean } = {}) => {
  const input = inputSchema.parse(await context.readBody())
  const agencyId = agencyIdFromContext(context)
  if (options.fromProponent && context.params.proponentId !== input.proponentId)
    throw new Error('The selected Proponent does not match this page.')
  const db = asConnectorDb(context.db)
  const proponent = (await sql<{ id: string }>`
    SELECT id::text FROM "Applicant_Recipient_Profile"
    WHERE id=${input.proponentId}::bigint AND _deleted=false
  `.execute(db)).rows[0]
  if (!proponent) throw new Error('The selected recipient does not exist.')
  const selectedOrganization = await db.selectFrom('extensions.gcs_portal_organization')
    .select(['portal_organization_id', 'active'])
    .where('agency_id', '=', agencyId)
    .where('portal_organization_id', '=', input.organizationId).executeTakeFirst()
  if (!selectedOrganization?.active) throw new Error('Choose an active Portal organization from the synchronized list.')
  const client = await portalClient(context)
  await authorizedWrite(context, async (transaction) => {
    if (options.fromProponent) await assertProponentPageAccess(context, transaction, agencyId)
    const globalLink = await transaction.selectFrom('extensions.gcs_portal_verification')
      .select(['proponent_id', 'portal_active'])
      .where('portal_organization_id', '=', input.organizationId).forUpdate().executeTakeFirst()
    if (globalLink && globalLink.proponent_id !== input.proponentId)
      throw new Error('This Portal organization is already linked to another GCS Proponent.')
    const otherActive = await transaction.selectFrom('extensions.gcs_portal_verification')
      .select('portal_organization_id').where('proponent_id', '=', input.proponentId)
      .where('portal_active', '=', true).executeTakeFirst()
    if (otherActive && otherActive.portal_organization_id !== input.organizationId)
      throw new Error('Make the previous Portal organization inactive before linking a replacement.')
    const existing = await transaction.selectFrom('extensions.gcs_portal_identity')
      .select('proponent_id').where('agency_id', '=', agencyId)
      .where('portal_organization_id', '=', input.organizationId).forUpdate().executeTakeFirst()
    if (existing && existing.proponent_id !== input.proponentId)
      throw new Error('This organization is already linked to another recipient.')
  })
  await client.verifyOrganization(input.organizationId, input.proponentId)
  let queued = 0
  await authorizedWrite(context, async (transaction) => {
    if (options.fromProponent) await assertProponentPageAccess(context, transaction, agencyId)
    await transaction.insertInto('extensions.gcs_portal_verification').values({
      portal_organization_id: input.organizationId, proponent_id: input.proponentId,
      origin_agency_id: agencyId, verification_note: input.note,
      verified_by_user_id: context.auth?.userId ?? null, portal_active: true
    }).onConflict(conflict => conflict.column('portal_organization_id').doNothing()).execute()
    const globalLink = await transaction.selectFrom('extensions.gcs_portal_verification')
      .select('proponent_id').where('portal_organization_id', '=', input.organizationId)
      .forUpdate().executeTakeFirstOrThrow()
    if (globalLink.proponent_id !== input.proponentId)
      throw new Error('This Portal organization is already linked to another GCS Proponent.')
    await transaction.insertInto('extensions.gcs_portal_identity').values({
      agency_id: agencyId, portal_organization_id: input.organizationId, proponent_id: input.proponentId
    }).onConflict((conflict) => conflict.columns(['agency_id', 'portal_organization_id']).doNothing()).execute()
    const agreements = (await sql<{ id: string }>`
      SELECT agreement.id::text FROM "Funding_Case_Agreement_Profile" agreement
      JOIN "Funding_Case_Agreement_Applicant_Recipient" recipient
        ON recipient.egcs_fc_fundingagreement=agreement.id AND recipient._deleted=false
      JOIN "Transfer_Payment_Stream" stream ON stream.id=agreement.egcs_fc_transferpaymentstream
      JOIN "Transfer_Payment_Profile" program ON program.id=stream.egcs_tp_transferpaymentprofile
      WHERE program.egcs_tp_agency=${agencyId}::bigint
        AND recipient.egcs_fc_applicantrecipient=${input.proponentId}::bigint
        AND agreement._deleted=false AND stream._deleted=false AND program._deleted=false
    `.execute(transaction)).rows
    for (const agreement of agreements) {
      await enqueueAgreement(transaction, agencyId, agreement.id, input.organizationId, input.proponentId)
      queued++
    }
  })
  return { verified: true, queued }
}

export const verifyProponentOrganization = async (context: GcsExtensionRouteContext) =>
  verifyOrganization(context, { fromProponent: true })

export const enqueueAllVerifiedAgreements = async (transaction: ConnectorDb, agencyId: string) => {
    const result = await sql<{ count: string }>`
      WITH queued AS (
        INSERT INTO extensions.gcs_portal_outbox
          (agency_id, agreement_id, portal_organization_id, proponent_id)
        SELECT identity.agency_id, agreement.id, identity.portal_organization_id, identity.proponent_id
        FROM extensions.gcs_portal_identity identity
        JOIN extensions.gcs_portal_verification verification
          ON verification.portal_organization_id=identity.portal_organization_id
          AND verification.portal_active=true
        JOIN "Funding_Case_Agreement_Applicant_Recipient" recipient
          ON recipient.egcs_fc_applicantrecipient=identity.proponent_id AND recipient._deleted=false
        JOIN "Funding_Case_Agreement_Profile" agreement
          ON agreement.id=recipient.egcs_fc_fundingagreement AND agreement._deleted=false
        JOIN "Transfer_Payment_Stream" stream ON stream.id=agreement.egcs_fc_transferpaymentstream
        JOIN "Transfer_Payment_Profile" program ON program.id=stream.egcs_tp_transferpaymentprofile
        WHERE identity.agency_id=${agencyId}::bigint AND program.egcs_tp_agency=identity.agency_id
          AND stream._deleted=false AND program._deleted=false
        RETURNING id
      ) SELECT count(*)::text AS count FROM queued
    `.execute(transaction)
    return { queued: Number(result.rows[0]?.count ?? 0) }
}

export const enqueueInitialSync = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  return authorizedWrite(context, async (transaction) => {
    return enqueueAllVerifiedAgreements(transaction, agencyId)
  })
}
