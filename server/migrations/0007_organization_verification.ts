import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

/** Keeps Portal organization choices and app-wide verification in extension-owned storage. */
export default defineGcsExtensionMigration({
  up: async (db) => {
    await sql`
      CREATE TABLE extensions.gcs_portal_organization (
        agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
        portal_organization_id text NOT NULL,
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        owner_name text NOT NULL DEFAULT '',
        owner_email text NOT NULL DEFAULT '',
        member_count integer NOT NULL DEFAULT 0,
        agreement_count integer NOT NULL DEFAULT 0,
        active boolean NOT NULL,
        synced_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (agency_id, portal_organization_id)
      )
    `.execute(db)
    await sql`
      CREATE TABLE extensions.gcs_portal_verification (
        portal_organization_id text PRIMARY KEY,
        proponent_id bigint NOT NULL REFERENCES "Applicant_Recipient_Profile"(id),
        origin_agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
        verification_note text,
        verified_by_user_id text,
        verified_at timestamptz NOT NULL DEFAULT now(),
        portal_active boolean NOT NULL DEFAULT false,
        CHECK (verification_note IS NULL OR length(trim(verification_note)) > 0)
      )
    `.execute(db)
    await sql`CREATE UNIQUE INDEX gcs_portal_one_active_org_per_proponent
      ON extensions.gcs_portal_verification (proponent_id) WHERE portal_active`.execute(db)
    await sql`ALTER TABLE extensions.gcs_portal_identity
      DROP CONSTRAINT gcs_portal_identity_agency_id_proponent_id_key`.execute(db)
    await sql`ALTER TABLE extensions.gcs_portal_outbox
      DROP CONSTRAINT gcs_portal_outbox_state_check`.execute(db)
    await sql`ALTER TABLE extensions.gcs_portal_outbox
      ADD CONSTRAINT gcs_portal_outbox_state_check
      CHECK (state IN ('pending','leased','delivered','cancelled'))`.execute(db)

    const conflicts = await sql<{ portal_organization_id: string }>`
      SELECT portal_organization_id FROM extensions.gcs_portal_identity
      GROUP BY portal_organization_id HAVING count(DISTINCT proponent_id) > 1
    `.execute(db)
    if (conflicts.rows.length) {
      throw new Error('Existing Portal organization links conflict across agencies; resolve them before this migration.')
    }
    await sql`
      INSERT INTO extensions.gcs_portal_verification
        (portal_organization_id, proponent_id, origin_agency_id, verified_at)
      SELECT DISTINCT ON (portal_organization_id)
        portal_organization_id, proponent_id, agency_id, verified_at
      FROM extensions.gcs_portal_identity
      ORDER BY portal_organization_id, verified_at, agency_id
    `.execute(db)
    await sql`
      WITH ranked AS (
        SELECT portal_organization_id,
          row_number() OVER (PARTITION BY proponent_id ORDER BY verified_at DESC, portal_organization_id) AS rank
        FROM extensions.gcs_portal_verification
      )
      UPDATE extensions.gcs_portal_verification verification SET portal_active=true
      FROM ranked WHERE ranked.portal_organization_id=verification.portal_organization_id AND ranked.rank=1
    `.execute(db)
    await sql`
      UPDATE extensions.gcs_portal_outbox outbox SET state='cancelled',
        last_error='Historical Portal organization link', updated_at=now()
      WHERE state='pending' AND NOT EXISTS (
        SELECT 1 FROM extensions.gcs_portal_verification verification
        WHERE verification.portal_organization_id=outbox.portal_organization_id
          AND verification.portal_active=true
      )
    `.execute(db)
    await sql`
      CREATE OR REPLACE FUNCTION extensions.enqueue_portal_agreement_change()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE agreement_id bigint;
      BEGIN
        IF TG_TABLE_NAME = 'Funding_Case_Agreement_Profile' THEN
          agreement_id := NEW.id;
        ELSIF TG_TABLE_NAME = 'Funding_Case_Agreement_Budget_Line_Item' THEN
          SELECT year.egcs_fc_fundingagreement INTO agreement_id
          FROM "Funding_Case_Agreement_Budget_Fiscal_Year" year
          WHERE year.id = NEW.egcs_fc_fundingagreementbudgetfiscalyear;
        ELSE
          agreement_id := NEW.egcs_fc_fundingagreement;
        END IF;
        INSERT INTO extensions.gcs_portal_outbox
          (agency_id, agreement_id, portal_organization_id, proponent_id)
        SELECT identity.agency_id, agreement_id, identity.portal_organization_id, identity.proponent_id
        FROM extensions.gcs_portal_identity identity
        JOIN extensions.gcs_portal_verification verification
          ON verification.portal_organization_id=identity.portal_organization_id
          AND verification.portal_active=true
        JOIN "Funding_Case_Agreement_Applicant_Recipient" recipient
          ON recipient.egcs_fc_applicantrecipient=identity.proponent_id
          AND recipient.egcs_fc_fundingagreement=agreement_id AND recipient._deleted=false
        JOIN "Funding_Case_Agreement_Profile" agreement
          ON agreement.id=recipient.egcs_fc_fundingagreement AND agreement._deleted=false
        JOIN "Transfer_Payment_Stream" stream
          ON stream.id=agreement.egcs_fc_transferpaymentstream AND stream._deleted=false
        JOIN "Transfer_Payment_Profile" program
          ON program.id=stream.egcs_tp_transferpaymentprofile
          AND program.egcs_tp_agency=identity.agency_id AND program._deleted=false
        WHERE EXISTS (SELECT 1 FROM extensions.gcs_portal_connection connection
          WHERE connection.agency_id=identity.agency_id);
        RETURN NEW;
      END $fn$
    `.execute(db)
    await sql`
      CREATE OR REPLACE FUNCTION extensions.enqueue_portal_status_definition_change()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        INSERT INTO extensions.gcs_portal_outbox
          (agency_id,agreement_id,portal_organization_id,proponent_id)
        SELECT identity.agency_id,agreement.id,identity.portal_organization_id,identity.proponent_id
        FROM "Funding_Case_Agreement_Profile" agreement
        JOIN "Transfer_Payment_Stream" stream
          ON stream.id=agreement.egcs_fc_transferpaymentstream AND stream._deleted=false
        JOIN "Transfer_Payment_Profile" program
          ON program.id=stream.egcs_tp_transferpaymentprofile AND program._deleted=false
        JOIN "Funding_Case_Agreement_Applicant_Recipient" recipient
          ON recipient.egcs_fc_fundingagreement=agreement.id AND recipient._deleted=false
        JOIN extensions.gcs_portal_identity identity
          ON identity.proponent_id=recipient.egcs_fc_applicantrecipient
          AND identity.agency_id=program.egcs_tp_agency
        JOIN extensions.gcs_portal_verification verification
          ON verification.portal_organization_id=identity.portal_organization_id
          AND verification.portal_active=true
        WHERE agreement.egcs_fc_status=NEW.id AND agreement._deleted=false;
        INSERT INTO extensions.gcs_portal_outcome_outbox (agency_id,receipt_id,status_id)
        SELECT receipt.agency_id,receipt.id,NEW.id
        FROM extensions.gcs_portal_receipt receipt
        LEFT JOIN "Funding_Case_Agreement_Claim" claim
          ON receipt.gcs_entity_type='fundingcaseagreementclaim' AND claim.id=receipt.gcs_entity_id
        LEFT JOIN "Funding_Case_Agreement_Forecast" forecast
          ON receipt.gcs_entity_type='fundingcaseforecast' AND forecast.id=receipt.gcs_entity_id
        WHERE receipt.state='imported'
          AND COALESCE(claim.egcs_fc_status,forecast.egcs_fc_status)=NEW.id;
        RETURN NEW;
      END $fn$
    `.execute(db)
  },
  down: async () => {
    throw new Error('Portal verification history is permanent and cannot be rolled back without losing links.')
  }
})
