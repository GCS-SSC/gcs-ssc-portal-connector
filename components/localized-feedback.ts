import { computed, shallowRef } from 'vue'
import type { messages } from '../i18n/messages'

type MessageKey = keyof typeof messages.en
type Values = Record<string, string | number>
export type Feedback = { key: MessageKey; values?: Values }

export const feedback = (key: MessageKey, values?: Values): Feedback => ({ key, values })

/** Keep catalog identity until render; already-localized API messages remain display-ready. */
export const useLocalizedFeedback = (t: (key: MessageKey, values?: Values) => string) => {
  const source = shallowRef<string | Feedback>('')
  return computed<string, string | Feedback>({
    get: () => typeof source.value === 'string' ? source.value : t(source.value.key, source.value.values),
    set: value => { source.value = value }
  })
}
