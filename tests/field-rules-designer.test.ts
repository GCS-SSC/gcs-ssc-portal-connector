// @vitest-environment jsdom
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { translateGcsExtensionMessage, type GcsExtensionMessages } from '@gcs-ssc/extensions'
import type { AdvancedQuestion, AdvancedSurvey, FieldRule } from '@gcs-ssc/survey'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { comparisonCompatible, fieldRuleCeiling, fieldRuleError, fieldRuleSourceIds, repeatFieldRuleSources, type RuleSourceQuestion, type RuleSubject } from '../shared/field-rules'
import { readFormDraft, writeFormDraft } from '../components/form-draft-session'

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'fr' }))
vi.mock('@gcs-ssc/extensions/ui', () => ({
  useExtensionI18n: (catalog: GcsExtensionMessages) => ({
    t: (key: string, values?: Record<string, string | number>) => translateGcsExtensionMessage(catalog, state.locale, key, values)
  }),
  ExtensionFormField: defineComponent({ props: ['name', 'label', 'required', 'description'], setup(props, { slots }) {
    return () => h('div', [h('label', { for: props.name }, `${props.label}${props.required ? ' (required)' : ''}`),
      props.description ? h('p', props.description) : null, slots.default?.()])
  } }),
  ExtensionInput: defineComponent({ props: ['modelValue', 'name', 'required', 'disabled', 'type'], emits: ['update:modelValue'], setup(props, { attrs, emit }) {
    return () => h('input', { ...attrs, id: props.name, name: props.name, required: props.required, disabled: props.disabled, type: props.type,
      value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) })
  } }),
  ExtensionSelect: defineComponent({ props: ['modelValue', 'name', 'items', 'required', 'disabled'], emits: ['update:modelValue'], setup(props, { attrs, emit }) {
    return () => h('select', { ...attrs, id: props.name, name: props.name, required: props.required, disabled: props.disabled,
      value: props.modelValue, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value) },
    (props.items as { value: string; label: string }[]).map(item => h('option', { value: item.value }, item.label)))
  } }),
  ExtensionButton: defineComponent({ props: ['disabled'], emits: ['click'], setup(props, { emit, slots }) {
    return () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots.default?.())
  } }),
  ExtensionCheckbox: defineComponent({ props: ['modelValue', 'label', 'disabled', 'required'], emits: ['update:modelValue'], setup(props, { emit }) {
    return () => h('label', [h('input', { type: 'checkbox', disabled: props.disabled, required: props.required, checked: props.modelValue,
      onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).checked) }), props.label])
  } })
}))
import FormFieldRules from '../components/FormFieldRules.vue'

const label = (value: string) => ({ en: value, fr: value })
const number: AdvancedQuestion = { id: 'number', type: 'number', label: label('Number'), required: false }
const source = { id: 'earlier', type: 'number' as const, label: 'Earlier amount' }
const setup = (question: RuleSubject, initialRules?: FieldRule[], questions: RuleSourceQuestion[] = [source], locale: 'en' | 'fr' = 'en') => {
  state.locale = locale
  const wrapper = mount(FormFieldRules, { props: { question, questions, locale, modelValue: initialRules,
    'onUpdate:modelValue': value => { void wrapper.setProps({ modelValue: value }) } } })
  return wrapper
}
const button = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll('button').find(item => item.text() === label)!
beforeEach(() => { window.sessionStorage.clear(); state.locale = 'en' })

describe('answer rule authoring', () => {
  it.each([
    { kind: 'precision', question: number, expected: { kind: 'precision', decimalPlaces: 0 } },
    { kind: 'required', question: number, expected: { kind: 'required', when: { match: 'all', conditions: [{ questionId: 'earlier', operator: 'answered' }] } } },
    { kind: 'group', question: number, expected: { kind: 'group', mode: 'atLeastOne', questionIds: ['number', 'earlier'] } },
    { kind: 'length', question: { ...number, type: 'text', maxLength: 100 }, expected: { kind: 'length', min: 1 } },
    { kind: 'format', question: { ...number, type: 'text', maxLength: 100 }, expected: { kind: 'format', format: 'url' } },
    { kind: 'choice', question: { ...number, type: 'select', options: [{ value: 'yes', label: label('Yes') }] }, expected: { kind: 'choice', value: 'yes' } },
    { kind: 'count', question: { ...number, type: 'list', maxItems: 10 }, expected: { kind: 'count', min: 1 } },
    { kind: 'unique', question: { ...number, type: 'list', maxItems: 10 }, expected: { kind: 'unique' } },
    { kind: 'total', question: { ...number, type: 'table', maxRows: 10, columns: [{ id: 'amount', label: label('Amount'), type: 'number', required: false }] },
      expected: { kind: 'total', columnIds: ['amount'], operator: 'equals', target: { kind: 'value', value: '' } } }
  ])('adds $kind through the labelled picker', async ({ kind, question, expected }) => {
    const wrapper = setup(question as AdvancedQuestion)
    await wrapper.get('select[name$="-kind"]').setValue(kind)
    await button(wrapper, 'Add answer rule').trigger('click')
    expect(wrapper.props('modelValue')).toEqual([expected])
  })
  it('offers compatible earlier comparisons with associated required errors and recovers', async () => {
    const wrapper = setup(number, undefined, [source, { id: 'other', type: 'text', label: 'Unrelated text' }])
    await button(wrapper, 'Add answer rule').trigger('click')
    const input = wrapper.get('input[name$="-value"]')
    expect(input.attributes('required')).toBeDefined()
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(wrapper.get(`#${input.attributes('aria-describedby')}`).text()).toBe('Enter a comparison value.')
    expect(wrapper.get('select[name$="-target"]').findAll('option').map(option => option.text()))
      .toEqual(['A fixed value', 'Answer to: Earlier amount'])
    await input.setValue('0')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.props('modelValue')).toEqual([{ kind: 'compare', operator: 'equals', target: { kind: 'value', value: '0' } }])
    await wrapper.get('select[name$="-operator"]').setValue('greaterThanOrEqual')
    await wrapper.get('select[name$="-target"]').setValue('earlier')
    expect(wrapper.text()).toContain('At least Answer to: Earlier amount')
    expect(wrapper.find('input[name$="-value"]').exists()).toBe(false)
  })
  it('uses date vocabulary and bilingual instructions for a two-rule window', async () => {
    const question: AdvancedQuestion = { ...number, type: 'date' }
    const wrapper = setup(question, [{ kind: 'compare', operator: 'greaterThanOrEqual', target: { kind: 'value', value: '2026-01-01' } },
      { kind: 'compare', operator: 'lessThanOrEqual', target: { kind: 'value', value: '2026-12-31' } }], [], 'fr')
    expect(wrapper.text()).toContain('Pour une période')
    expect(wrapper.text()).toContain('Le ou après le 2026-01-01')
    expect(wrapper.findAll('input[type="date"]')).toHaveLength(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
  it('preserves optional bounds, zero precision and incomplete conditional requirements', async () => {
    const text: AdvancedQuestion = { ...number, type: 'text', maxLength: 20 }
    const wrapper = setup(text, [{ kind: 'length', min: 2, max: 10 }])
    await wrapper.get('input[name$="-max"]').setValue('')
    expect(wrapper.props('modelValue')).toEqual([{ kind: 'length', min: 2 }])
    await wrapper.get('input[name$="-min"]').setValue('')
    expect(wrapper.text()).toContain('Enter at least one bound.')
    expect(wrapper.findAll('input').every(input => !input.attributes('required'))).toBe(true)
    const precision = setup(number, [{ kind: 'precision', decimalPlaces: 0 }])
    expect((precision.get('input').element as HTMLInputElement).value).toBe('0')
    await precision.get('input').setValue('')
    expect(precision.props('modelValue')).toEqual([{ kind: 'precision', decimalPlaces: -1 }])
    const required = setup(number, [{ kind: 'required', when: { match: 'all', conditions: [{ questionId: source.id, operator: 'answered' }] } }])
    await button(required, 'Remove rule').trigger('click')
    expect(required.text()).toContain('Add a condition for when this answer is required.')
    expect(required.text()).toContain('Add at least one condition.')
    expect(required.props('modelValue')).toEqual([{ kind: 'required', when: { match: 'all', conditions: [] } }])
  })
  it('gives multiple required conditions unique control names and obeys read-only state', async () => {
    const rules: FieldRule[] = [0, 1].map(() => ({ kind: 'required', when: { match: 'all', conditions: [{ questionId: source.id, operator: 'answered' }] } }))
    const wrapper = setup(number, rules)
    const names = wrapper.findAll('select').map(select => select.attributes('name'))
    expect(new Set(names).size).toBe(names.length)
    await wrapper.setProps({ disabled: true })
    expect(wrapper.findAll('select, input, button').every(control => control.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
  it('edits relative calendar dates with an explicit UTC anchor and signed day offset', async () => {
    const question: AdvancedQuestion = { ...number, type: 'date' }
    const wrapper = setup(question, [{ kind: 'compare', operator: 'lessThanOrEqual', target: { kind: 'today', offsetDays: 30 } }], [{ ...source, type: 'date' }])
    expect(wrapper.text()).toContain('On or before Today (UTC) (30 days)')
    expect(wrapper.text()).toContain('A positive number means days later')
    await wrapper.get('input[name$="-offset"]').setValue('-5')
    expect(wrapper.props('modelValue')).toEqual([{ kind: 'compare', operator: 'lessThanOrEqual', target: { kind: 'today', offsetDays: -5 } }])
    await wrapper.get('input[name$="-offset"]').setValue('')
    expect(wrapper.props('modelValue')).toEqual([{ kind: 'compare', operator: 'lessThanOrEqual', target: { kind: 'today' } }])
    await wrapper.get('select[name$="-target"]').setValue('earlier')
    expect(wrapper.props('modelValue')).toEqual([{ kind: 'compare', operator: 'lessThanOrEqual', target: { kind: 'question', questionId: 'earlier' } }])
  })
  it('guides standard formats and mandatory acknowledgement choices without raw patterns', async () => {
    const text: AdvancedQuestion = { ...number, type: 'text', maxLength: 100 }
    const wrapper = setup(text, [{ kind: 'format', format: 'postalCode' }])
    expect(wrapper.text()).toContain('K1A 0B1')
    await wrapper.get('select[name$="-format"]').setValue('identifier')
    expect(wrapper.text()).toContain('Start with a letter or digit')
    expect(wrapper.props('modelValue')).toEqual([{ kind: 'format', format: 'identifier' }])
    const choices: AdvancedQuestion = { ...number, type: 'checkboxes', options: [{ value: 'yes', label: label('I agree') }, { value: 'other', label: label('Other') }] }
    const acknowledgement = setup(choices, [{ kind: 'choice', value: 'yes' }])
    expect(acknowledgement.text()).toContain('Must include: I agree')
    expect(acknowledgement.get('select[name$="-choice"]').attributes('required')).toBeDefined()
    await acknowledgement.setProps({ question: { ...choices, options: choices.options.slice(1) } })
    expect(acknowledgement.text()).toContain('Choose an available choice.')
  })
  it('selects group completeness with the current question fixed and associated group errors', async () => {
    const wrapper = setup(number, [{ kind: 'group', mode: 'atLeastOne', questionIds: ['number', 'earlier'] }])
    expect(wrapper.get('fieldset legend').text()).toContain('Questions in this group (required)')
    expect(wrapper.findAll('input[type="checkbox"]').at(0)?.attributes('disabled')).toBeDefined()
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(false)
    expect(wrapper.text()).toContain('Select this question and at least one available earlier question')
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true)
    await wrapper.get('select[name$="-group-mode"]').setValue('allOrNone')
    expect(wrapper.text()).toContain('All answers or none: Number, Earlier amount')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('fieldset').attributes('aria-describedby')).toMatch(/selection-help$/)
  })
  it('selects entry keys and numeric table totals, keeping errors recoverable', async () => {
    const question: AdvancedQuestion = { ...number, type: 'table', maxRows: 10, columns: [
      { id: 'name', label: label('Name'), type: 'text', required: false }, { id: 'amount', label: label('Amount'), type: 'number', required: false }
    ] }
    const wrapper = setup(question, [{ kind: 'unique', columnIds: ['name'] },
      { kind: 'total', columnIds: ['amount'], operator: 'equals', target: { kind: 'value', value: '10' } }])
    expect(wrapper.findAll('fieldset')).toHaveLength(2)
    expect(wrapper.text()).toContain('Total of Amount: Equal to 10')
    const total = wrapper.findAll('.field-rule')[1]!
    expect(total.findAll('input[type="checkbox"]')).toHaveLength(1)
    await total.get('input[type="checkbox"]').setValue(false)
    expect(total.text()).toContain('Select available columns to check.')
    await total.get('input[type="checkbox"]').setValue(true)
    await total.get('select[name$="-total-target"]').setValue('earlier')
    expect(total.find('input[name$="-total-value"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
  it('limits column rules to same-row compatible columns and existing cell ceilings', async () => {
    const dateColumn = { id: 'end', label: label('End date'), type: 'date' as const, required: false }
    const wrapper = setup(dateColumn, [{ kind: 'compare', operator: 'greaterThanOrEqual', target: { kind: 'column', columnId: 'start' } }],
      [{ id: 'start', type: 'date', label: 'Start date' }, { id: 'amount', type: 'number', label: 'Amount' }])
    await wrapper.setProps({ scope: 'column' })
    expect(wrapper.get('select[name$="-target"]').findAll('option').map(option => option.text())).toEqual(['A fixed value', 'Answer to: Start date'])
    expect(wrapper.get('select[name$="-kind"]').findAll('option').map(option => option.text())).toEqual(['Compare an answer'])
    expect(wrapper.text()).toContain('same row')
    const textColumn = { ...dateColumn, type: 'text' as const }
    expect(fieldRuleCeiling(textColumn)).toBe(500)
    expect(fieldRuleError(textColumn, { kind: 'length', max: 501 }, [])).toBe('fieldRuleBoundsInvalid')
  })
  it('uses repeat child fields for duplicate detection and preserves unfinished selection', async () => {
    const question: AdvancedQuestion = { ...number, type: 'repeat', maxItems: 10 }
    const wrapper = setup(question, [{ kind: 'unique', questionIds: ['child'] }], [])
    await wrapper.setProps({ repeatQuestions: [{ id: 'child', type: 'email', label: 'Contact email' }] })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('fieldset').text()).toContain('Contact email')
    await wrapper.get('input[type="checkbox"]').setValue(false)
    expect(wrapper.props('modelValue')).toEqual([{ kind: 'unique', questionIds: [] }])
    expect(wrapper.text()).toContain('Select 1–20 different fields from this repeating set.')
  })
  it('preserves exact numeric comparison and reconciliation literals across SDK controls', async () => {
    const wrapper = setup(number, [{ kind: 'compare', operator: 'lessThanOrEqual', target: { kind: 'value', value: '' } }])
    const input = wrapper.get('input[name$="-value"]')
    expect(input.attributes('type')).toBe('text')
    expect(input.attributes('inputmode')).toBe('decimal')
    await input.setValue('9007199254740993.01')
    expect(wrapper.props('modelValue')).toEqual([{ kind: 'compare', operator: 'lessThanOrEqual', target: { kind: 'value', value: '9007199254740993.01' } }])
    const question: AdvancedQuestion = { ...number, type: 'table', maxRows: 10, columns: [{ id: 'amount', label: label('Amount'), type: 'number', required: false }] }
    const total = setup(question, [{ kind: 'total', columnIds: ['amount'], operator: 'equals', target: { kind: 'value', value: '' } }])
    expect(total.get('input[name$="-total-value"]').attributes('type')).toBe('text')
    await total.get('input[name$="-total-value"]').setValue('9007199254740993.01')
    expect(total.props('modelValue')?.[0]).toMatchObject({ target: { value: '9007199254740993.01' } })
  })
  it('shows typed email and numeric condition errors and recovers without losing values', async () => {
    const email: AdvancedQuestion = { ...number, type: 'email' }
    const wrapper = setup(email, [{ kind: 'compare', operator: 'equals', target: { kind: 'value', value: 'bad' } }])
    expect(wrapper.text()).toContain('Enter a valid email address.')
    await wrapper.get('input[name$="-value"]').setValue('person@example.ca')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const required = setup(number, [{ kind: 'required', when: { match: 'all', conditions: [{ questionId: source.id, operator: 'greaterThan', value: '1e2' }] } }])
    const input = required.get('input[name$="conditionValue0"]')
    expect(input.attributes('type')).toBe('text')
    expect(input.attributes('inputmode')).toBe('decimal')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(required.get(`#${input.attributes('aria-describedby')}`).text()).toContain('Complete the conditions')
    await input.setValue('9007199254740993.01')
    expect(required.find('[role="alert"]').exists()).toBe(false)
    expect(required.props('modelValue')?.[0]).toMatchObject({ when: { conditions: [{ value: '9007199254740993.01' }] } })
  })
  it('limits repeat identity selection to twenty fields without discarding existing choices', async () => {
    const question: AdvancedQuestion = { ...number, type: 'repeat', maxItems: 10 }
    const children = Array.from({ length: 21 }, (_, index) => ({ id: `child_${index}`, type: 'text' as const, label: `Child ${index}` }))
    const wrapper = setup(question, [{ kind: 'unique', questionIds: children.slice(0, 20).map(child => child.id) }], [])
    await wrapper.setProps({ repeatQuestions: children })
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes[20]!.attributes('disabled')).toBeDefined()
    await checkboxes[0]!.setValue(false)
    expect(checkboxes[20]!.attributes('disabled')).toBeUndefined()
    await checkboxes[20]!.setValue(true)
    expect(wrapper.props('modelValue')?.[0]).toMatchObject({ questionIds: children.slice(1).map(child => child.id) })
    expect(fieldRuleError(question, { kind: 'unique', questionIds: children.map(child => child.id) }, [], children)).toBe('fieldRuleUniqueInvalid')
  })
  it('keeps keyboard focus in the rule workflow after adding and removing a rule', async () => {
    const wrapper = mount(FormFieldRules, { attachTo: document.body, props: { question: number, questions: [source], locale: 'en', modelValue: undefined,
      'onUpdate:modelValue': value => { void wrapper.setProps({ modelValue: value }) } } })
    await button(wrapper, 'Add answer rule').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('select[name$="-operator"]').element)
    await button(wrapper, 'Remove answer rule 1').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('select[name$="-kind"]').element)
    wrapper.unmount()
  })
})

describe('rule authoring contracts', () => {
  it('resolves direct repeat fields against the source owner’s complete scope', () => {
    const repeat = (id: string): AdvancedQuestion => ({ id, type: 'repeat', label: label(id), required: false, maxItems: 10 })
    const text = (id: string): AdvancedQuestion => ({ id, type: 'text', label: label(id), required: false, maxLength: 100 })
    const definition: AdvancedSurvey = { schemaVersion: 5, title: label('Form'), questions: [repeat('people'), repeat('projects'), repeat('nested'),
      ...['direct', 'same_scope', 'deep', 'reused', 'nested_owned'].map(text)], pages: [{ id: 'page', title: label('Page'), questionIds: ['people', 'projects'], branches: [], groups: [
      { id: 'project_group', title: label('Projects'), repeatFor: 'projects', questionIds: ['direct'], groups: [
        { id: 'plain_group', title: label('Details'), questionIds: ['same_scope'], groups: [] },
        { id: 'deep_group', title: label('Deep'), repeatFor: 'people', questionIds: ['deep'], groups: [] }
      ] },
      { id: 'person_group', title: label('People'), repeatFor: 'people', questionIds: ['nested'], groups: [
        { id: 'reuse_group', title: label('Reuse'), repeatFor: 'projects', questionIds: ['reused'], groups: [] },
        { id: 'nested_group', title: label('Nested'), repeatFor: 'nested', questionIds: ['nested_owned'], groups: [] }
      ] }
    ] }] }
    expect(repeatFieldRuleSources(definition, 'projects', 'en').map(source => source.id)).toEqual(['direct', 'same_scope'])
    expect(repeatFieldRuleSources(definition, 'nested', 'en').map(source => source.id)).toEqual(['nested_owned'])
    expect(repeatFieldRuleSources(definition, 'missing', 'en')).toEqual([])
  })
  it('resolves compatible sources, explicit references, ceilings and invalid drafts', () => {
    expect(comparisonCompatible('email', 'text')).toBe(true)
    expect(comparisonCompatible('date', 'number')).toBe(false)
    expect(fieldRuleSourceIds({ kind: 'compare', operator: 'equals', target: { kind: 'question', questionId: 'earlier' } })).toEqual(['earlier'])
    expect(fieldRuleError(number, { kind: 'compare', operator: 'equals', target: { kind: 'value', value: 'abc' } }, [])).toBe('fieldRuleNumberInvalid')
    for (const value of ['+1', '1.', '9'.repeat(400)]) expect(fieldRuleError(number, { kind: 'compare', operator: 'equals', target: { kind: 'value', value } }, [])).toBe('fieldRuleNumberInvalid')
    expect(fieldRuleError({ ...number, type: 'date' }, { kind: 'compare', operator: 'equals', target: { kind: 'value', value: '2026-02-30' } }, [])).toBe('fieldRuleDateInvalid')
    const choices: AdvancedQuestion = { ...number, type: 'checkboxes', options: [{ value: 'one', label: label('One') }] }
    expect(fieldRuleCeiling(choices)).toBe(1)
    expect(fieldRuleError(choices, { kind: 'count', min: 2 }, [])).toBe('fieldRuleBoundsInvalid')
    expect(fieldRuleError(choices, { kind: 'count', min: 1, max: 0 }, [])).toBe('fieldRuleBoundsOrder')
    expect(fieldRuleSourceIds({ kind: 'group', mode: 'all', questionIds: ['number', 'earlier'] })).toEqual(['number', 'earlier'])
    expect(fieldRuleSourceIds({ kind: 'unique', questionIds: ['child'] })).toEqual(['child'])
    expect(fieldRuleSourceIds({ kind: 'total', columnIds: ['amount'], operator: 'equals', target: { kind: 'question', questionId: 'earlier' } })).toEqual(['earlier'])
  })
  it('restores incomplete v5 rules and rejects malformed nested targets', () => {
    const definition: AdvancedSurvey = { schemaVersion: 5, title: label('Form'), questions: [{ ...number, rules: [
      { kind: 'compare', operator: 'equals', target: { kind: 'value', value: '' } }, { kind: 'precision', decimalPlaces: -1 },
      { kind: 'required', when: { match: 'all', conditions: [] } }
    ] }], pages: [{ id: 'page', title: label('Page'), questionIds: ['number'], groups: [], branches: [] }] }
    const draft = { formId: 'draft', revision: 0, definition, saved: '', selectedContainerId: 'page', selectedQuestionId: 'number',
      tab: 'edit' as const, publicationScope: 'agreement' as const, agreementId: '', organizationId: '', programId: '', batchStreamId: '' }
    writeFormDraft('1', draft)
    expect(readFormDraft('1')?.definition.questions).toEqual(definition.questions)
    window.sessionStorage.setItem('gcs-ssc-portal-connector:forms:1:draft', JSON.stringify({ ...draft, definition: { ...definition,
      questions: [{ ...number, rules: [{ kind: 'compare', operator: 'equals', target: { kind: 'value', value: {} } }] }] } }))
    expect(readFormDraft('1')).toBeNull()
  })
})
