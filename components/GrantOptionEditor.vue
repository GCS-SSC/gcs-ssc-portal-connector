<script setup lang="ts">
import type { GrantOption } from '@gcs-ssc/survey'
import { ExtensionButton, ExtensionFormField, ExtensionInput, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'

const props = defineProps<{ title: string; options: GrantOption[]; disabled: boolean; prefix: string }>()
const emit = defineEmits<{ add: []; remove: [id: string] }>()
const { t } = useExtensionI18n(messages)
</script>

<template>
  <details class="border-t border-default py-3">
    <summary class="font-medium">
      {{ title }} <span class="text-muted">({{ options.length }})</span>
    </summary>
    <div class="mt-4 space-y-3">
      <div v-for="option in props.options" :key="option.id" class="rounded-lg border border-default p-3 space-y-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <ExtensionFormField :label="t('grantLabelEn')" :name="`${prefix}-${option.id}-en`" required>
            <ExtensionInput v-model="option.label.en" :name="`${prefix}-${option.id}-en`" required maxlength="255" :disabled="disabled" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('grantLabelFr')" :name="`${prefix}-${option.id}-fr`" required>
            <ExtensionInput v-model="option.label.fr" :name="`${prefix}-${option.id}-fr`" required maxlength="255" :disabled="disabled" />
          </ExtensionFormField>
        </div>
        <slot :option="option" />
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs text-muted">
            {{ option.gcsId ? t('grantMapped') : t('grantUnmapped') }}
          </p>
          <ExtensionButton
            type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="`${t('grantRemoveOption')}: ${option.label.en}`"
            :disabled="disabled" @click="emit('remove', option.id)" />
        </div>
      </div>
      <ExtensionButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="disabled || options.length >= 200" @click="emit('add')">
        {{ t('grantAddOption') }}
      </ExtensionButton>
    </div>
  </details>
</template>
