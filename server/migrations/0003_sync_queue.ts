import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async (db) => {
    await sql`
      CREATE TABLE extensions.gcs_portal_identity (
        agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
        portal_organization_id text NOT NULL,
        proponent_id bigint NOT NULL,
        verified_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (agency_id, portal_organization_id),
        UNIQUE (agency_id, proponent_id)
      )
    `.execute(db)
    await sql`
      CREATE TABLE extensions.gcs_portal_outbox (
        id bigserial PRIMARY KEY,
        agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
        agreement_id bigint NOT NULL REFERENCES "Funding_Case_Agreement_Profile"(id),
        portal_organization_id text NOT NULL,
        proponent_id bigint NOT NULL,
        state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','delivered')),
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        delivered_at timestamptz
      )
    `.execute(db)
    await sql`CREATE INDEX gcs_portal_outbox_due ON extensions.gcs_portal_outbox (next_attempt_at, id) WHERE state <> 'delivered'`.execute(db)
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
        JOIN "Funding_Case_Agreement_Applicant_Recipient" recipient
          ON recipient.egcs_fc_applicantrecipient = identity.proponent_id
          AND recipient.egcs_fc_fundingagreement = agreement_id AND recipient._deleted = false
        WHERE EXISTS (SELECT 1 FROM extensions.gcs_portal_connection connection
          WHERE connection.agency_id = identity.agency_id);
        RETURN NEW;
      END $fn$
    `.execute(db)
    await sql`CREATE TRIGGER gcs_portal_agreement_change AFTER INSERT OR UPDATE ON "Funding_Case_Agreement_Profile" FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_agreement_change()`.execute(db)
    await sql`CREATE TRIGGER gcs_portal_budget_year_change AFTER INSERT OR UPDATE ON "Funding_Case_Agreement_Budget_Fiscal_Year" FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_agreement_change()`.execute(db)
    await sql`CREATE TRIGGER gcs_portal_budget_line_change AFTER INSERT OR UPDATE ON "Funding_Case_Agreement_Budget_Line_Item" FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_agreement_change()`.execute(db)
    await sql`CREATE TRIGGER gcs_portal_budget_version_change AFTER INSERT OR UPDATE ON "Funding_Case_Agreement_Budget_Version" FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_agreement_change()`.execute(db)
    await sql`CREATE TRIGGER gcs_portal_recipient_change AFTER INSERT OR UPDATE ON "Funding_Case_Agreement_Applicant_Recipient" FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_agreement_change()`.execute(db)
  },
  down: async (db) => {
    await sql`DROP TRIGGER gcs_portal_recipient_change ON "Funding_Case_Agreement_Applicant_Recipient"`.execute(db)
    await sql`DROP TRIGGER gcs_portal_budget_version_change ON "Funding_Case_Agreement_Budget_Version"`.execute(db)
    await sql`DROP TRIGGER gcs_portal_budget_line_change ON "Funding_Case_Agreement_Budget_Line_Item"`.execute(db)
    await sql`DROP TRIGGER gcs_portal_budget_year_change ON "Funding_Case_Agreement_Budget_Fiscal_Year"`.execute(db)
    await sql`DROP TRIGGER gcs_portal_agreement_change ON "Funding_Case_Agreement_Profile"`.execute(db)
    await sql`DROP FUNCTION extensions.enqueue_portal_agreement_change()`.execute(db)
    await sql`DROP TABLE extensions.gcs_portal_outbox`.execute(db)
    await sql`DROP TABLE extensions.gcs_portal_identity`.execute(db)
  }
})
