import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

/** Retains the exact agreement body associated with a successful queue delivery. */
export default defineGcsExtensionMigration({
  up: async db => {
    await sql`ALTER TABLE extensions.gcs_portal_outbox ADD COLUMN delivery_payload jsonb`.execute(db)
  },
  down: async db => {
    await sql`ALTER TABLE extensions.gcs_portal_outbox DROP COLUMN delivery_payload`.execute(db)
  }
})
