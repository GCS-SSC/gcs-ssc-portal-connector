import { readdirSync } from 'node:fs'
import { sql } from 'kysely'
import { setEncryptedExtensionSecret } from '@gcs-ssc/extensions/server'
import type { ConnectorDb } from '../../server/db.ts'
import { secretOptions } from '../../server/connection.ts'

export const migrateQueueFixture = async (db: ConnectorDb) => {
  const fixture = `CREATE SCHEMA extensions;
    CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY, _deleted boolean DEFAULT false);
    CREATE TABLE "Applicant_Recipient_Profile" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Profile" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Budget_Fiscal_Year" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Budget_Line_Item" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Budget_Version" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Applicant_Recipient" (id bigint PRIMARY KEY);
    CREATE TABLE "Funding_Case_Agreement_Claim" (id bigint PRIMARY KEY, egcs_fc_status bigint);
    CREATE TABLE "Funding_Case_Agreement_Forecast" (id bigint PRIMARY KEY, egcs_fc_status bigint);
    CREATE TABLE "Funding_Case_Intake_Profile" (id bigint PRIMARY KEY, egcs_fi_status bigint);
    CREATE TABLE "Common_Status" (id bigint PRIMARY KEY, egcs_cn_name_en text, egcs_cn_name_fr text, egcs_cn_color text, _deleted boolean);
    CREATE TABLE extensions.agency_enablement (extension_key text, agency_id bigint, enabled boolean, _deleted boolean DEFAULT false);
    CREATE TABLE extensions.secret_entry (id bigserial PRIMARY KEY, extension_key text, owner_type text, owner_id text, secret_key text,
      ciphertext text, iv text, auth_tag text, algorithm text, key_version integer, metadata jsonb,
      created_at timestamptz DEFAULT now(), updated_at timestamptz, _deleted boolean DEFAULT false);
    INSERT INTO "Agency_Profile" (id) VALUES (11),(22);
    INSERT INTO "Applicant_Recipient_Profile" VALUES (101);
    INSERT INTO "Funding_Case_Agreement_Profile" VALUES (201)`
  for (const statement of fixture.split(';')) await sql.raw(statement).execute(db)
  const directory = new URL('../../server/migrations/', import.meta.url)
  for (const file of readdirSync(directory).sort()) {
    const migration = await import(new URL(file, directory).href)
    await migration.default.up(db)
  }
}

export const resetQueueFixture = async (db: ConnectorDb) => {
  for (const table of ['operation', 'outcome_outbox', 'inbox', 'outbox', 'receipt', 'connection', 'identity', 'verification']) {
    await sql.raw(`TRUNCATE extensions.gcs_ssc_portal_connector_${table} RESTART IDENTITY CASCADE`).execute(db)
  }
  await sql`TRUNCATE extensions.agency_enablement, extensions.secret_entry, "Common_Status",
    "Funding_Case_Agreement_Claim", "Funding_Case_Agreement_Forecast", "Funding_Case_Intake_Profile" CASCADE`.execute(db)
  await sql`INSERT INTO extensions.agency_enablement VALUES
    ('gcs-ssc-portal-connector',11,true,false), ('gcs-ssc-portal-connector',22,true,false)`.execute(db)
  await sql`INSERT INTO "Common_Status" VALUES (401,'Approved','Approuvé','#123abc',false)`.execute(db)
  for (const agencyId of ['11', '22']) {
    await db.insertInto('extensions.gcs_ssc_portal_connector_connection').values({
      agency_id: agencyId, portal_agency_id: `G-${agencyId}`, portal_url: 'https://portal.example/',
      scan_cursor: null, pull_interval_minutes: 5, last_pull_at: null, last_pull_error: null,
      pull_lease_until: null, updated_at: new Date()
    }).execute()
    await setEncryptedExtensionSecret(db, { ...secretOptions(agencyId), value: { key: `gcs_${'a'.repeat(43)}` } })
  }
}
