import { sql } from 'kysely'
import { asConnectorDb } from './db.ts'

interface AgreementSource {
  agreement_id: string
  agreement_number: string
  title_en: string
  title_fr: string
  program_id: string
  program_name_en: string
  program_name_fr: string
  stream_id: string
  stream_name_en: string
  stream_name_fr: string
  status_name_en: string | null
  status_id: string | null
  status_name_fr: string | null
  status_colour: string | null
  terminal: boolean | null
}
interface FiscalSource { id: string; start_year: number }
interface LineSource {
  id: string
  fiscal_year_id: string
  name_en: string
  name_fr: string
  category_en: string
  subsection: string
  program_funding: string
  currency: string
}

/** Reads current, amendment-stable Agreement budget identities as exact decimal text. */
export const projectAgreement = async (
  database: unknown, agencyId: string, agreementId: string, proponentId: string
) => {
  const db = asConnectorDb(database)
  const agreement = (await sql<AgreementSource>`
    SELECT agreement.id::text AS agreement_id,
      agreement.egcs_fc_agreementnumber AS agreement_number,
      agreement.egcs_fc_title_en AS title_en, agreement.egcs_fc_title_fr AS title_fr,
      program.id::text AS program_id,
      program.egcs_tp_name_en AS program_name_en, program.egcs_tp_name_fr AS program_name_fr,
      stream.id::text AS stream_id,
      stream.egcs_tp_name_en AS stream_name_en, stream.egcs_tp_name_fr AS stream_name_fr,
      status.egcs_cn_name_en AS status_name_en,
      status.id::text AS status_id,
      status.egcs_cn_name_fr AS status_name_fr,
      status.egcs_cn_color AS status_colour,
      status.egcs_cn_terminal AS terminal
    FROM "Funding_Case_Agreement_Profile" agreement
    JOIN "Transfer_Payment_Stream" stream ON stream.id = agreement.egcs_fc_transferpaymentstream
    JOIN "Transfer_Payment_Profile" program ON program.id = stream.egcs_tp_transferpaymentprofile
    JOIN "Funding_Case_Agreement_Applicant_Recipient" recipient
      ON recipient.egcs_fc_fundingagreement = agreement.id
      AND recipient.egcs_fc_applicantrecipient = ${proponentId}::bigint
      AND recipient._deleted = false
    LEFT JOIN "Common_Status" status ON status.id = agreement.egcs_fc_status AND status._deleted = false
    WHERE agreement.id = ${agreementId}::bigint AND program.egcs_tp_agency = ${agencyId}::bigint
      AND agreement._deleted = false AND stream._deleted = false AND program._deleted = false
  `.execute(db)).rows[0]
  if (!agreement) throw new Error('The selected Agreement is not linked to that recipient in this Agency.')
  const fiscalYears = (await sql<FiscalSource>`
    SELECT COALESCE(year.egcs_fc_originalbudgetfiscalyear, year.id)::text AS id,
      fiscal.egcs_ay_fiscalyear AS start_year
    FROM "Funding_Case_Agreement_Budget_Fiscal_Year" year
    JOIN "Funding_Case_Agreement_Budget_Version" version ON version.id = year.egcs_fc_budgetversion
    JOIN "Agency_Fiscal_Year" fiscal ON fiscal.id = year.egcs_fc_fiscalyear
    WHERE year.egcs_fc_fundingagreement = ${agreementId}::bigint AND year._deleted = false
      AND version.egcs_fc_iscurrent = true AND version._deleted = false AND fiscal._deleted = false
    ORDER BY fiscal.egcs_ay_fiscalyear, year.id
  `.execute(db)).rows
  const lines = (await sql<LineSource>`
    SELECT COALESCE(line.egcs_fc_originalbudgetlineitem, line.id)::text AS id,
      COALESCE(year.egcs_fc_originalbudgetfiscalyear, year.id)::text AS fiscal_year_id,
      item.egcs_ay_name_en AS name_en, item.egcs_ay_name_fr AS name_fr,
      category.egcs_ay_name_en AS category_en,
      line.egcs_fc_costsubsection AS subsection,
      line.egcs_fc_programfunding::text AS program_funding,
      line.egcs_fc_currency::text AS currency
    FROM "Funding_Case_Agreement_Budget_Line_Item" line
    JOIN "Funding_Case_Agreement_Budget_Fiscal_Year" year
      ON year.id = line.egcs_fc_fundingagreementbudgetfiscalyear
    JOIN "Funding_Case_Agreement_Budget_Version" version ON version.id = year.egcs_fc_budgetversion
    JOIN "Transfer_Payment_Stream_Cost_Category_Line_Item" stream_item
      ON stream_item.id = line.egcs_fc_organizationcostcategory
    JOIN "Agency_Cost_Category_Line_Item" item ON item.id = stream_item.egcs_tp_organizationcostcategory
    JOIN "Agency_Cost_Category" category ON category.id = item.egcs_ay_organizationcostcategory
    WHERE year.egcs_fc_fundingagreement = ${agreementId}::bigint
      AND line._deleted = false AND year._deleted = false AND version._deleted = false
      AND version.egcs_fc_iscurrent = true AND stream_item._deleted = false
      AND item._deleted = false AND category._deleted = false
      AND stream_item.egcs_tp_active = true AND item.egcs_ay_active = true
      AND category.egcs_ay_active = true
    ORDER BY fiscal_year_id, line.id
  `.execute(db)).rows
  if (!fiscalYears.length || !lines.length) throw new Error('Publish a current Agreement budget before sending it to the portal.')
  if (fiscalYears.length > 20 || lines.length > 200) throw new Error('The Agreement exceeds the portal budget limits.')
  return { agreement, fiscalYears, lines }
}
