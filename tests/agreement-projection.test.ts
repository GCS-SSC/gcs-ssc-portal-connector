import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { Kysely } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { projectAgreement } from '../server/agreement-projection.ts'

describe('current portal Agreement budget projection', () => {
  const engine = new PGlite()
  const db = new Kysely<unknown>({ dialect: new KyselyPGlite(engine).dialect })
  beforeAll(async () => {
    await engine.exec(`
      CREATE TABLE "Transfer_Payment_Profile" (id bigint PRIMARY KEY, egcs_tp_agency bigint, egcs_tp_name_en text, egcs_tp_name_fr text, _deleted boolean DEFAULT false);
      CREATE TABLE "Transfer_Payment_Stream" (id bigint PRIMARY KEY, egcs_tp_transferpaymentprofile bigint, egcs_tp_name_en text, egcs_tp_name_fr text, _deleted boolean DEFAULT false);
      CREATE TABLE "Common_Status" (id bigint PRIMARY KEY, egcs_cn_name_en text, egcs_cn_name_fr text, egcs_cn_color text, egcs_cn_terminal boolean, _deleted boolean DEFAULT false);
      CREATE TABLE "Funding_Case_Agreement_Profile" (id bigint PRIMARY KEY, egcs_fc_agreementnumber text, egcs_fc_title_en text, egcs_fc_title_fr text, egcs_fc_transferpaymentstream bigint, egcs_fc_status bigint, _deleted boolean DEFAULT false);
      CREATE TABLE "Funding_Case_Agreement_Applicant_Recipient" (id bigint PRIMARY KEY, egcs_fc_fundingagreement bigint, egcs_fc_applicantrecipient bigint, _deleted boolean DEFAULT false);
      CREATE TABLE "Funding_Case_Agreement_Budget_Version" (id bigint PRIMARY KEY, egcs_fc_iscurrent boolean, _deleted boolean DEFAULT false);
      CREATE TABLE "Agency_Fiscal_Year" (id bigint PRIMARY KEY, egcs_ay_fiscalyear integer, _deleted boolean DEFAULT false);
      CREATE TABLE "Funding_Case_Agreement_Budget_Fiscal_Year" (id bigint PRIMARY KEY, egcs_fc_originalbudgetfiscalyear bigint, egcs_fc_budgetversion bigint, egcs_fc_fiscalyear bigint, egcs_fc_fundingagreement bigint, _deleted boolean DEFAULT false);
      CREATE TABLE "Agency_Cost_Category" (id bigint PRIMARY KEY, egcs_ay_name_en text, egcs_ay_active boolean DEFAULT true, _deleted boolean DEFAULT false);
      CREATE TABLE "Agency_Cost_Category_Line_Item" (id bigint PRIMARY KEY, egcs_ay_organizationcostcategory bigint, egcs_ay_name_en text, egcs_ay_name_fr text, egcs_ay_active boolean DEFAULT true, _deleted boolean DEFAULT false);
      CREATE TABLE "Transfer_Payment_Stream_Cost_Category_Line_Item" (id bigint PRIMARY KEY, egcs_tp_organizationcostcategory bigint, egcs_tp_active boolean DEFAULT true, _deleted boolean DEFAULT false);
      CREATE TABLE "Funding_Case_Agreement_Budget_Line_Item" (id bigint PRIMARY KEY, egcs_fc_originalbudgetlineitem bigint, egcs_fc_fundingagreementbudgetfiscalyear bigint, egcs_fc_organizationcostcategory bigint, egcs_fc_costsubsection text, egcs_fc_programfunding numeric(19,2), egcs_fc_currency text, _deleted boolean DEFAULT false);
    `)
  })
  beforeEach(async () => {
    await engine.exec(`
      TRUNCATE "Transfer_Payment_Profile", "Transfer_Payment_Stream", "Common_Status", "Funding_Case_Agreement_Profile", "Funding_Case_Agreement_Applicant_Recipient", "Funding_Case_Agreement_Budget_Version", "Agency_Fiscal_Year", "Funding_Case_Agreement_Budget_Fiscal_Year", "Agency_Cost_Category", "Agency_Cost_Category_Line_Item", "Transfer_Payment_Stream_Cost_Category_Line_Item", "Funding_Case_Agreement_Budget_Line_Item";
      INSERT INTO "Transfer_Payment_Profile" VALUES (11,1,'Program','Programme',false);
      INSERT INTO "Transfer_Payment_Stream" VALUES (21,11,'Stream','Volet',false);
      INSERT INTO "Common_Status" VALUES (91,'Active','Actif','#123456',false,false);
      INSERT INTO "Funding_Case_Agreement_Profile" VALUES (31,'AG-31','Health funding','Financement santé',21,91,false);
      INSERT INTO "Funding_Case_Agreement_Applicant_Recipient" VALUES (61,31,71,false);
      INSERT INTO "Funding_Case_Agreement_Budget_Version" VALUES (100,true,false),(101,false,false);
      INSERT INTO "Agency_Fiscal_Year" VALUES (81,2026,false);
      INSERT INTO "Funding_Case_Agreement_Budget_Fiscal_Year" VALUES (41,40,100,81,31,false);
      INSERT INTO "Agency_Cost_Category" VALUES (1,'Operations',true,false);
      INSERT INTO "Agency_Cost_Category_Line_Item" VALUES (2,1,'Eligible costs','Coûts admissibles',true,false);
      INSERT INTO "Transfer_Payment_Stream_Cost_Category_Line_Item" VALUES (3,2,true,false);
      INSERT INTO "Funding_Case_Agreement_Budget_Line_Item" VALUES (51,50,41,3,'Delivery',9007199254740993.01,'CAD',false);
    `)
  })
  afterAll(async () => { await db.destroy() })

  it('retains amendment-stable identities, exact money and bilingual source names', async () => {
    const result = await projectAgreement(db, '1', '31', '71')
    expect(result.agreement).toMatchObject({ agreement_id: '31', title_en: 'Health funding', title_fr: 'Financement santé',
      stream_id: '21', program_id: '11', status_name_fr: 'Actif' })
    expect(result.fiscalYears).toEqual([{ id: '40', start_year: 2026 }])
    expect(result.lines).toEqual([{ id: '50', fiscal_year_id: '40', name_en: 'Eligible costs', name_fr: 'Coûts admissibles',
      category_en: 'Operations', subsection: 'Delivery', program_funding: '9007199254740993.01', currency: 'CAD' }])
  })
  it.each([['2', '31', '71'], ['1', '32', '71'], ['1', '31', '72']])('rejects unavailable Agency/Agreement/recipient %s/%s/%s', async (agency, agreement, proponent) => {
    await expect(projectAgreement(db, agency, agreement, proponent)).rejects.toThrow('not linked to that recipient in this Agency')
  })
  it.each(['Funding_Case_Agreement_Profile', 'Transfer_Payment_Stream', 'Transfer_Payment_Profile', 'Funding_Case_Agreement_Applicant_Recipient'])('does not export a tombstoned %s relationship', async table => {
    await engine.exec(`UPDATE "${table}" SET _deleted=true`)
    await expect(projectAgreement(db, '1', '31', '71')).rejects.toThrow('not linked to that recipient in this Agency')
  })
  it.each(['Funding_Case_Agreement_Budget_Fiscal_Year', 'Funding_Case_Agreement_Budget_Line_Item'])('requires a current budget with %s', async table => {
    await engine.exec(`DELETE FROM "${table}"`)
    await expect(projectAgreement(db, '1', '31', '71')).rejects.toThrow('Publish a current Agreement budget')
  })
  it('excludes superseded budgets and inactive cost identities', async () => {
    await engine.exec(`INSERT INTO "Funding_Case_Agreement_Budget_Fiscal_Year" VALUES (42,null,101,81,31,false);
      INSERT INTO "Funding_Case_Agreement_Budget_Line_Item" VALUES (52,null,42,3,'Historical',20.00,'CAD',false)`)
    expect((await projectAgreement(db, '1', '31', '71')).lines.map(line => line.id)).toEqual(['50'])
    await engine.exec(`UPDATE "Agency_Cost_Category_Line_Item" SET egcs_ay_active=false`)
    await expect(projectAgreement(db, '1', '31', '71')).rejects.toThrow('Publish a current Agreement budget')
  })
  it('accepts twenty fiscal years and rejects the twenty-first', async () => {
    await engine.exec(`INSERT INTO "Agency_Fiscal_Year" SELECT n+5000,2027+n-1000,false FROM generate_series(1000,1018) n;
      INSERT INTO "Funding_Case_Agreement_Budget_Fiscal_Year"
      SELECT n,null,100,n+5000,31,false FROM generate_series(1000,1018) n`)
    expect((await projectAgreement(db, '1', '31', '71')).fiscalYears).toHaveLength(20)
    await engine.exec(`INSERT INTO "Agency_Fiscal_Year" VALUES (6019,2046,false);
      INSERT INTO "Funding_Case_Agreement_Budget_Fiscal_Year" VALUES (1019,null,100,6019,31,false)`)
    await expect(projectAgreement(db, '1', '31', '71')).rejects.toThrow('portal budget limits')
  })
  it('accepts two hundred budget lines and rejects the next without rounding their amounts', async () => {
    await engine.exec(`INSERT INTO "Funding_Case_Agreement_Budget_Line_Item"
      SELECT n,null,41,3,'Delivery ' || n,0.01,'CAD',false FROM generate_series(1000,1198) n`)
    expect((await projectAgreement(db, '1', '31', '71')).lines).toHaveLength(200)
    await engine.exec(`INSERT INTO "Funding_Case_Agreement_Budget_Line_Item" VALUES (1199,null,41,3,'Delivery 1199',0.01,'CAD',false)`)
    await expect(projectAgreement(db, '1', '31', '71')).rejects.toThrow('portal budget limits')
  })
})
