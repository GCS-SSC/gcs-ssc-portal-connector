import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async (db) => {
    await sql`
      CREATE TABLE extensions.gcs_portal_connection (
        agency_id bigint PRIMARY KEY REFERENCES "Agency_Profile"(id),
        portal_agency_id text NOT NULL,
        portal_url text NOT NULL,
        scan_cursor text,
        revision integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db)
    await sql`
      CREATE TABLE extensions.gcs_portal_receipt (
        id bigserial PRIMARY KEY,
        agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
        event_id text NOT NULL,
        submission_id text NOT NULL,
        item_submission_id text NOT NULL,
        kind text NOT NULL,
        source_export jsonb NOT NULL,
        gcs_entity_type text,
        gcs_entity_id bigint,
        state text NOT NULL CHECK (state IN ('received', 'imported', 'unsupported')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (agency_id, event_id),
        UNIQUE (agency_id, item_submission_id)
      )
    `.execute(db)
    await sql`CREATE INDEX gcs_portal_receipt_agency_state ON extensions.gcs_portal_receipt (agency_id, state, id)`.execute(db)
  },
  down: async (db) => {
    await sql`DROP TABLE extensions.gcs_portal_receipt`.execute(db)
    await sql`DROP TABLE extensions.gcs_portal_connection`.execute(db)
  }
})
