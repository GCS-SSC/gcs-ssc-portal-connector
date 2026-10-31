import { addMoney, compareMoney, isPersistableMoney, majorMoneyText, parseCurrencyMoney, parseDecimalText, percentageMoney, supportedCurrencyCodes, sumMoney, zeroMoney } from '@gcs-ssc/extensions/money';
import { z } from 'zod';
// Portable form data: hosts resolve optional external IDs; this package never writes funding records.
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const label = z.object({ en: z.string().trim().min(1).max(255), fr: z.string().trim().min(1).max(255) }).strict();
const externalId = z.string().regex(/^[1-9]\d{0,18}$/);
export const grantOptionSchema = z.object({ id: key, label, gcsId: externalId.optional() }).strict();
const unique = (values) => new Set(values.map(value => value.id)).size === values.length;
const options = z.array(grantOptionSchema).max(200).refine(unique, 'Option IDs must be unique');
export const grantSourceSchema = z.object({
    mode: z.enum(['custom', 'stream']),
    agencyId: externalId.optional(), streamId: externalId.optional(), capturedAt: z.iso.datetime().optional()
}).strict().refine(source => source.mode !== 'stream' || Boolean(source.agencyId && source.streamId && source.capturedAt), 'Stream snapshots need source identity and capture time');
const calculation = z.object({
    mode: z.enum(['manual', 'category', 'all_other']), sourceCategoryId: key.nullable(),
    percentage: z.number().min(0).max(100).refine(value => /^\d+(?:\.\d{1,2})?$/.test(String(value))).nullable(),
    allowOverride: z.boolean()
}).strict().refine(value => value.mode === 'manual'
    ? value.sourceCategoryId === null && value.percentage === null && !value.allowOverride
    : value.percentage !== null && (value.mode === 'category') === (value.sourceCategoryId !== null), 'Invalid calculation settings');
export const budgetConfigSchema = z.object({
    source: grantSourceSchema, maxRows: z.number().int().min(1).max(100),
    categories: options, fiscalYears: options,
    currencies: z.array(z.enum(supportedCurrencyCodes.map(currency => currency.toUpperCase()))).min(1).max(supportedCurrencyCodes.length).refine(values => new Set(values).size === values.length),
    costItems: z.array(grantOptionSchema.extend({ categoryId: key, calculation,
        costSharingRatio: z.number().min(-999.99).max(999.99).refine(value => /^-?\d+(?:\.\d{1,2})?$/.test(String(value))).nullable().optional() }).strict()).max(200).refine(unique, 'Cost item IDs must be unique'),
    fundingTypes: z.array(grantOptionSchema.extend({ stacking: z.boolean(), costSharing: z.boolean() }).strict()).max(100).refine(unique, 'Funding type IDs must be unique'),
    fundingSubtypes: z.array(grantOptionSchema.extend({ typeId: key }).strict()).max(200).refine(unique, 'Funding subtype IDs must be unique')
}).strict().superRefine((config, ctx) => {
    const fail = (message) => ctx.addIssue({ code: 'custom', message });
    for (const item of config.costItems) {
        if (!config.categories.some(category => category.id === item.categoryId))
            fail('Unknown cost category');
        if (item.calculation.mode === 'category') {
            const source = item.calculation.sourceCategoryId;
            if (source === item.categoryId || !config.categories.some(category => category.id === source)
                || config.costItems.some(other => other.categoryId === source && other.calculation.mode !== 'manual'))
                fail('Percentage sources must be another manual category');
        }
    }
    for (const subtype of config.fundingSubtypes)
        if (!config.fundingTypes.some(type => type.id === subtype.typeId))
            fail('Unknown funding type');
});
export const activityConfigSchema = z.object({
    source: grantSourceSchema, maxRows: z.number().int().min(1).max(100),
    outcomes: options, responsibleParties: options,
    requireOutcomes: z.boolean(), requireResponsibleParties: z.boolean(), bilingual: z.boolean()
}).strict();
export const emptyBudgetConfig = () => ({
    source: { mode: 'custom' }, maxRows: 50, currencies: ['CAD'], categories: [], fiscalYears: [],
    costItems: [], fundingTypes: [], fundingSubtypes: []
});
export const emptyActivityConfig = () => ({
    source: { mode: 'custom' }, maxRows: 50, outcomes: [], responsibleParties: [],
    requireOutcomes: true, requireResponsibleParties: true, bilingual: false
});
const rowId = z.string().regex(/^r_[a-zA-Z0-9_-]{1,40}$/);
const text = z.string().max(5000);
const pair = z.object({ en: text, fr: text }).strict();
// Partial values are retained in drafts; submit checks required content separately.
const fundingRow = z.object({ id: rowId, subtypeId: z.string().max(64), amount: z.string().max(44),
    description: pair }).strict();
export const budgetAnswerSchema = z.object({ version: z.literal(1), rows: z.array(z.object({
        id: rowId, fiscalYearId: z.string().max(64), costItemId: z.string().max(64),
        subsection: z.string().max(255), description: text, currency: z.string().max(3),
        totalCost: z.string().max(44), programFunding: z.string().max(44), percentage: z.string().max(6),
        otherFunding: z.array(fundingRow).max(50).refine(unique, 'Funding row IDs must be unique')
    }).strict()).max(100).refine(unique, 'Row IDs must be unique') }).strict();
export const activityAnswerSchema = z.object({ version: z.literal(1), rows: z.array(z.object({
        id: rowId, name: pair, description: pair, expectedResults: pair,
        startDate: z.string().max(10), endDate: z.string().max(10),
        outcomeIds: z.array(z.string().max(64)).max(200).refine(values => new Set(values).size === values.length),
        responsiblePartyIds: z.array(z.string().max(64)).max(200).refine(values => new Set(values).size === values.length)
    }).strict()).max(100).refine(unique, 'Row IDs must be unique') }).strict();
export const readBudgetAnswer = (raw) => {
    try {
        return budgetAnswerSchema.parse(JSON.parse(raw));
    }
    catch {
        return null;
    }
};
export const readActivityAnswer = (raw) => {
    try {
        return activityAnswerSchema.parse(JSON.parse(raw));
    }
    catch {
        return null;
    }
};
/** Human draft decimals become actual-currency minor-unit money before any calculation. */
export const readBudgetMoney = (value, currency) => {
    const amount = parseCurrencyMoney(value, currency);
    if (!isPersistableMoney(amount))
        throw new Error('Money exceeds persisted minor-unit precision');
    return amount;
};
const budgetPercentage = (value) => {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) || Number(value) > 100)
        throw new Error('Invalid percentage');
    return parseDecimalText(value);
};
/** Matches GCS: category charges first, all-other second; program funding only; nearest dollar. */
export const calculateBudget = (config, rows) => {
    const result = rows.map(row => ({ ...row, otherFunding: row.otherFunding.map(source => ({ ...source })) }));
    for (const mode of ['category', 'all_other'])
        for (const row of result) {
            const item = config.costItems.find(option => option.id === row.costItemId);
            if (!item || item.calculation.mode !== mode)
                continue;
            const group = result.filter(other => other.fiscalYearId === row.fiscalYearId && other.currency === row.currency);
            if (mode === 'all_other' && group.filter(other => config.costItems.find(option => option.id === other.costItemId)?.calculation.mode === mode).length > 1)
                throw new Error('Duplicate all-other charge');
            const sources = group.filter(other => other.id !== row.id && (mode === 'all_other'
                || config.costItems.find(option => option.id === other.costItemId)?.categoryId === item.calculation.sourceCategoryId));
            const base = sumMoney(sources.map(source => source.programFunding === '' ? zeroMoney(row.currency) : readBudgetMoney(source.programFunding, row.currency)), row.currency);
            const percentage = item.calculation.allowOverride && row.percentage !== '' ? row.percentage : String(item.calculation.percentage);
            const amount = percentageMoney(base, budgetPercentage(percentage), { scale: 0, rounding: 'halfAwayFromZero' });
            if (!isPersistableMoney(amount))
                throw new Error('Calculated funding exceeds persisted minor-unit precision');
            row.programFunding = majorMoneyText(amount);
        }
    return result;
};
export const newBudgetRow = (id, config) => ({
    id, fiscalYearId: config.fiscalYears.length === 1 ? config.fiscalYears[0].id : '', costItemId: '',
    subsection: '', description: '', currency: config.currencies[0], totalCost: '', programFunding: '', percentage: '', otherFunding: []
});
export const newActivityRow = (id) => ({ id, name: { en: '', fr: '' },
    description: { en: '', fr: '' }, expectedResults: { en: '', fr: '' }, startDate: '', endDate: '',
    outcomeIds: [], responsiblePartyIds: [] });
const calendar = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000-')
    && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const grantIssues = (question, raw, mode = 'submit') => {
    const answer = raw ? question.type === 'budget' ? readBudgetAnswer(raw) : readActivityAnswer(raw) : { version: 1, rows: [] };
    if (!answer)
        return [{ path: '', code: 'choice' }];
    const issues = [];
    const add = (path, code) => issues.push({ path, code });
    if (answer.rows.length > question.config.maxRows)
        add('', 'length');
    if (mode === 'submit' && question.required && !answer.rows.length)
        add('', 'required');
    const required = (value, path, max = 5000) => {
        if (mode === 'submit' && !value.trim())
            add(path, 'required');
        if (value.length > max)
            add(path, 'length');
    };
    const choose = (value, allowed, path) => {
        if (!value) {
            if (mode === 'submit')
                add(path, 'required');
        }
        else if (!allowed.some(option => option.id === value))
            add(path, 'choice');
    };
    const money = (value, path, currency) => {
        if (!value) {
            if (mode === 'submit')
                add(path, 'required');
            return null;
        }
        try {
            return readBudgetMoney(value, currency);
        }
        catch {
            add(path, 'money');
            return null;
        }
    };
    if (question.type === 'budget') {
        const config = question.config;
        const rows = answer.rows;
        let calculated = [];
        try {
            calculated = calculateBudget(config, rows);
        }
        catch {
            add('', 'calculation');
        }
        rows.forEach((row, index) => {
            const path = `rows.${index}`;
            choose(row.fiscalYearId, config.fiscalYears, `${path}.fiscalYearId`);
            choose(row.costItemId, config.costItems, `${path}.costItemId`);
            choose(row.currency, config.currencies.map(id => ({ id })), `${path}.currency`);
            required(row.subsection, `${path}.subsection`, 255);
            required(row.description, `${path}.description`);
            const total = money(row.totalCost, `${path}.totalCost`, row.currency);
            const item = config.costItems.find(option => option.id === row.costItemId);
            if (row.percentage && (!item?.calculation.allowOverride || item.calculation.mode === 'manual'))
                add(`${path}.percentage`, 'choice');
            if (row.percentage)
                try {
                    budgetPercentage(row.percentage);
                }
                catch {
                    add(`${path}.percentage`, 'calculation');
                }
            const program = money(item?.calculation.mode === 'manual' || !item ? row.programFunding
                : calculated[index]?.programFunding ?? '', `${path}.programFunding`, row.currency);
            if (item && item.calculation.mode !== 'manual' && row.programFunding && program !== null) {
                const submitted = money(row.programFunding, `${path}.programFunding`, row.currency);
                if (submitted !== null && compareMoney(submitted, program) !== 0)
                    add(`${path}.programFunding`, 'calculation');
            }
            const other = [];
            const subtypes = new Set();
            row.otherFunding.forEach((source, sourceIndex) => {
                const sourcePath = `${path}.otherFunding.${sourceIndex}`;
                choose(source.subtypeId, config.fundingSubtypes, `${sourcePath}.subtypeId`);
                if (source.subtypeId && subtypes.has(source.subtypeId))
                    add(`${sourcePath}.subtypeId`, 'choice');
                subtypes.add(source.subtypeId);
                const amount = money(source.amount, `${sourcePath}.amount`, row.currency);
                if (amount !== null) {
                    if (compareMoney(amount, zeroMoney(amount.currency)) < 0)
                        add(`${sourcePath}.amount`, 'negative');
                    other.push(amount);
                }
                if (source.description.en.length > 255 || source.description.fr.length > 255)
                    add(`${sourcePath}.description`, 'length');
            });
            if (total !== null && program !== null && compareMoney(addMoney(program, sumMoney(other, row.currency)), total) > 0)
                add(`${path}.totalCost`, 'coverage');
        });
    }
    else {
        const config = question.config;
        answer.rows.forEach((row, index) => {
            const path = `rows.${index}`;
            for (const field of ['name', 'description', 'expectedResults']) {
                if (config.bilingual)
                    for (const language of ['en', 'fr'])
                        required(row[field][language], `${path}.${field}.${language}`, field === 'name' ? 255 : 5000);
                else {
                    if (mode === 'submit' && !row[field].en.trim() && !row[field].fr.trim())
                        add(`${path}.${field}`, 'required');
                    if (Object.values(row[field]).some(value => value.length > (field === 'name' ? 255 : 5000)))
                        add(`${path}.${field}`, 'length');
                }
            }
            for (const field of ['startDate', 'endDate']) {
                required(row[field], `${path}.${field}`);
                if (row[field] && !calendar(row[field]))
                    add(`${path}.${field}`, 'date');
            }
            if (calendar(row.startDate) && calendar(row.endDate) && row.endDate < row.startDate)
                add(`${path}.endDate`, 'range');
            for (const [field, choices, mandatory] of [
                ['outcomeIds', config.outcomes, config.requireOutcomes],
                ['responsiblePartyIds', config.responsibleParties, config.requireResponsibleParties]
            ]) {
                if (mode === 'submit' && mandatory && !row[field].length)
                    add(`${path}.${field}`, 'required');
                if (row[field].some(id => !choices.some(option => option.id === id)))
                    add(`${path}.${field}`, 'choice');
            }
        });
    }
    return issues;
};
/** Canonical response serialization recomputes derived money rather than trusting submitted totals. */
export const normalizeBudgetAnswer = (config, answer) => ({
    version: 1, rows: calculateBudget(config, answer.rows).map(row => ({ ...row,
        totalCost: row.totalCost === '' ? '' : majorMoneyText(readBudgetMoney(row.totalCost, row.currency)),
        programFunding: row.programFunding === '' ? '' : majorMoneyText(readBudgetMoney(row.programFunding, row.currency)),
        otherFunding: row.otherFunding.map(source => ({ ...source, amount: source.amount === '' ? '' : majorMoneyText(readBudgetMoney(source.amount, row.currency)) }))
    }))
});
export const grantConfigurationReady = (question) => question.type === 'budget'
    ? question.config.costItems.length > 0 && question.config.fiscalYears.length > 0
    : (!question.config.requireOutcomes || question.config.outcomes.length > 0)
        && (!question.config.requireResponsibleParties || question.config.responsibleParties.length > 0);
