import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { describe, expect, it, vi } from 'vitest'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { getIntakeGroupSettings, intakeGroupSettingsInput, saveIntakeGroupSettings } from '../server/intake-group-settings.ts'

vi.mock('@gcs-ssc/extensions/server', async importOriginal => ({
  ...await importOriginal<typeof import('@gcs-ssc/extensions/server')>(),
  lockGcsExtensionLifecycleScope: vi.fn(async () => {})
}))

describe('intake group configuration', () => {
  it('validates optional positive signed-bigint IDs and rejects unrelated fields', () => {
    expect(intakeGroupSettingsInput.parse({ intakeGroupId: null })).toEqual({ intakeGroupId: null })
    expect(intakeGroupSettingsInput.parse({ intakeGroupId: '9223372036854775807' }).intakeGroupId).toBe('9223372036854775807')
    for (const intakeGroupId of ['', '0', '-1', '01', '9223372036854775808', 3, undefined])
      expect(intakeGroupSettingsInput.safeParse({ intakeGroupId }).success).toBe(false)
    expect(intakeGroupSettingsInput.safeParse({ intakeGroupId: '1', enabled: true }).success).toBe(false)
  })

  it('lists only agency groups; fresh authorized writes preserve config and reject deleted/foreign groups', async () => {
    const db = new Kysely<unknown>({ dialect: new KyselyPGlite().dialect })
    const order: string[] = []
    const lockAuthState = vi.fn(async () => { order.push('lock') })
    const authorizeCurrentScope = vi.fn(async () => { order.push('authorize') })
    let body: unknown = { intakeGroupId: '11' }
    const context = { db, params: { agencyId: '1' }, readBody: async () => body,
      writeAuthorization: { lockAuthState, authorizeCurrentScope } } as unknown as GcsExtensionRouteContext
    try {
      await sql`CREATE SCHEMA extensions`.execute(db)
      await sql`CREATE TABLE extensions.agency_enablement (id bigint PRIMARY KEY, agency_id bigint NOT NULL,
        extension_key text NOT NULL, enabled boolean NOT NULL, _deleted boolean NOT NULL, config jsonb NOT NULL)`.execute(db)
      await sql`CREATE TABLE "Common_Group" (id bigint PRIMARY KEY, egcs_cn_agency bigint NOT NULL,
        egcs_cn_name_en text NOT NULL, egcs_cn_name_fr text NOT NULL, _deleted boolean NOT NULL)`.execute(db)
      await sql`CREATE TABLE "user" (id bigint PRIMARY KEY, _deleted boolean NOT NULL)`.execute(db)
      await sql`CREATE TABLE "Common_User" (id bigint PRIMARY KEY, egcs_cn_auth_user_id bigint NOT NULL, _deleted boolean NOT NULL)`.execute(db)
      await sql`CREATE TABLE "Common_Group_Member" (id bigint PRIMARY KEY, egcs_cn_group bigint NOT NULL,
        egcs_cn_user bigint NOT NULL, _deleted boolean NOT NULL)`.execute(db)
      await sql`INSERT INTO "user" VALUES (1,false),(2,true)`.execute(db)
      await sql`INSERT INTO "Common_User" VALUES (1,1,false),(2,1,true),(3,2,false)`.execute(db)
      await sql`INSERT INTO "Common_Group_Member" VALUES (1,11,1,false),(2,15,1,true),(3,16,2,false),(4,17,3,false)`.execute(db)
      await sql`INSERT INTO extensions.agency_enablement VALUES (1,1,'gcs-ssc-portal-connector',true,false,
        '{"portalProponentVerificationAccess":"manager","unrelatedSetting":false}'::jsonb)`.execute(db)
      await sql`INSERT INTO "Common_Group" VALUES (11,1,'Health intake','Réception santé',false),
        (12,2,'Foreign agency','Autre organisme',false),(13,1,'Retired','Retraité',true),
        (14,1,'Empty','Vide',false),(15,1,'Deleted membership','Membre supprimé',false),
        (16,1,'Deleted business user','Utilisateur supprimé',false),(17,1,'Deleted auth user','Compte supprimé',false)`.execute(db)
      const initial = await getIntakeGroupSettings(context)
      expect(initial).toEqual({ intakeGroupId: null, ready: false,
        groups: [{ id: '11', nameEn: 'Health intake', nameFr: 'Réception santé' }] })
      expect(await saveIntakeGroupSettings(context)).toMatchObject({ intakeGroupId: '11', ready: true })
      expect(order).toEqual(['lock', 'authorize'])
      const config = async () => (await sql<{ config: Record<string, unknown> }>`SELECT config FROM extensions.agency_enablement WHERE id=1`.execute(db)).rows[0]!.config
      expect(await config()).toEqual({ portalProponentVerificationAccess: 'manager', unrelatedSetting: false, intakeGroupId: '11' })
      for (const intakeGroupId of ['12', '13', '14', '15', '16', '17']) {
        body = { intakeGroupId }
        await expect(saveIntakeGroupSettings(context)).rejects.toMatchObject({ code: 'GCS_PORTAL_INTAKE_GROUP_UNAVAILABLE' })
        expect((await config()).intakeGroupId).toBe('11')
      }
      await sql`UPDATE "Common_Group_Member" SET _deleted=true WHERE id=1`.execute(db)
      expect(await getIntakeGroupSettings(context)).toEqual({ intakeGroupId: '11', ready: false, groups: [] })
      body = { intakeGroupId: null }
      expect(await saveIntakeGroupSettings(context)).toMatchObject({ intakeGroupId: null, ready: false })
      expect(await config()).toEqual({ portalProponentVerificationAccess: 'manager', unrelatedSetting: false })
      authorizeCurrentScope.mockRejectedValueOnce(new Error('Fresh agency authorization revoked'))
      body = { intakeGroupId: '11' }
      await expect(saveIntakeGroupSettings(context)).rejects.toThrow('Fresh agency authorization revoked')
      expect((await config()).intakeGroupId).toBeUndefined()
      await sql`UPDATE extensions.agency_enablement SET enabled=false WHERE id=1`.execute(db)
      await expect(saveIntakeGroupSettings(context)).rejects.toMatchObject({ code: 'GCS_PORTAL_INTAKE_CONFIG_UNAVAILABLE' })
    } finally { await db.destroy() }
  })
})
