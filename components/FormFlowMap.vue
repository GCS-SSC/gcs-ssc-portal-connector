<script setup lang="ts">
import { computed } from 'vue'
import type { AdvancedSurvey } from '@gcs-ssc/survey'
import { ExtensionAssessmentSchemaPageSection, ExtensionFlowDiagram, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import { createFormFlowDiagram } from '../shared/form-diagram'

const props = defineProps<{
  definition: AdvancedSurvey
  locale: 'en' | 'fr'
}>()
const { t } = useExtensionI18n(messages)
const diagram = computed(() => createFormFlowDiagram(props.definition, props.locale, t))
</script>

<template>
  <ExtensionAssessmentSchemaPageSection section-id="form-flow-diagram" :title="t('formFlowTitle')">
    <ExtensionFlowDiagram :definition="diagram" direction="vertical" filename="form-page-flow" />
  </ExtensionAssessmentSchemaPageSection>
</template>
