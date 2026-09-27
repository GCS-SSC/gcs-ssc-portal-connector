import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { describe, expect, it } from 'vitest'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { getOutboxItem } from '../server/outbox.ts'

describe('Agreement delivery details', () => {
  it('returns the saved payload only to the matching agency', async () => {
    const db = new Kysely<unknown>({ dialect: new KyselyPGlite().dialect })
    try {
      await sql`CREATE SCHEMA extensions`.execute(db)
      await sql`CREATE TABLE extensions.gcs_portal_outbox (
        id bigint PRIMARY KEY, agency_id bigint NOT NULL, agreement_id bigint NOT NULL,
        portal_organization_id text NOT NULL, state text NOT NULL, attempts integer NOT NULL,
        created_at timestamptz NOT NULL, delivered_at timestamptz, last_error text,
        delivery_payload jsonb
      )`.execute(db)
      await sql`INSERT INTO extensions.gcs_portal_outbox VALUES
        (17, 1, 51, 'N-ABCDE', 'delivered', 1, '2026-09-26T15:00:00Z',
          '2026-09-26T15:30:00Z', NULL,
          '{"agreement":{"nameEn":"Community agreement"}}'::jsonb)`.execute(db)
      await sql`INSERT INTO extensions.gcs_portal_outbox VALUES
        (18, 1, 52, 'N-FGHIJ', 'pending', 0, '2026-09-26T16:00:00Z', NULL, NULL, NULL)`.execute(db)

      const context = (agencyId: string) => ({ db, params: { agencyId, itemId: '17' } }) as unknown as GcsExtensionRouteContext
      await expect(getOutboxItem(context('1'))).resolves.toMatchObject({
        agreementId: '51', organizationId: 'N-ABCDE',
        payload: { agreement: { nameEn: 'Community agreement' } }
      })
      await expect(getOutboxItem(context('2'))).rejects.toThrow('Delivery not found for this agency.')
      await expect(getOutboxItem({ db, params: { agencyId: '1', itemId: '18' } } as unknown as GcsExtensionRouteContext))
        .resolves.toMatchObject({ state: 'pending', payload: null })
    } finally { await db.destroy() }
  })
})
