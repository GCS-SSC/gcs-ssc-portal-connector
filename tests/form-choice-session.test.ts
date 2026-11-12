// @vitest-environment jsdom
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import FormChoiceEditor from '../components/FormChoiceEditor.vue'

vi.mock('@gcs-ssc/extensions/ui', () => ({
  useExtensionI18n: (catalog: Parameters<typeof translateGcsExtensionMessage>[0]) => ({
    locale: ref('en'),
    t: (key: string, values?: Parameters<typeof translateGcsExtensionMessage>[3]) => translateGcsExtensionMessage(catalog, 'en', key, values)
  }),
  ExtensionButton: defineComponent({
    props: ['disabled'],
    setup(props, { slots, attrs }) { return () => h('button', { ...attrs, disabled: props.disabled }, slots.default?.()) }
  }),
  ExtensionFormField: defineComponent({
    setup(_, { slots }) { return () => h('div', slots.default?.()) }
  }),
  ExtensionInput: defineComponent({
    props: ['modelValue'], emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => h('input', { ...attrs, value: props.modelValue, onInput: (event: Event) => {
        if (event.target instanceof HTMLInputElement) emit('update:modelValue', event.target.value)
      } })
    }
  }),
  ExtensionModal: defineComponent({
    props: ['open', 'title'], emits: ['update:open'],
    setup(props, { slots }) { return () => props.open ? h('section', { role: 'dialog' }, [h('h2', props.title), slots.body?.()]) : null }
  }),
  ExtensionTable: defineComponent({
    props: ['data'],
    setup(props, { slots }) {
      return () => h('div', (props.data ?? []).map((original: unknown) => slots['actions-cell']?.({ row: { original } })))
    }
  })
}))

const options = () => [
  { value: 'first', label: { en: 'First', fr: 'Premier' } },
  { value: 'second', label: { en: 'Second', fr: 'Deuxième' } }
]
const setup = () => mount(FormChoiceEditor, { props: { options: options(), disabled: false, questionId: 'question' } })

describe('choice editor sessions', () => {
  it('keeps edit identity and creates a distinct stable option after closing', async () => {
    const wrapper = setup()
    await wrapper.get('button[aria-label="Edit choice: First"]').trigger('click')
    await wrapper.get('input[name="choiceEn"]').setValue('Renamed')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('update:options')?.[0]?.[0]).toEqual([
      { value: 'first', label: { en: 'Renamed', fr: 'Premier' } }, options()[1]
    ])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await wrapper.get('button').trigger('click')
    await wrapper.get('input[name="choiceEn"]').setValue('Third')
    await wrapper.get('input[name="choiceFr"]').setValue('Troisième')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('update:options')?.[1]?.[0]).toEqual([
      ...options(), { value: expect.stringMatching(/^option_/), label: { en: 'Third', fr: 'Troisième' } }
    ])
    wrapper.unmount()
  })

  it('cancels drafts and clears both editor and deletion confirmation on question replacement', async () => {
    const wrapper = setup()
    await wrapper.get('button').trigger('click')
    await wrapper.get('input[name="choiceEn"]').setValue('Uncommitted')
    await wrapper.get('button[aria-label="Delete choice: First"]').trigger('click')
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(2)
    await wrapper.setProps({ questionId: 'replacement', options: [{ value: 'other', label: { en: 'Other', fr: 'Autre' } }] })
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(0)
    expect(wrapper.emitted('update:options')).toBeUndefined()
    expect(wrapper.get('button[aria-label="Delete choice: Other"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
