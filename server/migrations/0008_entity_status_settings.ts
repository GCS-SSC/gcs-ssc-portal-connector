import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

/** Separates existing shared visibility selections without dropping deployed settings. */
export default defineGcsExtensionMigration({
  up: async db => {
    await sql`ALTER TABLE extensions.gcs_portal_connection
      ADD COLUMN entity_status_ids jsonb NOT NULL DEFAULT '{"claim":[],"forecast":[],"funding_application":[],"other_form":[]}'::jsonb`.execute(db)
    await sql`UPDATE extensions.gcs_portal_connection SET entity_status_ids = jsonb_build_object(
      'claim', portal_status_ids, 'forecast', portal_status_ids,
      'funding_application', '[]'::jsonb, 'other_form', '[]'::jsonb
    )`.execute(db)
  },
  down: async db => {
    await sql`ALTER TABLE extensions.gcs_portal_connection DROP COLUMN entity_status_ids`.execute(db)
  }
})
