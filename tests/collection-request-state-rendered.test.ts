// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translateGcsExtensionMessage, type GcsExtensionMessages } from '@gcs-ssc/extensions'
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../components/FormCreator.vue', () => ({ default: defineComponent({ setup: () => () => h('div') }) }))
vi.mock('@gcs-ssc/extensions/ui', () => {
  const input = defineComponent({ props: ['modelValue', 'name', 'disabled'], emits: ['update:modelValue'],
    setup: (props, { emit }) => () => h('input', { name: props.name, value: props.modelValue, disabled: props.disabled,
      onInput: (event: Event) => { if (event.target instanceof HTMLInputElement) emit('update:modelValue', event.target.value) } }) })
  return { useExtensionApi: () => api,
    useExtensionI18n: (catalog: GcsExtensionMessages) => ({ locale: computed(() => 'en'),
      t: (key: string, values?: Record<string, string | number>) => translateGcsExtensionMessage(catalog, 'en', key, values) }),
    ExtensionButton: defineComponent({ props: ['disabled', 'loading'], emits: ['click'],
      setup: (props, { emit, slots, attrs }) => () => h('button', { ...attrs, disabled: props.disabled,
        'aria-busy': props.loading, onClick: () => emit('click') }, slots.default?.()) }),
    ExtensionBadge: defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) }),
    ExtensionFormField: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
    ExtensionInput: input, ExtensionTextarea: input,
    ExtensionModal: defineComponent({ props: ['open'], setup: (props, { slots }) =>
      () => props.open ? h('div', { role: 'dialog' }, slots.body?.()) : null }),
    ExtensionResourceLayout: defineComponent({ props: ['data'], setup: (props) =>
      () => h('div', { 'data-rows': '' }, JSON.stringify(props.data)) }) }
})
import FormLibrary from '../components/FormLibrary.vue'
import OpportunityForms from '../components/OpportunityForms.vue'
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => { throw new Error('Promise not initialized') }
  const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve }
}
const context = (agencyId: string, opportunityId: string) => ({ target: 'opportunity' as const,
  agencyId, opportunityId, streamId: '31', ownerType: 'fundingopportunity' as const, ownerId: opportunityId,
  scope: { type: 'agency' as const, agencyId } })
const wrappers: ReturnType<typeof mount>[] = []
const render = () => { const wrapper = mount(FormLibrary, { props: { agencyId: '1' } }); wrappers.push(wrapper); return wrapper }
const form = (name: string) => ({ surveyId: name, revision: 1, title: { en: name, fr: name } })
beforeEach(() => { vi.resetAllMocks(); api.get.mockResolvedValue({ surveys: [], publications: [] }) })
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })
describe('Portal collection request ownership', () => {
  it('ignores old Agency collection data', async () => {
    const old = deferred<unknown>()
    api.get.mockImplementation((path: string) => path === '/agencies/1/forms' ? old.promise
      : Promise.resolve({ surveys: [{ id: 'current', title: { en: 'Current', fr: 'Courant' }, revision: 1, updatedAt: '2026-01-01' }] }))
    const wrapper = render(); await wrapper.setProps({ agencyId: '2' }); await flushPromises()
    old.resolve({ surveys: [{ id: 'old', title: { en: 'Previous', fr: 'Ancien' }, revision: 1, updatedAt: '2026-01-01' }] })
    await flushPromises(); expect(wrapper.get('[data-rows]').text()).toContain('Current'); expect(wrapper.text()).not.toContain('Previous')
  })
  it('does not close or navigate from an old create when the dialog is replaced', async () => {
    const old = deferred<{ survey: { id: string } }>(); api.post.mockReturnValue(old.promise)
    const wrapper = render(); await flushPromises(); await wrapper.get('button').trigger('click')
    await wrapper.get('input[name=formTitleEn]').setValue('Old'); await wrapper.get('input[name=formTitleFr]').setValue('Ancien')
    await wrapper.get('form').trigger('submit'); expect(api.post).toHaveBeenCalledTimes(1)
    await wrapper.get('button').trigger('click'); await wrapper.get('input[name=formTitleEn]').setValue('Replacement')
    old.resolve({ survey: { id: 'old-form' } }); await flushPromises()
    expect(wrapper.emitted('open')).toBeUndefined(); expect(wrapper.get<HTMLInputElement>('input[name=formTitleEn]').element.value).toBe('Replacement')
    expect(wrapper.get('[role=dialog] button[type=submit]').attributes('aria-busy')).toBe('false')
  })
  it('invalidates pending create navigation after Agency replacement and unmount', async () => {
    const old = deferred<{ survey: { id: string } }>(); api.post.mockReturnValue(old.promise)
    const wrapper = render(); await flushPromises(); await wrapper.get('button').trigger('click')
    await wrapper.get('input[name=formTitleEn]').setValue('Old'); await wrapper.get('input[name=formTitleFr]').setValue('Ancien')
    await wrapper.get('form').trigger('submit'); await wrapper.setProps({ agencyId: '2' }); wrapper.unmount()
    old.resolve({ survey: { id: 'old-form' } }); await flushPromises(); expect(wrapper.emitted('open')).toBeUndefined()
  })
  it('does not refresh or announce an old Opportunity publication in a replacement context', async () => {
    api.get.mockImplementation((path: string) => Promise.resolve({ forms: [form(path.includes('/181/') ? 'Previous' : 'Current')], published: false, canWrite: true }))
    const old = deferred<unknown>(); api.post.mockReturnValue(old.promise)
    const wrapper = mount(OpportunityForms, { props: { context: context('1', '181') } }); wrappers.push(wrapper); await flushPromises()
    const publish = wrapper.findAll('button').find(button => button.text() === 'Publish opportunity')!
    await publish.trigger('click'); await wrapper.setProps({ context: context('2', '182') }); await flushPromises()
    expect(api.get).toHaveBeenCalledTimes(2); old.resolve({ published: true }); await flushPromises()
    expect(api.get).toHaveBeenCalledTimes(2); expect(wrapper.get('[data-rows]').text()).toContain('Current')
    expect(wrapper.text()).not.toContain('Opportunity published')
    expect(wrapper.findAll('button').find(button => button.text() === 'Publish opportunity')?.attributes('disabled')).toBeUndefined()
  })
})
