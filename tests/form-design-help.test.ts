// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { afterEach, expect, it } from 'vitest'
import { createExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'
import { setExtensionUiRuntime } from '@gcs-ssc/extensions/ui'
import FormDesignHelp from '../components/FormDesignHelp.vue'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })

it('renders every guide topic in both languages and reacts to a locale change through the SDK', async () => {
  const locale = ref('en')
  const runtime = createExtensionTestUiRuntime()
  runtime.composables.useI18n = () => ({ locale, n: value => String(value) })
  setExtensionUiRuntime(runtime)
  for (const topic of ['Basics', 'Visibility', 'Dependencies', 'Computed', 'Branching', 'Repeats'] as const) {
    const wrapper = mount(FormDesignHelp, { props: { topic } })
    wrappers.push(wrapper)
    expect(wrapper.find('summary').exists()).toBe(true)
    expect(wrapper.findAll('ol li')).toHaveLength(3)
    expect(wrapper.text()).toContain('What to test:')
  }
  const computed = wrappers[3]!
  expect(computed.text()).toContain('Arithmetic and formulas are not supported')
  expect(wrappers[4]!.text()).toContain('first matching rule wins')
  expect(wrappers[5]!.text()).toContain('{{item}}')
  locale.value = 'fr'
  await nextTick()
  for (const wrapper of wrappers) {
    expect(wrapper.text()).toContain('À tester :')
    expect(wrapper.text()).not.toContain('What to test')
  }
  expect(computed.text()).toContain('ne sont pas prises en charge')
  expect(wrappers[5]!.text()).toContain('{{item}}')
})
