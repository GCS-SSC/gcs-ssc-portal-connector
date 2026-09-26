// @vitest-environment jsdom
import { translateGcsExtensionMessage, type GcsExtensionMessages } from '@gcs-ssc/extensions'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'fr' }))
const get = vi.fn()
const post = vi.fn()
const hostGet = vi.fn()

vi.mock('@gcs-ssc/extensions/ui', () => {
  const field = defineComponent({
    props: ['label', 'name', 'required', 'description'],
    setup(props, { slots }) {
      return () => h('div', { 'data-field': props.name }, [
        h('label', { for: props.name }, `${props.label}${props.required ? ' (required)' : ''}`),
        props.description ? h('p', props.description) : null,
        slots.default?.()
      ])
    }
  })
  const input = defineComponent({
    props: ['modelValue', 'name', 'type', 'required', 'disabled', 'min', 'max'], emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => h('input', { ...attrs, name: props.name, type: props.type, value: props.modelValue,
        required: props.required, disabled: props.disabled, min: props.min, max: props.max,
        onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) })
    }
  })
  const select = defineComponent({
    props: ['modelValue', 'name', 'items', 'disabled'], emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => h('select', { ...attrs, name: props.name, value: props.modelValue, disabled: props.disabled,
        onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value) },
      (props.items as Array<{ value: string; label: string }> ?? []).map(item => h('option', { value: item.value }, item.label)))
    }
  })
  const checkbox = defineComponent({
    props: ['modelValue', 'label', 'disabled'], emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => h('label', [h('input', { ...attrs, type: 'checkbox', checked: props.modelValue, disabled: props.disabled,
        onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).checked) }), props.label])
    }
  })
  const button = defineComponent({
    props: ['label', 'disabled'], emits: ['click'],
    setup(props, { emit, slots }) {
      return () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, props.label ?? slots.default?.())
    }
  })
  return {
    useExtensionI18n: (messages: GcsExtensionMessages) => ({
      locale: { get value() { return state.locale } },
      t: (key: string) => translateGcsExtensionMessage(messages, state.locale, key)
    }),
    useExtensionApi: () => ({ get, post, put: vi.fn() }), useHostApi: () => ({ get: hostGet }),
    ExtensionFormField: field, ExtensionInput: input, ExtensionSelect: select,
    ExtensionCheckbox: checkbox, ExtensionButton: button, ExtensionSaveButton: button
  }
})

import FormCreator from '../components/FormCreator.vue'
import PortalConnection from '../components/PortalConnection.vue'

const button = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll('button').find(item => item.text() === label)!

beforeEach(() => {
  state.locale = 'en'
  get.mockReset().mockImplementation(async (path: string) => {
    if (path.endsWith('/forms')) return { surveys: [], streams: [], agreements: [], calls: [] }
    if (path.endsWith('/connection')) return { connection: { portalUrl: 'https://portal.example/', portalAgencyId: 'G-ABCDE', hasCredential: true } }
    if (path.endsWith('/receipts')) return { receipts: [] }
    if (path.endsWith('/organizations')) return { organizations: [{ id: 'N-ABCDE', name: 'Test organization', active: true, verified: false, foreignApplicantRecipientId: null }] }
    if (path.endsWith('/backlog')) return { backlog: [], outcomes: [], inbound: [] }
    if (path.endsWith('/settings')) return { statuses: [], settings: null }
    return {}
  })
  hostGet.mockReset().mockResolvedValue({ items: [{ id: '7', egcs_ar_legalname_en: 'Recipient', egcs_ar_legalname_fr: 'Bénéficiaire' }] })
  post.mockReset().mockResolvedValue({ survey: { id: 'survey_1', revision: 1 }, results: [] })
})

describe('connector form requirements', () => {
  it.each([
    ['text', 'maxLength', 'maxLength-error', 'Enter a whole number from 1 to 5000.'],
    ['list', 'maxItems', 'maxItems-error', 'Enter a whole number from 1 to 50.'],
    ['table', 'maxRows', 'maxRows-error', 'Enter a whole number from 1 to 100.']
  ])('renders required %s limits and blocks a cleared limit at the survey validation boundary', async (type, name, errorId, errorText) => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await wrapper.get('input[name="formTitleEn"]').setValue('Title')
    await wrapper.get('input[name="formTitleFr"]').setValue('Titre')
    await wrapper.get('select[name="newQuestionType"]').setValue(type)
    const limit = wrapper.get(`input[name="${name}"]`)
    expect(limit.attributes('required')).toBeDefined()
    await limit.setValue('')
    expect(wrapper.get(`input[name="${name}"]`).element).toHaveProperty('value', '')
    expect(wrapper.get(`input[name="${name}"]`).attributes('aria-describedby')).toBe(errorId)
    expect(wrapper.get(`#${errorId}`).text()).toBe(errorText)
    await button(wrapper, 'Save form revision').trigger('click')
    expect(post).not.toHaveBeenCalled()
  })

  it('identifies computed sources as a required group and requires one before save', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await wrapper.get('input[name="formTitleEn"]').setValue('Title')
    await wrapper.get('input[name="formTitleFr"]').setValue('Titre')
    await wrapper.get('select[name="newQuestionType"]').setValue('text')
    await wrapper.get('select[name="newQuestionType"]').setValue('computed')
    const group = wrapper.get('[role="group"][aria-labelledby="computed-sources-label"]')
    expect(group.attributes('aria-describedby')).toBe('computed-sources-help')
    expect(wrapper.get('#computed-sources-label').text()).toContain('(required)')
    await button(wrapper, 'Save form revision').trigger('click')
    expect(post).not.toHaveBeenCalled()
    await group.get('input[type="checkbox"]').setValue(true)
    await button(wrapper, 'Save form revision').trigger('click')
    expect(post).toHaveBeenCalledWith('/agencies/1/forms', expect.objectContaining({
      definition: expect.objectContaining({ questions: expect.arrayContaining([expect.objectContaining({ type: 'computed', sourceIds: [expect.any(String)] })]) })
    }))
  })

  it('associates organization choice guidance and disables invalid organization and backlog actions', async () => {
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', enabled: true } })
    await flushPromises()
    const group = wrapper.get('[role="group"][aria-describedby="portal-organization-rule"]')
    expect(wrapper.get('#portal-organization-rule').text()).toContain('(required)')
    expect(group.get('input[name="organizationCode"]').attributes('aria-describedby')).toBe('portal-organization-rule')
    await wrapper.get('select[name="proponentId"]').setValue('7')
    await group.get('input[name="organizationCode"]').setValue('bad')
    expect(wrapper.get('#portal-organization-error').text()).toBe('Enter a valid N- organization code.')
    expect(button(wrapper, 'Verify and link organization').attributes('disabled')).toBeDefined()
    await group.get('input[name="organizationCode"]').setValue('N-ABCDE')
    expect(button(wrapper, 'Verify and link organization').attributes('disabled')).toBeUndefined()
    await wrapper.get('input[name="pushCount"]').setValue('')
    expect(wrapper.get('input[name="pushCount"]').attributes('required')).toBeDefined()
    expect(wrapper.get('#push-count-error').text()).toBe('Enter a whole number from 1 to 100.')
    expect(button(wrapper, 'Push pending items').attributes('disabled')).toBeDefined()
    await wrapper.get('input[name="pushCount"]').setValue('11')
    await button(wrapper, 'Push pending items').trigger('click')
    expect(post).toHaveBeenCalledWith('/agencies/1/backlog', { limit: 11 })
  })

  it('renders the new group instruction and validation errors in French', async () => {
    state.locale = 'fr'
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', enabled: true } })
    await flushPromises()
    expect(wrapper.get('#portal-organization-rule').text()).toContain('(obligatoire)')
    await wrapper.get('input[name="organizationCode"]').setValue('bad')
    expect(wrapper.get('#portal-organization-error').text()).toBe('Saisissez un code d’organisme N- valide.')
    await wrapper.get('input[name="pushCount"]').setValue('')
    expect(wrapper.get('#push-count-error').text()).toBe('Saisissez un nombre entier de 1 à 100.')
  })
})
