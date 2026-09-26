import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async (db) => {
    await sql`
      CREATE TABLE extensions.gcs_portal_publication (
        id bigserial PRIMARY KEY,
        agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
        gcs_agreement_id bigint NOT NULL REFERENCES "Funding_Case_Agreement_Profile"(id),
        portal_organization_id text NOT NULL,
        portal_agreement_id text NOT NULL,
        portal_agreement_revision integer NOT NULL,
        portal_set_ids jsonb NOT NULL,
        source_digest text NOT NULL,
        published_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (agency_id, gcs_agreement_id, portal_organization_id, source_digest)
      )
    `.execute(db)
  },
  down: async (db) => { await sql`DROP TABLE extensions.gcs_portal_publication`.execute(db) }
})
