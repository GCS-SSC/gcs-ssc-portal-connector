import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async (db) => {
    await sql`ALTER TABLE extensions.gcs_portal_connection ADD COLUMN portal_status_ids jsonb NOT NULL DEFAULT '[]'::jsonb`.execute(db)
    await sql`ALTER TABLE extensions.gcs_portal_connection ADD COLUMN pull_interval_minutes integer CHECK (pull_interval_minutes IN (1,5,15,30,60))`.execute(db)
    await sql`ALTER TABLE extensions.gcs_portal_connection ADD COLUMN last_pull_at timestamptz`.execute(db)
    await sql`ALTER TABLE extensions.gcs_portal_connection ADD COLUMN last_pull_error text`.execute(db)
    await sql`ALTER TABLE extensions.gcs_portal_connection ADD COLUMN pull_lease_until timestamptz`.execute(db)
  },
  down: async (db) => {
    await sql`ALTER TABLE extensions.gcs_portal_connection DROP COLUMN pull_lease_until, DROP COLUMN last_pull_error, DROP COLUMN last_pull_at, DROP COLUMN pull_interval_minutes, DROP COLUMN portal_status_ids`.execute(db)
  }
})
