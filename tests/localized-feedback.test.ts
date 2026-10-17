import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { messages } from '../i18n/messages'
import { feedback, useLocalizedFeedback } from '../components/localized-feedback'

describe('localized retained feedback', () => {
  it('keeps semantic keys and interpolation across locale changes while preserving API text', () => {
    const locale = ref('en')
    const value = useLocalizedFeedback((key, values) => translateGcsExtensionMessage(messages, locale.value, key, values))
    const rendered = computed(() => value.value)
    value.value = feedback('formInvalidDefinition', { fields: 'Question 1' })
    expect(rendered.value).toBe(translateGcsExtensionMessage(messages, 'en', 'formInvalidDefinition', { fields: 'Question 1' }))
    locale.value = 'fr-CA'
    expect(rendered.value).toBe(translateGcsExtensionMessage(messages, 'fr', 'formInvalidDefinition', { fields: 'Question 1' }))
    value.value = 'Localized API error'
    locale.value = 'en'
    expect(rendered.value).toBe('Localized API error')
    value.value = ''
    expect(rendered.value).toBe('')
  })
})
