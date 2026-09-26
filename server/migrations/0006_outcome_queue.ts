import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async (db) => {
    await sql`
      CREATE TABLE extensions.gcs_portal_outcome_outbox (
        id bigserial PRIMARY KEY,
        agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
        receipt_id bigint NOT NULL REFERENCES extensions.gcs_portal_receipt(id),
        status_id bigint NOT NULL REFERENCES "Common_Status"(id),
        state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','delivered')),
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        delivered_at timestamptz
      )
    `.execute(db)
    await sql`CREATE INDEX gcs_portal_outcome_due ON extensions.gcs_portal_outcome_outbox (next_attempt_at,id) WHERE state <> 'delivered'`.execute(db)
    await sql`
      CREATE OR REPLACE FUNCTION extensions.enqueue_portal_outcome_change()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE entity_type text;
      BEGIN
        IF TG_TABLE_NAME = 'Funding_Case_Agreement_Claim' THEN
          entity_type := 'fundingcaseagreementclaim';
        ELSE
          entity_type := 'fundingcaseforecast';
        END IF;
        IF NEW.egcs_fc_status IS DISTINCT FROM OLD.egcs_fc_status THEN
          INSERT INTO extensions.gcs_portal_outcome_outbox (agency_id,receipt_id,status_id)
          SELECT receipt.agency_id,receipt.id,NEW.egcs_fc_status
          FROM extensions.gcs_portal_receipt receipt
          WHERE receipt.gcs_entity_type=entity_type AND receipt.gcs_entity_id=NEW.id
            AND receipt.state='imported';
        END IF;
        RETURN NEW;
      END $fn$
    `.execute(db)
    await sql`CREATE TRIGGER gcs_portal_claim_status AFTER UPDATE OF egcs_fc_status ON "Funding_Case_Agreement_Claim" FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_outcome_change()`.execute(db)
    await sql`CREATE TRIGGER gcs_portal_forecast_status AFTER UPDATE OF egcs_fc_status ON "Funding_Case_Agreement_Forecast" FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_outcome_change()`.execute(db)
    await sql`
      CREATE OR REPLACE FUNCTION extensions.enqueue_portal_initial_outcome()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE status_id bigint;
      BEGIN
        IF NEW.state <> 'imported' OR NEW.gcs_entity_id IS NULL THEN RETURN NEW; END IF;
        IF NEW.gcs_entity_type='fundingcaseagreementclaim' THEN
          SELECT egcs_fc_status INTO status_id FROM "Funding_Case_Agreement_Claim" WHERE id=NEW.gcs_entity_id;
        ELSIF NEW.gcs_entity_type='fundingcaseforecast' THEN
          SELECT egcs_fc_status INTO status_id FROM "Funding_Case_Agreement_Forecast" WHERE id=NEW.gcs_entity_id;
        END IF;
        IF status_id IS NOT NULL THEN
          INSERT INTO extensions.gcs_portal_outcome_outbox (agency_id,receipt_id,status_id)
          VALUES (NEW.agency_id,NEW.id,status_id);
        END IF;
        RETURN NEW;
      END $fn$
    `.execute(db)
    await sql`CREATE TRIGGER gcs_portal_receipt_outcome AFTER INSERT ON extensions.gcs_portal_receipt FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_initial_outcome()`.execute(db)
    await sql`
      CREATE OR REPLACE FUNCTION extensions.enqueue_portal_status_definition_change()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        INSERT INTO extensions.gcs_portal_outbox
          (agency_id,agreement_id,portal_organization_id,proponent_id)
        SELECT identity.agency_id,agreement.id,identity.portal_organization_id,identity.proponent_id
        FROM "Funding_Case_Agreement_Profile" agreement
        JOIN "Transfer_Payment_Stream" stream ON stream.id=agreement.egcs_fc_transferpaymentstream
        JOIN "Transfer_Payment_Profile" program ON program.id=stream.egcs_tp_transferpaymentprofile
        JOIN "Funding_Case_Agreement_Applicant_Recipient" recipient
          ON recipient.egcs_fc_fundingagreement=agreement.id AND recipient._deleted=false
        JOIN extensions.gcs_portal_identity identity
          ON identity.proponent_id=recipient.egcs_fc_applicantrecipient
          AND identity.agency_id=program.egcs_tp_agency
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
    await sql`CREATE TRIGGER gcs_portal_status_definition AFTER UPDATE OF egcs_cn_name_en,egcs_cn_name_fr,egcs_cn_color,_deleted ON "Common_Status" FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_status_definition_change()`.execute(db)
  },
  down: async (db) => {
    await sql`DROP TRIGGER gcs_portal_status_definition ON "Common_Status"`.execute(db)
    await sql`DROP FUNCTION extensions.enqueue_portal_status_definition_change()`.execute(db)
    await sql`DROP TRIGGER gcs_portal_receipt_outcome ON extensions.gcs_portal_receipt`.execute(db)
    await sql`DROP FUNCTION extensions.enqueue_portal_initial_outcome()`.execute(db)
    await sql`DROP TRIGGER gcs_portal_forecast_status ON "Funding_Case_Agreement_Forecast"`.execute(db)
    await sql`DROP TRIGGER gcs_portal_claim_status ON "Funding_Case_Agreement_Claim"`.execute(db)
    await sql`DROP FUNCTION extensions.enqueue_portal_outcome_change()`.execute(db)
    await sql`DROP TABLE extensions.gcs_portal_outcome_outbox`.execute(db)
  }
})
