import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async (db) => {
    await sql`
      CREATE TABLE extensions.gcs_portal_inbox (
        agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
        event_id text NOT NULL,
        kind text NOT NULL,
        submission_id text NOT NULL,
        item_submission_id text,
        last_error text,
        created_at timestamptz NOT NULL,
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (agency_id, event_id)
      )
    `.execute(db)
  },
  down: async (db) => { await sql`DROP TABLE extensions.gcs_portal_inbox`.execute(db) }
})
