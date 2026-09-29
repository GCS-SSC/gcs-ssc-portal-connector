import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async db => {
    await sql`ALTER TABLE extensions.gcs_portal_operation DROP CONSTRAINT gcs_portal_operation_state_check`.execute(db)
    await sql`ALTER TABLE extensions.gcs_portal_operation ADD CONSTRAINT gcs_portal_operation_state_check
      CHECK (state IN ('pending', 'leased', 'delivered', 'failed'))`.execute(db)
  },
  down: async db => {
    await sql`UPDATE extensions.gcs_portal_operation SET state='pending' WHERE state='failed'`.execute(db)
    await sql`ALTER TABLE extensions.gcs_portal_operation DROP CONSTRAINT gcs_portal_operation_state_check`.execute(db)
    await sql`ALTER TABLE extensions.gcs_portal_operation ADD CONSTRAINT gcs_portal_operation_state_check
      CHECK (state IN ('pending', 'leased', 'delivered'))`.execute(db)
  }
})
