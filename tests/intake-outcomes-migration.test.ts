import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { PGlite } from '@electric-sql/pglite'
import migration from '../server/migrations/0012_intake_outcomes.ts'
describe('Intake outcome populated migration', () => {
 let db: Kysely<unknown>
 beforeEach(async () => {
  const engine=new PGlite();db=new Kysely({dialect:new KyselyPGlite(engine).dialect})
  await engine.exec(`CREATE SCHEMA extensions;
   CREATE TABLE "Funding_Case_Intake_Profile" (id bigint PRIMARY KEY,egcs_fi_status bigint);
   CREATE TABLE "Common_Status" (id bigint PRIMARY KEY,egcs_cn_name_en text,egcs_cn_name_fr text,egcs_cn_color text,_deleted boolean);
   CREATE TABLE extensions.gcs_portal_receipt (id bigint PRIMARY KEY,agency_id bigint,gcs_entity_id bigint,gcs_entity_type text,state text);
   CREATE TABLE extensions.gcs_portal_outcome_outbox (id bigserial PRIMARY KEY,agency_id bigint,receipt_id bigint,status_id bigint);
   INSERT INTO "Common_Status" VALUES (2,'Draft','Ébauche','#999999',false),(3,'Active','Actif','#222222',false);
   INSERT INTO "Funding_Case_Intake_Profile" VALUES (99,2);
   INSERT INTO extensions.gcs_portal_receipt VALUES (1,11,99,'fundingcaseintake','imported');`)
 })
 afterEach(async () => {await db.destroy()})
 it('backfills receipts, queues initial/promoted imports once, preserves evidence on rollback',async()=>{
  await migration.up(db as never)
  await sql`INSERT INTO extensions.gcs_portal_receipt VALUES (2,11,99,'fundingcaseintake','imported'),(3,11,NULL,NULL,'unsupported')`.execute(db)
  await sql`UPDATE extensions.gcs_portal_receipt SET gcs_entity_id=99,gcs_entity_type='fundingcaseintake',state='imported' WHERE id=3`.execute(db)
  await sql`UPDATE extensions.gcs_portal_receipt SET state='imported' WHERE id=3`.execute(db)
  expect((await sql`SELECT receipt_id::text,status_id::text FROM extensions.gcs_portal_outcome_outbox ORDER BY id`.execute(db)).rows).toEqual([{receipt_id:'1',status_id:'2'},{receipt_id:'2',status_id:'2'},{receipt_id:'3',status_id:'2'}])
  await migration.down(db as never)
  expect((await sql`SELECT count(*)::int AS count FROM extensions.gcs_portal_receipt`.execute(db)).rows[0]).toEqual({count:3})
  expect((await sql`SELECT count(*)::int AS count FROM extensions.gcs_portal_outcome_outbox`.execute(db)).rows[0]).toEqual({count:3})
 })
 it('queues each form receipt on Intake/status definition changes and ignores unchanged status',async()=>{
  await migration.up(db as never)
  await sql`INSERT INTO extensions.gcs_portal_receipt VALUES (2,11,99,'fundingcaseintake','imported')`.execute(db)
  await sql`DELETE FROM extensions.gcs_portal_outcome_outbox`.execute(db)
  await sql`UPDATE "Funding_Case_Intake_Profile" SET egcs_fi_status=3 WHERE id=99`.execute(db)
  await sql`UPDATE "Funding_Case_Intake_Profile" SET egcs_fi_status=3 WHERE id=99`.execute(db)
  await sql`UPDATE "Common_Status" SET egcs_cn_name_en='Active revised' WHERE id=3`.execute(db)
  expect((await sql`SELECT receipt_id::text,status_id::text FROM extensions.gcs_portal_outcome_outbox ORDER BY id`.execute(db)).rows).toEqual([{receipt_id:'1',status_id:'3'},{receipt_id:'2',status_id:'3'},{receipt_id:'1',status_id:'3'},{receipt_id:'2',status_id:'3'}])
 })
})
