// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, h, reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { translateGcsExtensionMessage, type GcsExtensionMessages } from '@gcs-ssc/extensions'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
const current = reactive({ locale: 'en' as 'en' | 'fr' })
vi.mock('@gcs-ssc/extensions/ui', () => ({
  useExtensionApi: () => api,
  useExtensionI18n: (catalog: GcsExtensionMessages) => ({ locale: computed(() => current.locale),
    t: (key: string) => translateGcsExtensionMessage(catalog, current.locale, key) }),
  ExtensionAlert: defineComponent({ props: ['description'], setup: props => () => h('p', { role: 'status' }, props.description) }),
  ExtensionButton: defineComponent({ props: ['label', 'disabled'], emits: ['click'], setup: (props, { emit }) =>
    () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, props.label) }),
  ExtensionSaveButton: defineComponent({ props: ['label', 'disabled'], emits: ['click'], setup: (props, { emit }) =>
    () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, props.label) }),
  ExtensionFormField: defineComponent({ props: ['label', 'name', 'required', 'description'], setup: (props, { slots }) =>
    () => h('div', [h('label', { for: props.name }, `${props.label}${props.required ? ' (required)' : ''}`),
      h('p', props.description), slots.default?.()]) }),
  ExtensionSelect: defineComponent({ props: ['modelValue', 'name', 'items', 'disabled'], emits: ['update:modelValue'],
    setup: (props, { attrs, emit }) => () => h('select', { ...attrs, id: props.name, value: props.modelValue,
      disabled: props.disabled, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value) },
    props.items.map((item: { value: string; label: string }) => h('option', { value: item.value }, item.label))) })
}))
import IntakeImportSettings from '../components/IntakeImportSettings.vue'

const available = { groups: [{ id: '11', nameEn: 'Health intake', nameFr: 'Réception santé' }], intakeGroupId: null, ready: false }
describe('intake import group control', () => {
  it('keeps group selection optional, explains import prerequisite, saves/clears and switches catalogs live', async () => {
    current.locale = 'en'
    api.get.mockResolvedValue(available)
    api.put.mockImplementation(async (_path, body) => ({ ...available, ...body, ready: body.intakeGroupId !== null }))
    const wrapper = mount(IntakeImportSettings, { props: { agencyId: '1' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Select an intake group to enable funding application imports.')
    const selection = wrapper.get('select')
    expect(selection.attributes('required')).toBeUndefined()
    expect(wrapper.findAll('option').every(option => option.attributes('value') !== '')).toBe(true)
    expect(selection.attributes('aria-required')).toBeUndefined()
    expect(selection.attributes('aria-label')).toBe('Intake group')
    expect(wrapper.get('label').text()).toBe('Intake group')
    await selection.setValue('11')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(api.put).toHaveBeenLastCalledWith('/agencies/1/intake-group-settings', { intakeGroupId: '11' })
    expect(wrapper.text()).toContain('Intake settings saved.')
    current.locale = 'fr'
    await flushPromises()
    expect(wrapper.get('label').text()).toBe('Groupe de réception des demandes')
    expect(wrapper.get('select').attributes('aria-label')).toBe('Groupe de réception des demandes')
    expect(wrapper.text()).toContain('Réception santé')
    await wrapper.get('select').setValue('__none__')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(api.put).toHaveBeenLastCalledWith('/agencies/1/intake-group-settings', { intakeGroupId: null })
    expect(wrapper.text()).toContain('Sélectionnez un groupe de réception pour activer')
    await wrapper.setProps({ readOnly: true })
    expect(wrapper.get('select').attributes('disabled')).toBeDefined()
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })

  it('displays unavailable stored selection and discards late responses from another agency', async () => {
    current.locale = 'en'
    let finishOld: (value: unknown) => void = () => {}
    api.get.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce({ groups: [], intakeGroupId: '99', ready: false })
    const wrapper = mount(IntakeImportSettings, { props: { agencyId: '1' } })
    await wrapper.setProps({ agencyId: '2' })
    await flushPromises()
    expect(wrapper.text()).toContain('The selected group is unavailable.')
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('99')
    finishOld({ ...available, intakeGroupId: '11', ready: true })
    await flushPromises()
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('99')
    expect(wrapper.text()).not.toContain('Health intake')
    wrapper.unmount()
  })
})
