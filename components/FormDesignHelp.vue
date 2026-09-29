<script setup lang="ts">
import { useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'

const { topic } = defineProps<{ topic: 'Basics' | 'Visibility' | 'Dependencies' | 'Computed' | 'Branching' | 'Repeats' }>()
const { t } = useExtensionI18n(messages)
const itemReference = '{{item}}'
</script>

<template>
  <details class="border-b border-default py-3 text-sm" :data-design-help="topic">
    <summary class="font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-4">
      {{ t(`design${topic}Title`) }}
    </summary>
    <div class="space-y-3 pt-3 text-muted">
      <p>{{ t(`design${topic}Intro`) }}</p>
      <ol class="list-decimal space-y-2 pl-5">
        <li>{{ t(`design${topic}Step1`) }}</li>
        <li>{{ t(`design${topic}Step2`) }}</li>
        <li>{{ t(`design${topic}Step3`, { itemReference }) }}</li>
      </ol>
      <p class="text-default">
        {{ t(`design${topic}Example`) }}
      </p>
      <p><strong class="font-medium text-default">{{ t('designGuideTest') }}</strong> {{ t(`design${topic}Test`) }}</p>
    </div>
  </details>
</template>
