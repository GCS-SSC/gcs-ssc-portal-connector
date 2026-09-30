import { emptyBudgetConfig, emptyActivityConfig, newBudgetRow, newActivityRow, type BudgetConfig, type ActivityConfig, type AdvancedSurvey } from '@gcs-ssc/survey'
const option = (id: string, en: string, fr: string, gcsId?: string) => ({ id, label: { en, fr }, ...(gcsId ? { gcsId } : {}) })
export const budgetConfig = (): BudgetConfig => ({ ...emptyBudgetConfig(),
  categories: [option('staff', 'Staff', 'Personnel', '1'), option('overhead', 'Administration', 'Administration', '2')],
  fiscalYears: [option('year', '2028–2029', '2028–2029', '3')],
  costItems: [{ ...option('salary', 'Salaries', 'Salaires', '4'), categoryId: 'staff', calculation: { mode: 'manual', sourceCategoryId: null, percentage: null, allowOverride: false } },
    { ...option('admin', 'Administration fee', 'Frais administratifs', '5'), categoryId: 'overhead', calculation: { mode: 'category', sourceCategoryId: 'staff', percentage: 10, allowOverride: true } }],
  fundingTypes: [{ ...option('government', 'Government', 'Gouvernement', '6'), stacking: true, costSharing: true }],
  fundingSubtypes: [{ ...option('province', 'Province', 'Province', '7'), typeId: 'government' }] })
export const activityConfig = (): ActivityConfig => ({ ...emptyActivityConfig(),
  outcomes: [option('training', 'Skills development', 'Développement des compétences', '8')],
  responsibleParties: [option('applicant', 'Applicant organization', 'Organisme demandeur')] })
export const budgetEntry = (id = 'r_cost') => ({ ...newBudgetRow(id, budgetConfig()), costItemId: 'salary',
  subsection: 'Delivery', description: 'Instructor costs', totalCost: '1500.00', programFunding: '1000.00' })
export const activityEntry = () => ({ ...newActivityRow('r_activity'), name: { en: 'Training', fr: '' }, description: { en: 'Deliver workshops', fr: '' },
  expectedResults: { en: 'Train 20 people', fr: '' }, startDate: '2028-04-01', endDate: '2028-06-30', outcomeIds: ['training'], responsiblePartyIds: ['applicant'] })
export const grantForm = (): AdvancedSurvey => ({ schemaVersion: 4, title: { en: 'Project plan', fr: 'Plan du projet' },
  questions: [{ id: 'budget', type: 'budget', required: true, label: { en: 'Project budget', fr: 'Budget du projet' }, config: budgetConfig() },
    { id: 'activities', type: 'activities', required: true, label: { en: 'Project activities', fr: 'Activités du projet' }, config: activityConfig() }],
  pages: [{ id: 'plan', title: { en: 'Your project', fr: 'Votre projet' }, questionIds: ['budget', 'activities'], groups: [], branches: [] }] })
