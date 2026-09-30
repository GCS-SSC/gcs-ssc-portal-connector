import { sql } from 'kysely'
import { z } from 'zod'
import { createGcsExtensionUserError, type GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { agencyIdFromContext, authorizedWrite, EXTENSION_KEY } from './authorization.ts'
import { asConnectorDb } from './db.ts'

const positiveBigintId = z.string().regex(/^[1-9]\d{0,18}$/)
  .refine(value => BigInt(value) <= BigInt('9223372036854775807'))
export const intakeGroupSettingsInput = z.object({ intakeGroupId: positiveBigintId.nullable() }).strict()
const unavailableGroup = () => createGcsExtensionUserError({
  code: 'GCS_PORTAL_INTAKE_GROUP_UNAVAILABLE', statusCode: 400,
  message: { en: 'Choose an active intake group belonging to this agency.',
    fr: 'Choisissez un groupe actif de réception des demandes appartenant à cet organisme gouvernemental.' }
})

export const getIntakeGroupSettings = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const db = asConnectorDb(context.db)
  const groups = (await sql<{ id: string; nameEn: string; nameFr: string }>`
    SELECT group_row.id::text, group_row.egcs_cn_name_en AS "nameEn", group_row.egcs_cn_name_fr AS "nameFr"
    FROM "Common_Group" group_row WHERE group_row.egcs_cn_agency=${agencyId}::bigint AND group_row._deleted=false
      AND EXISTS (SELECT 1 FROM "Common_Group_Member" member_row
        JOIN "Common_User" common_user ON common_user.id=member_row.egcs_cn_user
        JOIN "user" auth_user ON auth_user.id=common_user.egcs_cn_auth_user_id
        WHERE member_row.egcs_cn_group=group_row.id AND member_row._deleted=false
          AND common_user._deleted=false AND auth_user._deleted=false)
    ORDER BY group_row.egcs_cn_name_en, group_row.id
  `.execute(db)).rows
  const row = (await sql<{ config: Record<string, unknown> }>`
    SELECT config FROM extensions.agency_enablement WHERE agency_id=${agencyId}::bigint
      AND extension_key=${EXTENSION_KEY} AND enabled=true AND _deleted=false
  `.execute(db)).rows[0]
  const stored = positiveBigintId.safeParse(row?.config.intakeGroupId)
  const intakeGroupId = stored.success ? stored.data : null
  return { groups, intakeGroupId, ready: intakeGroupId !== null && groups.some(group => group.id === intakeGroupId) }
}

export const saveIntakeGroupSettings = async (context: GcsExtensionRouteContext) => {
  const parsed = intakeGroupSettingsInput.safeParse(await context.readBody())
  if (!parsed.success) throw unavailableGroup()
  const { intakeGroupId } = parsed.data
  const agencyId = agencyIdFromContext(context)
  await authorizedWrite(context, async transaction => {
    const row = (await sql<{ id: string; config: Record<string, unknown> }>`
      SELECT id::text, config FROM extensions.agency_enablement WHERE agency_id=${agencyId}::bigint
        AND extension_key=${EXTENSION_KEY} AND enabled=true AND _deleted=false FOR UPDATE
    `.execute(transaction)).rows[0]
    if (!row) throw createGcsExtensionUserError({ code: 'GCS_PORTAL_INTAKE_CONFIG_UNAVAILABLE', statusCode: 409,
      message: { en: 'Enable the Portal connector for this agency before configuring intake imports.',
        fr: 'Activez le connecteur du portail pour cet organisme gouvernemental avant de configurer l’importation des demandes.' } })
    if (intakeGroupId !== null) {
      const group = (await sql<{ id: string }>`SELECT id::text FROM "Common_Group"
        WHERE id=${intakeGroupId}::bigint AND egcs_cn_agency=${agencyId}::bigint AND _deleted=false FOR UPDATE
      `.execute(transaction)).rows[0]
      if (!group) throw unavailableGroup()
      const member = (await sql<{ id: string }>`SELECT member_row.id::text
        FROM "Common_Group_Member" member_row
        JOIN "Common_User" common_user ON common_user.id=member_row.egcs_cn_user
        JOIN "user" auth_user ON auth_user.id=common_user.egcs_cn_auth_user_id
        WHERE member_row.egcs_cn_group=${intakeGroupId}::bigint AND member_row._deleted=false
          AND common_user._deleted=false AND auth_user._deleted=false
        ORDER BY member_row.id LIMIT 1 FOR UPDATE OF member_row
      `.execute(transaction)).rows[0]
      if (!member) throw unavailableGroup()
    }
    const config = { ...row.config }
    if (intakeGroupId === null) delete config.intakeGroupId
    else config.intakeGroupId = intakeGroupId
    await sql`UPDATE extensions.agency_enablement SET config=${JSON.stringify(config)}::jsonb
      WHERE id=${row.id}::bigint`.execute(transaction)
  })
  return getIntakeGroupSettings(context)
}
