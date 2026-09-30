import { sql } from 'kysely'
import { z } from 'zod'
import { activityConfigSchema, budgetConfigSchema, emptyActivityConfig, emptyBudgetConfig, type GrantOption } from '@gcs-ssc/survey'
import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { createGcsExtensionUserError } from '@gcs-ssc/extensions/server'
import { agencyIdFromContext } from './authorization.ts'
import { asConnectorDb } from './db.ts'

type ChoiceRow = { id: string; name_en: string; name_fr: string }
const choice = (prefix: string, row: ChoiceRow): GrantOption => ({ id: `${prefix}_${row.id}`, gcsId: row.id,
  label: { en: row.name_en, fr: row.name_fr } })
const unavailable = () => createGcsExtensionUserError({ code: 'FORM_STREAM_UNAVAILABLE', statusCode: 404,
  message: { en: 'Choose an active stream in this agency.', fr: 'Choisissez un volet actif de cet organisme.' } })

/**
 * Existing Agency form-read boundary; no Agreement records or organization data are exposed.
 * @param context - Authorized Agency form configuration context.
 * @returns Active, agency-owned choices for the form designer.
 */
export const listFormOptionStreams = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const rows = (await sql<ChoiceRow>`SELECT stream.id::text AS id,
    program.egcs_tp_name_en || ' / ' || stream.egcs_tp_name_en AS name_en,
    program.egcs_tp_name_fr || ' / ' || stream.egcs_tp_name_fr AS name_fr
    FROM "Transfer_Payment_Stream" stream
    JOIN "Transfer_Payment_Profile" program ON program.id = stream.egcs_tp_transferpaymentprofile
    JOIN "Agency_Profile" agency ON agency.id = program.egcs_tp_agency
    WHERE program.egcs_tp_agency = ${agencyId}::bigint AND NOT stream._deleted
      AND stream.egcs_tp_active AND NOT program._deleted AND program.egcs_tp_active AND NOT agency._deleted
    ORDER BY program.id, stream.id`.execute(asConnectorDb(context.db))).rows
  return { streams: rows.map(row => ({ id: row.id, label: { en: row.name_en, fr: row.name_fr } })) }
}

/**
 * Snapshot active Stream choices atomically; published revisions never read this endpoint.
 * @param context - Authorized Agency form configuration context.
 * @returns Active, agency-owned choices for the form designer.
 */
export const getFormOptions = async (context: GcsExtensionRouteContext) => {
  const agencyId = agencyIdFromContext(context)
  const streamId = z.string().regex(/^[1-9]\d{0,18}$/).safeParse(context.params.streamId)
  if (!streamId.success) throw unavailable()
  const database = asConnectorDb(context.db)
  return database.transaction().setIsolationLevel('repeatable read').execute(async db => {
    const stream = (await sql<{ id: string; program_id: string }>`SELECT stream.id::text AS id, program.id::text AS program_id FROM "Transfer_Payment_Stream" stream
      JOIN "Transfer_Payment_Profile" program ON program.id = stream.egcs_tp_transferpaymentprofile
      JOIN "Agency_Profile" agency ON agency.id = program.egcs_tp_agency
      WHERE stream.id = ${streamId.data}::bigint AND program.egcs_tp_agency = ${agencyId}::bigint
        AND NOT stream._deleted AND stream.egcs_tp_active AND NOT program._deleted AND program.egcs_tp_active
        AND NOT agency._deleted`.execute(db)).rows[0]
    if (!stream) throw unavailable()
    const [items, years, funding, outcomes] = await Promise.all([
      sql<ChoiceRow & { category_id: string; category_en: string; category_fr: string; mode: 'manual' | 'category' | 'all_other';
        source_id: string | null; source_en: string | null; source_fr: string | null; percentage: string | null; override: boolean; ratio: string | null }>`
        SELECT link.id::text AS id, item.egcs_ay_name_en AS name_en, item.egcs_ay_name_fr AS name_fr,
          category.id::text AS category_id, category.egcs_ay_name_en AS category_en, category.egcs_ay_name_fr AS category_fr,
          item.egcs_ay_calculationmode AS mode, item.egcs_ay_sourcecategory::text AS source_id, source.egcs_ay_name_en AS source_en, source.egcs_ay_name_fr AS source_fr,
          item.egcs_ay_percentage::text AS percentage, item.egcs_ay_allowpercentageoverride AS override,
          link.egcs_tp_costsharingratio::text AS ratio
        FROM "Transfer_Payment_Stream_Cost_Category_Line_Item" link
        JOIN "Agency_Cost_Category_Line_Item" item ON item.id = link.egcs_tp_organizationcostcategory
        JOIN "Agency_Cost_Category" category ON category.id = item.egcs_ay_organizationcostcategory
        LEFT JOIN "Agency_Cost_Category" source ON source.id = item.egcs_ay_sourcecategory AND source.egcs_ay_organizationagency = category.egcs_ay_organizationagency
        WHERE link.egcs_tp_transferpaymentstream = ${stream.id}::bigint AND NOT link._deleted AND link.egcs_tp_active
          AND NOT item._deleted AND item.egcs_ay_active AND NOT category._deleted AND category.egcs_ay_active
          AND category.egcs_ay_organizationagency = ${agencyId}::bigint ORDER BY category.id, link.id`.execute(db),
      sql<ChoiceRow>`SELECT DISTINCT year.id::text AS id, year.egcs_ay_fiscalyeardisplay AS name_en,
          year.egcs_ay_fiscalyeardisplay AS name_fr
        FROM "Transfer_Payment_Stream_Budget" link
        JOIN "Transfer_Payment_Fiscal_Year_Budget" budget ON budget.id = link.egcs_tp_transferpaymentbudget
        JOIN "Agency_Fiscal_Year" year ON year.id = budget.egcs_tp_fiscalyear
        WHERE link.egcs_tp_transferpaymentstream = ${stream.id}::bigint AND NOT link._deleted
          AND budget.egcs_tp_transferpaymentprofile = ${stream.program_id}::bigint
          AND NOT budget._deleted AND NOT year._deleted AND year.egcs_ay_organizationagency = ${agencyId}::bigint
        ORDER BY id`.execute(db),
      sql<ChoiceRow & { type_id: string; type_en: string; type_fr: string; stacking: boolean; cost_sharing: boolean }>`
        SELECT subtype.id::text AS id, subtype.egcs_ay_name_en AS name_en, subtype.egcs_ay_name_fr AS name_fr,
          type.id::text AS type_id, type.egcs_ay_name_en AS type_en, type.egcs_ay_name_fr AS type_fr,
          type.egcs_ay_instacking AS stacking, type.egcs_ay_incostsharing AS cost_sharing
        FROM "Transfer_Payment_Stream_Funding_Subtype" link
        JOIN "Agency_Funding_Subtype" subtype ON subtype.id = link.egcs_tp_fundingsubtype
        JOIN "Agency_Funding_Type" type ON type.id = subtype.egcs_ay_fundingtype
        WHERE link.egcs_tp_transferpaymentstream = ${stream.id}::bigint AND NOT link._deleted
          AND NOT subtype._deleted AND NOT type._deleted AND subtype.egcs_ay_active AND type.egcs_ay_active AND type.egcs_ay_organizationagency = ${agencyId}::bigint
        ORDER BY type.id, subtype.id`.execute(db),
      sql<ChoiceRow>`SELECT outcome.id::text AS id, outcome.egcs_tp_name_en AS name_en, outcome.egcs_tp_name_fr AS name_fr
        FROM "Transfer_Payment_Stream_Outcome" link
        JOIN "Transfer_Payment_Outcome" outcome ON outcome.id = link.egcs_tp_transferpaymentoutcome
        JOIN "Transfer_Payment_Stream" stream ON stream.id = link.egcs_tp_transferpaymentstream
        WHERE link.egcs_tp_transferpaymentstream = ${stream.id}::bigint AND NOT link._deleted AND NOT outcome._deleted
          AND outcome.egcs_tp_transferpaymentprofile = stream.egcs_tp_transferpaymentprofile ORDER BY outcome.id`.execute(db)
    ])
    const source = { mode: 'stream' as const, agencyId, streamId: stream.id, capturedAt: new Date().toISOString() }
    const categories = [...new Map(items.rows.map(item => [item.category_id, choice('category', {
      id: item.category_id, name_en: item.category_en, name_fr: item.category_fr })])).values()]
    for (const item of items.rows) {
      if (item.source_id && !categories.some(category => category.gcsId === item.source_id)) {
        if (!item.source_en || !item.source_fr) throw unavailable()
        categories.push(choice('category', { id: item.source_id, name_en: item.source_en, name_fr: item.source_fr }))
      }
    }
    const budget = budgetConfigSchema.parse({ ...emptyBudgetConfig(), source, categories,
      fiscalYears: years.rows.map(row => choice('year', row)),
      costItems: items.rows.map(item => ({ ...choice('cost', item), categoryId: `category_${item.category_id}`,
        costSharingRatio: item.ratio === null ? null : Number(item.ratio),
        calculation: { mode: item.mode, sourceCategoryId: item.source_id === null ? null : `category_${item.source_id}`,
          percentage: item.percentage === null ? null : Number(item.percentage), allowOverride: item.override } })),
      fundingTypes: [...new Map(funding.rows.map(row => [row.type_id, { ...choice('funding', {
        id: row.type_id, name_en: row.type_en, name_fr: row.type_fr }), stacking: row.stacking, costSharing: row.cost_sharing }])).values()],
      fundingSubtypes: funding.rows.map(row => ({ ...choice('subtype', row), typeId: `funding_${row.type_id}` }))
    })
    // Responsible parties belong to a future Agreement, not the Stream. Authors supply applicant-facing choices.
    const activities = activityConfigSchema.parse({ ...emptyActivityConfig(), source,
      outcomes: outcomes.rows.map(row => choice('outcome', row)) })
    return { budget, activities }
  })
}
