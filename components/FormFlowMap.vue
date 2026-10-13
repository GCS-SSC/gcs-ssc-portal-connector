<script setup lang="ts">
import { computed } from 'vue'
import type { AdvancedSurvey } from '@gcs-ssc/survey'
import { ExtensionAssessmentSchemaPageSection, ExtensionFlowDiagram, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import { createFormFlowDiagram } from '../shared/form-diagram'

const props = defineProps<{
  definition: AdvancedSurvey
  locale: 'en' | 'fr'
  selectedPageId?: string
}>()
const emit = defineEmits<{ 'select-page': [pageId: string] }>()
const { t } = useExtensionI18n(messages)
const diagram = computed(() => createFormFlowDiagram(props.definition, props.locale, t))
const selectPage = (nodeId: string) => emit('select-page', nodeId.slice('page:'.length))
</script>

<template>
  <ExtensionAssessmentSchemaPageSection section-id="form-flow-diagram" :title="t('formFlowTitle')">
    <ExtensionFlowDiagram :definition="diagram" :selected-node-id="selectedPageId ? `page:${selectedPageId}` : undefined"
      filename="form-page-flow" @select-node="selectPage" />
  </ExtensionAssessmentSchemaPageSection>
</template>
