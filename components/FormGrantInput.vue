<script setup lang="ts">
import type { GrantInput, GrantIssue } from '@gcs-ssc/survey'
import { ExtensionFormField, ExtensionInput, ExtensionSelect, ExtensionTextarea } from '@gcs-ssc/extensions/ui'
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { messages } from '../i18n/messages'

const props = defineProps<{ input: GrantInput; id: string; disabled: boolean; locale: 'en' | 'fr'; error?: GrantIssue['code'] }>()
const emit = defineEmits<{ change: [value: string] }>()
const t = (key: string) => translateGcsExtensionMessage(messages, props.locale, key as keyof typeof messages.en)
const text = (value: unknown) => value == null ? '' : String(value)
</script>

<template>
  <div class="min-w-0">
    <ExtensionFormField
      :label="`${t(input.label)}${input.required && !input.readonly ? ` ${t('previewRequired')}` : ''}`" :name="id"
      :error="error ? t(`grantError_${error}`) : undefined"
      :description="input.type === 'money' && !input.readonly ? t('grantMoneyHint') : undefined">
      <ExtensionSelect
        v-if="input.type === 'select'" :id="id" :model-value="input.value" :name="id"
        :items="input.options" :placeholder="t('grantChoose')" value-key="value" :required="input.required" :disabled="disabled || input.readonly"
        @update:model-value="emit('change', text($event))" />
      <ExtensionTextarea
        v-else-if="input.type === 'textarea'" :id="id" :model-value="input.value" :name="id" :rows="3" :maxlength="input.maxLength"
        :required="input.required" :disabled="disabled" @update:model-value="emit('change', text($event))" />
      <ExtensionInput
        v-else :id="id" :model-value="input.value" :name="id" :type="input.type === 'date' ? 'date' : 'text'"
        :inputmode="input.type === 'money' || input.type === 'percentage' ? 'decimal' : undefined" :maxlength="input.maxLength"
        :required="input.required && !input.readonly" :disabled="disabled" :readonly="input.readonly" @update:model-value="emit('change', text($event))" />
    </ExtensionFormField>
  </div>
</template>
