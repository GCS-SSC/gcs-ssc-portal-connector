import { sql, type Kysely } from 'kysely'
import { setEncryptedExtensionSecret } from '@gcs-ssc/extensions/server'
import { asConnectorDb, type ConnectorDatabase } from './db.ts'
import { designerSurveySchema } from '@gcs-ssc/survey'
import { complexCommunityHealthForm } from '../demo/community-health-form.ts'
import { enqueueForm } from './operations.ts'

export const DEMO_APPLICATION_FORM_ID = 'V-HCANADA'

export interface DemoPortalOrganization {
  id: string
  name: string
  description: string
  ownerName: string
  ownerEmail: string
  memberCount: number
  agreementCount: number
  active: boolean
}

export interface DemoSeedOptions {
  portalUrl: string
  portalAgencyId: string
  portalKey: string
  secretRootKey?: string
  preconfigureConnection?: boolean
  organizations: DemoPortalOrganization[]
  seedApplicationForm?: boolean
  requireEnabled?: boolean
}

/**
 * Enables the connector first; the host applies extension migrations on its next startup.
 * @param db Connector database.
 * @param options Explicit local fixture configuration.
 * @returns Seed phase and the existing Health Canada showcase identities.
 */
export const seedHealthCanadaPortalConnector = async (
  db: Kysely<ConnectorDatabase>, options: DemoSeedOptions
): Promise<{ phase: 'restart-required' | 'ready' | 'disabled'; agencyId: string; agreementId: string; proponentId: string; proponentName: string }> => {
  return db.transaction().execute(async transaction => {
    const agency = (await sql<{ id: string }>`
      SELECT id::text FROM "Agency_Profile"
      WHERE egcs_ay_name_en='Health Canada' AND _deleted=false
    `.execute(transaction)).rows[0]
    if (!agency) throw new Error('The GCS demo seed must be loaded before the Health Canada Portal fixture.')

    const recipient = (await sql<{ agreement_id: string; proponent_id: string; proponent_name: string }>`
      SELECT agreement.id::text AS agreement_id, proponent.id::text AS proponent_id,
        proponent.egcs_ar_legalname_en AS proponent_name
      FROM "Funding_Case_Agreement_Profile" agreement
      JOIN "Funding_Case_Agreement_Applicant_Recipient" relationship
        ON relationship.egcs_fc_fundingagreement=agreement.id AND relationship._deleted=false
      JOIN "Applicant_Recipient_Profile" proponent
        ON proponent.id=relationship.egcs_fc_applicantrecipient AND proponent._deleted=false
      WHERE agreement.egcs_fc_title_en='Health Canada Cost Agreement 1 - Showcase'
        AND proponent.egcs_ar_legalname_en='Shopify Inc.' AND agreement._deleted=false
      LIMIT 1
    `.execute(transaction)).rows[0]
    if (!recipient) throw new Error('The seeded Health Canada showcase Agreement has no Shopify Inc. Proponent.')
    const enablement = (await sql<{ id: string; enabled: boolean }>`
      SELECT id::text, enabled FROM extensions.agency_enablement
      WHERE extension_key='gcs-ssc-portal-connector' AND agency_id=${agency.id}::bigint AND _deleted=false
      FOR UPDATE
    `.execute(transaction)).rows[0]
    const result = {
      agencyId: agency.id,
      agreementId: recipient.agreement_id,
      proponentId: recipient.proponent_id,
      proponentName: recipient.proponent_name
    }
    if (options.requireEnabled && !enablement?.enabled) return { phase: 'disabled' as const, ...result }
    if (enablement && !enablement.enabled) {
      await sql`UPDATE extensions.agency_enablement SET enabled=true
        WHERE id=${enablement.id}::bigint`.execute(transaction)
    } else if (!enablement) {
      await sql`INSERT INTO extensions.agency_enablement
        (extension_key,agency_id,enabled,config)
        VALUES ('gcs-ssc-portal-connector',${agency.id}::bigint,true,
          '{"portalProponentVerificationAccess":"contributor"}'::jsonb)`.execute(transaction)
    }

    const extensionTable = (await sql<{ present: boolean }>`
      SELECT to_regclass('extensions.gcs_portal_organization') IS NOT NULL AS present
    `.execute(transaction)).rows[0]?.present
    if (!extensionTable) return { phase: 'restart-required' as const, ...result }

    const connection = await transaction.selectFrom('extensions.gcs_portal_connection')
      .select('agency_id').where('agency_id', '=', agency.id).executeTakeFirst()
    if (!connection && options.preconfigureConnection) {
      if (!options.secretRootKey) throw new Error('GCS_EXTENSION_SECRETS_KEY is required to preconfigure a Portal connection.')
      await transaction.insertInto('extensions.gcs_portal_connection').values({
        agency_id: agency.id,
        portal_agency_id: options.portalAgencyId,
        portal_url: options.portalUrl,
        scan_cursor: null,
        portal_status_ids: [],
        entity_status_ids: { claim: [], forecast: [], funding_application: [], other_form: [] },
        pull_interval_minutes: null,
        last_pull_at: null,
        last_pull_error: null,
        pull_lease_until: null,
        updated_at: new Date()
      }).execute()
      await setEncryptedExtensionSecret(asConnectorDb(transaction), {
        rootKey: options.secretRootKey,
        extensionKey: 'gcs-ssc-portal-connector',
        ownerType: 'agency', ownerId: agency.id,
        secretKey: 'portal-key', value: { key: options.portalKey }
      })
    }

    if (options.seedApplicationForm) {
      const definition = designerSurveySchema.parse(complexCommunityHealthForm())
      const form = await transaction.insertInto('extensions.gcs_portal_form').values({
        id: DEMO_APPLICATION_FORM_ID, agency_id: agency.id, definition,
        revision: 1, portal_id: null, portal_revision: null
      }).onConflict(conflict => conflict.column('id').doNothing()).returning('id').executeTakeFirst()
      if (form) await enqueueForm(transaction, agency.id, form.id)
    }

    for (const organization of options.organizations) {
      await transaction.insertInto('extensions.gcs_portal_organization').values({
        agency_id: agency.id, portal_organization_id: organization.id,
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
    return { phase: 'ready' as const, ...result }
  })
}
