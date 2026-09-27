import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { describe, expect, it } from 'vitest'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { listProponentVerifications } from '../server/organizations.ts'

describe('Proponent verification history', () => {
  it('returns the current and previous links with the verifier and recorded note', async () => {
    const db = new Kysely<unknown>({ dialect: new KyselyPGlite().dialect })
    try {
      await sql`CREATE SCHEMA extensions`.execute(db)
      await sql`CREATE TABLE "user" (id bigint PRIMARY KEY, name text NOT NULL, email text NOT NULL)`.execute(db)
      await sql`CREATE TABLE extensions.gcs_portal_verification (
        portal_organization_id text PRIMARY KEY, proponent_id bigint NOT NULL,
        origin_agency_id bigint NOT NULL, verification_note text,
        verified_by_user_id text, verified_at timestamptz NOT NULL, portal_active boolean NOT NULL
      )`.execute(db)
      await sql`CREATE TABLE extensions.gcs_portal_organization (
        portal_organization_id text NOT NULL, agency_id bigint NOT NULL,
        name text NOT NULL, synced_at timestamptz NOT NULL
      )`.execute(db)
      await sql`INSERT INTO "user" (id, name, email) VALUES (9, 'Alex Manager', 'alex@example.com')`.execute(db)
      await sql`INSERT INTO extensions.gcs_portal_organization VALUES
        ('N-ABCDE', 1, 'Current organization', '2026-09-26'),
        ('N-FGHIJ', 2, 'Previous organization', '2025-09-26')`.execute(db)
      await sql`INSERT INTO extensions.gcs_portal_verification VALUES
        ('N-ABCDE', 7, 1, 'Checked signed records.', '9', '2026-09-26T15:30:00Z', true),
        ('N-FGHIJ', 7, 2, 'Historical link.', null, '2025-09-26T15:30:00Z', false)`.execute(db)
      const result = await listProponentVerifications({ db, params: { proponentId: '7' } } as unknown as GcsExtensionRouteContext)
      expect(result.verifications).toMatchObject([
        { organizationId: 'N-ABCDE', organizationName: 'Current organization',
          verifierName: 'Alex Manager', verifierEmail: 'alex@example.com', verifiedAt: '2026-09-26T15:30:00.000Z',
          note: 'Checked signed records.', active: true },
        { organizationId: 'N-FGHIJ', organizationName: 'Previous organization',
          verifierName: null, verifierEmail: null, note: 'Historical link.', active: false }
      ])
    } finally { await db.destroy() }
  })
})
