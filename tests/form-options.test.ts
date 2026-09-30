import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { Kysely } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { getFormOptions, listFormOptionStreams } from '../server/form-options'
const pg = new PGlite()
const db = new Kysely({ dialect: new KyselyPGlite(pg).dialect })
const context = (agencyId = '1', streamId = '10') => ({ db, params: { agencyId, streamId } }) as never
beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY, _deleted boolean DEFAULT false);
    CREATE TABLE "Transfer_Payment_Profile" (id bigint PRIMARY KEY, egcs_tp_agency bigint, egcs_tp_name_en text, egcs_tp_name_fr text, egcs_tp_active boolean DEFAULT true, _deleted boolean DEFAULT false);
    CREATE TABLE "Transfer_Payment_Stream" (id bigint PRIMARY KEY, egcs_tp_transferpaymentprofile bigint, egcs_tp_name_en text, egcs_tp_name_fr text, egcs_tp_active boolean DEFAULT true, _deleted boolean DEFAULT false);
    CREATE TABLE "Agency_Cost_Category" (id bigint PRIMARY KEY, egcs_ay_organizationagency bigint, egcs_ay_name_en text, egcs_ay_name_fr text, egcs_ay_active boolean DEFAULT true, _deleted boolean DEFAULT false);
    CREATE TABLE "Agency_Cost_Category_Line_Item" (id bigint PRIMARY KEY, egcs_ay_organizationcostcategory bigint, egcs_ay_name_en text, egcs_ay_name_fr text, egcs_ay_calculationmode text, egcs_ay_sourcecategory bigint, egcs_ay_percentage numeric, egcs_ay_allowpercentageoverride boolean DEFAULT false, egcs_ay_active boolean DEFAULT true, _deleted boolean DEFAULT false);
    CREATE TABLE "Transfer_Payment_Stream_Cost_Category_Line_Item" (id bigint PRIMARY KEY, egcs_tp_transferpaymentstream bigint, egcs_tp_organizationcostcategory bigint, egcs_tp_costsharingratio numeric, egcs_tp_active boolean DEFAULT true, _deleted boolean DEFAULT false);
    CREATE TABLE "Agency_Fiscal_Year" (id bigint PRIMARY KEY, egcs_ay_organizationagency bigint, egcs_ay_fiscalyeardisplay text, _deleted boolean DEFAULT false);
    CREATE TABLE "Transfer_Payment_Fiscal_Year_Budget" (id bigint PRIMARY KEY, egcs_tp_transferpaymentprofile bigint, egcs_tp_fiscalyear bigint, _deleted boolean DEFAULT false);
    CREATE TABLE "Transfer_Payment_Stream_Budget" (id bigint PRIMARY KEY, egcs_tp_transferpaymentstream bigint, egcs_tp_transferpaymentbudget bigint, _deleted boolean DEFAULT false);
    CREATE TABLE "Agency_Funding_Type" (id bigint PRIMARY KEY, egcs_ay_organizationagency bigint, egcs_ay_name_en text, egcs_ay_name_fr text, egcs_ay_instacking boolean, egcs_ay_incostsharing boolean, egcs_ay_active boolean DEFAULT true, _deleted boolean DEFAULT false);
    CREATE TABLE "Agency_Funding_Subtype" (id bigint PRIMARY KEY, egcs_ay_fundingtype bigint, egcs_ay_name_en text, egcs_ay_name_fr text, egcs_ay_active boolean DEFAULT true, _deleted boolean DEFAULT false);
    CREATE TABLE "Transfer_Payment_Stream_Funding_Subtype" (id bigint PRIMARY KEY, egcs_tp_transferpaymentstream bigint, egcs_tp_fundingsubtype bigint, _deleted boolean DEFAULT false);
    CREATE TABLE "Transfer_Payment_Outcome" (id bigint PRIMARY KEY, egcs_tp_transferpaymentprofile bigint, egcs_tp_name_en text, egcs_tp_name_fr text, _deleted boolean DEFAULT false);
    CREATE TABLE "Transfer_Payment_Stream_Outcome" (id bigint PRIMARY KEY, egcs_tp_transferpaymentstream bigint, egcs_tp_transferpaymentoutcome bigint, _deleted boolean DEFAULT false);
    INSERT INTO "Agency_Profile" (id) VALUES (1),(2);
    INSERT INTO "Transfer_Payment_Profile" (id,egcs_tp_agency,egcs_tp_name_en,egcs_tp_name_fr) VALUES (1,1,'Program','Programme'),(2,2,'Other','Autre');
    INSERT INTO "Transfer_Payment_Stream" (id,egcs_tp_transferpaymentprofile,egcs_tp_name_en,egcs_tp_name_fr,egcs_tp_active) VALUES (10,1,'Delivery','Prestation',true),(11,1,'Inactive','Inactif',false),(20,2,'Other','Autre',true);
    INSERT INTO "Agency_Cost_Category" (id,egcs_ay_organizationagency,egcs_ay_name_en,egcs_ay_name_fr) VALUES (1,1,'Personnel','Personnel'),(2,1,'Admin','Admin'),(3,1,'Base','Base'),(4,2,'Other','Autre');
    INSERT INTO "Agency_Cost_Category_Line_Item" (id,egcs_ay_organizationcostcategory,egcs_ay_name_en,egcs_ay_name_fr,egcs_ay_calculationmode,egcs_ay_sourcecategory,egcs_ay_percentage,egcs_ay_active) VALUES
      (1,1,'Salary','Salaire','manual',null,null,true),(2,2,'Overhead','Frais','category',3,10,true),(3,1,'Retired','Retiré','manual',null,null,false),(4,4,'Foreign','Étranger','manual',null,null,true);
    INSERT INTO "Transfer_Payment_Stream_Cost_Category_Line_Item" (id,egcs_tp_transferpaymentstream,egcs_tp_organizationcostcategory,egcs_tp_costsharingratio) VALUES (101,10,1,0.5),(102,10,2,100),(103,10,3,0.5),(104,10,4,0.5);
    INSERT INTO "Agency_Fiscal_Year" (id,egcs_ay_organizationagency,egcs_ay_fiscalyeardisplay) VALUES (1,1,'2028–2029'),(2,2,'2029–2030');
    INSERT INTO "Transfer_Payment_Fiscal_Year_Budget" (id,egcs_tp_transferpaymentprofile,egcs_tp_fiscalyear) VALUES (1,1,1),(2,2,2);
    INSERT INTO "Transfer_Payment_Stream_Budget" (id,egcs_tp_transferpaymentstream,egcs_tp_transferpaymentbudget) VALUES (1,10,1),(2,10,2);
    INSERT INTO "Agency_Funding_Type" (id,egcs_ay_organizationagency,egcs_ay_name_en,egcs_ay_name_fr,egcs_ay_instacking,egcs_ay_incostsharing) VALUES (1,1,'Government','Gouvernement',true,false),(2,2,'Foreign','Étranger',false,true);
    INSERT INTO "Agency_Funding_Subtype" (id,egcs_ay_fundingtype,egcs_ay_name_en,egcs_ay_name_fr,_deleted) VALUES (1,1,'Province','Province',false),(2,1,'Old','Ancien',true),(3,2,'Foreign','Étranger',false);
    INSERT INTO "Transfer_Payment_Stream_Funding_Subtype" (id,egcs_tp_transferpaymentstream,egcs_tp_fundingsubtype) VALUES (1,10,1),(2,10,2),(3,10,3);
    INSERT INTO "Transfer_Payment_Outcome" (id,egcs_tp_transferpaymentprofile,egcs_tp_name_en,egcs_tp_name_fr) VALUES (1,1,'Training','Formation'),(2,2,'Foreign','Étranger');
    INSERT INTO "Transfer_Payment_Stream_Outcome" (id,egcs_tp_transferpaymentstream,egcs_tp_transferpaymentoutcome) VALUES (1,10,1),(2,10,2);
  `)
})
afterAll(async () => { await db.destroy() })
describe('stream form snapshots', () => {
  it('lists only active streams owned by the selected agency', async () => {
    expect((await listFormOptionStreams(context())).streams).toEqual([{ id: '10', label: { en: 'Program / Delivery', fr: 'Programme / Prestation' } }])
  })
  it('captures active choices with the correct agreement-reference IDs and calculation metadata', async () => {
    const result = await getFormOptions(context())
    expect(result.budget.costItems.map(item => item.gcsId)).toEqual(['101', '102'])
    expect(result.budget.fiscalYears.map(year => year.gcsId)).toEqual(['1'])
    expect(result.budget.fundingSubtypes.map(subtype => subtype.gcsId)).toEqual(['1'])
    expect(result.budget.fundingTypes[0]).toMatchObject({ stacking: true, costSharing: false, gcsId: '1' })
    expect(result.budget.categories.map(category => category.gcsId)).toEqual(['1', '2', '3'])
    expect(result.budget.costItems[1]).toMatchObject({ costSharingRatio: 100, calculation: { mode: 'category', sourceCategoryId: 'category_3', percentage: 10 } })
    expect(result.activities.outcomes.map(outcome => outcome.gcsId)).toEqual(['1'])
    expect(result.activities.responsibleParties).toEqual([])
    expect(result.budget.source).toMatchObject({ mode: 'stream', agencyId: '1', streamId: '10' })
  })
  it.each([['2', '10'], ['1', '20'], ['1', '11'], ['1', 'missing']] as const)('rejects unavailable or cross-agency scope %s/%s', async (agency, stream) => {
    await expect(getFormOptions(context(agency, stream))).rejects.toMatchObject({ statusCode: 404 })
  })
  it('excludes inactive funding types and subtypes', async () => {
    await pg.exec(`UPDATE "Agency_Funding_Subtype" SET egcs_ay_active = false WHERE id = 1`)
    expect((await getFormOptions(context())).budget.fundingSubtypes).toEqual([])
    await pg.exec(`UPDATE "Agency_Funding_Subtype" SET egcs_ay_active = true WHERE id = 1; UPDATE "Agency_Funding_Type" SET egcs_ay_active = false WHERE id = 1`)
    expect((await getFormOptions(context())).budget.fundingSubtypes).toEqual([])
    await pg.exec(`UPDATE "Agency_Funding_Type" SET egcs_ay_active = true WHERE id = 1`)
  })
  it('syncs fresh settings without mutating earlier snapshots', async () => {
    const before = await getFormOptions(context())
    await pg.exec(`UPDATE "Agency_Cost_Category_Line_Item" SET egcs_ay_name_en = 'Updated salary' WHERE id = 1`)
    const after = await getFormOptions(context())
    expect(after.budget.costItems[0]!.label.en).toBe('Updated salary')
    expect(before.budget.costItems[0]!.label.en).toBe('Salary')
    expect(after.budget.costItems[0]!.id).toBe(before.budget.costItems[0]!.id)
  })
})
