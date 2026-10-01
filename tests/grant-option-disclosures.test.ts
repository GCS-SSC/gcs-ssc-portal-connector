// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { defineComponent, h, reactive, ref } from 'vue'
import { expect, it } from 'vitest'
import { createExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'
import { setExtensionUiRuntime } from '@gcs-ssc/extensions/ui'
import GrantOptionEditor from '../components/GrantOptionEditor.vue'

const locale = ref('en')
const runtime = createExtensionTestUiRuntime()
runtime.composables.useI18n = () => ({ locale, n: value => String(value) })
runtime.components.CommonAssessmentSchemaAccordionSection = defineComponent({
  props: ['title'],
  setup(props, { slots }) { return () => h('section', [h('h3', String(props.title)), slots.default?.()]) }
})
runtime.components.UInput = defineComponent({
  props: ['modelValue'], emits: ['update:modelValue'],
  setup(props, { attrs, emit }) { return () => h('input', { ...attrs, value: props.modelValue,
    onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) }) }
})
runtime.components.UButton = defineComponent({
  setup(_, { attrs, slots }) { return () => h('button', attrs, slots.default?.()) }
})
setExtensionUiRuntime(runtime)
const button = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll('button').find(item => item.text() === label)!

  it('uses nested shared disclosures with bilingual option titles and preserves editing and locked controls', async () => {
    const options = reactive([{ id: 'category', label: { en: 'Travel', fr: 'Déplacements' } }])
    const wrapper = mount(GrantOptionEditor, { props: { title: 'Cost categories', options, prefix: 'budget-categories', disabled: false } })
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.findAll('h3').map(heading => heading.text())).toEqual(['Cost categories (1)', 'Travel'])
    expect(wrapper.get('section section').get('h3').text()).toBe('Travel')
    const english = wrapper.get('input[name="budget-categories-category-en"]')
    expect(english.attributes('required')).toBeDefined()
    expect(wrapper.get('input[name="budget-categories-category-fr"]').attributes('required')).toBeDefined()
    await english.setValue('Transportation')
    expect(options[0]!.label.en).toBe('Transportation')
    expect(wrapper.findAll('h3')[1]!.text()).toBe('Transportation')
    await button(wrapper, 'Add option').trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
    await wrapper.get('button[aria-label="Remove option: Transportation"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([['category']])
    locale.value = 'fr'
    await wrapper.setProps({ title: 'Catégories de coûts', disabled: true })
    expect(wrapper.findAll('h3').map(heading => heading.text())).toEqual(['Catégories de coûts (1)', 'Déplacements'])
    expect(wrapper.findAll('input').every(input => input.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.findAll('button').every(control => control.attributes('disabled') !== undefined)).toBe(true)
    await wrapper.setProps({ options: [] })
    expect(wrapper.findAll('h3').map(heading => heading.text())).toEqual(['Catégories de coûts (0)'])
    expect(wrapper.text()).toContain('Ajouter un choix')
    wrapper.unmount()
  })
