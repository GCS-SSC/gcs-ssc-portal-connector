import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async db => {
    await sql`CREATE TABLE extensions.gcs_portal_form (
      id text PRIMARY KEY,
      agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
      definition jsonb NOT NULL,
      revision integer NOT NULL DEFAULT 1,
      portal_id text,
      portal_revision integer,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (agency_id, portal_id)
    )`.execute(db)
    await sql`CREATE INDEX gcs_portal_form_agency ON extensions.gcs_portal_form (agency_id, updated_at DESC)`.execute(db)
    await sql`CREATE TABLE extensions.gcs_portal_operation (
      id bigserial PRIMARY KEY,
      agency_id bigint NOT NULL REFERENCES "Agency_Profile"(id),
      kind text NOT NULL CHECK (kind IN ('request', 'form')),
      method text,
      path text,
      body jsonb,
      form_id text REFERENCES extensions.gcs_portal_form(id),
      CONSTRAINT gcs_portal_operation_shape CHECK (
        (kind='form' AND form_id IS NOT NULL AND method IS NULL AND path IS NULL)
        OR (kind='request' AND form_id IS NULL AND method IN ('POST','PUT','PATCH','DELETE') AND path IS NOT NULL)
      ),
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'delivered')),
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_error text,
      response jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz
    )`.execute(db)
    await sql`CREATE INDEX gcs_portal_operation_due ON extensions.gcs_portal_operation (next_attempt_at, id)
      WHERE state <> 'delivered'`.execute(db)
  },
  down: async db => {
    await sql`DROP TABLE extensions.gcs_portal_operation`.execute(db)
    await sql`DROP TABLE extensions.gcs_portal_form`.execute(db)
  }
})
