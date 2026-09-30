import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async db => {
    await sql`CREATE FUNCTION extensions.enqueue_portal_intake_receipt() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE status_id bigint;
      BEGIN
        IF NEW.state <> 'imported' OR NEW.gcs_entity_type <> 'fundingcaseintake' OR NEW.gcs_entity_id IS NULL THEN RETURN NEW; END IF;
        IF TG_OP='UPDATE' AND OLD.state='imported' AND OLD.gcs_entity_type=NEW.gcs_entity_type AND OLD.gcs_entity_id=NEW.gcs_entity_id THEN RETURN NEW; END IF;
        SELECT egcs_fi_status INTO status_id FROM "Funding_Case_Intake_Profile" WHERE id=NEW.gcs_entity_id;
        IF status_id IS NOT NULL THEN
          INSERT INTO extensions.gcs_portal_outcome_outbox (agency_id,receipt_id,status_id) VALUES (NEW.agency_id,NEW.id,status_id);
        END IF;
        RETURN NEW;
      END $fn$`.execute(db)
    await sql`CREATE TRIGGER gcs_portal_intake_receipt AFTER INSERT OR UPDATE OF state,gcs_entity_type,gcs_entity_id
      ON extensions.gcs_portal_receipt FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_intake_receipt()`.execute(db)
    await sql`CREATE FUNCTION extensions.enqueue_portal_intake_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.egcs_fi_status IS DISTINCT FROM OLD.egcs_fi_status THEN
          INSERT INTO extensions.gcs_portal_outcome_outbox (agency_id,receipt_id,status_id)
          SELECT agency_id,id,NEW.egcs_fi_status FROM extensions.gcs_portal_receipt
          WHERE state='imported' AND gcs_entity_type='fundingcaseintake' AND gcs_entity_id=NEW.id;
        END IF;
        RETURN NEW;
      END $fn$`.execute(db)
    await sql`CREATE TRIGGER gcs_portal_intake_status AFTER UPDATE OF egcs_fi_status ON "Funding_Case_Intake_Profile"
      FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_intake_change()`.execute(db)
    await sql`CREATE FUNCTION extensions.enqueue_portal_intake_status_definition() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        INSERT INTO extensions.gcs_portal_outcome_outbox (agency_id,receipt_id,status_id)
        SELECT receipt.agency_id,receipt.id,NEW.id FROM extensions.gcs_portal_receipt receipt
        JOIN "Funding_Case_Intake_Profile" intake ON receipt.gcs_entity_type='fundingcaseintake' AND intake.id=receipt.gcs_entity_id
        WHERE receipt.state='imported' AND intake.egcs_fi_status=NEW.id;
        RETURN NEW;
      END $fn$`.execute(db)
    await sql`CREATE TRIGGER gcs_portal_intake_status_definition AFTER UPDATE OF egcs_cn_name_en,egcs_cn_name_fr,egcs_cn_color,_deleted
      ON "Common_Status" FOR EACH ROW EXECUTE FUNCTION extensions.enqueue_portal_intake_status_definition()`.execute(db)
    await sql`INSERT INTO extensions.gcs_portal_outcome_outbox (agency_id,receipt_id,status_id)
      SELECT receipt.agency_id,receipt.id,intake.egcs_fi_status FROM extensions.gcs_portal_receipt receipt
      JOIN "Funding_Case_Intake_Profile" intake ON receipt.gcs_entity_type='fundingcaseintake' AND intake.id=receipt.gcs_entity_id
      WHERE receipt.state='imported'`.execute(db)
  },
  down: async db => {
    await sql`DROP TRIGGER gcs_portal_intake_status_definition ON "Common_Status"`.execute(db)
    await sql`DROP FUNCTION extensions.enqueue_portal_intake_status_definition()`.execute(db)
    await sql`DROP TRIGGER gcs_portal_intake_status ON "Funding_Case_Intake_Profile"`.execute(db)
    await sql`DROP FUNCTION extensions.enqueue_portal_intake_change()`.execute(db)
    await sql`DROP TRIGGER gcs_portal_intake_receipt ON extensions.gcs_portal_receipt`.execute(db)
    await sql`DROP FUNCTION extensions.enqueue_portal_intake_receipt()`.execute(db)
  }
})
