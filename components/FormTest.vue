<script setup lang="ts">
import { ref, watch } from 'vue'
import { HeadlessSurvey, type SurveyField } from '@gcs-ssc/survey/vue'
import type { AdvancedSurvey, ResolvedAdvancedGroup, ResolvedAdvancedPage } from '@gcs-ssc/survey'
import { ExtensionButton } from '@gcs-ssc/extensions/ui'
import FormTestControl from './FormTestControl.vue'
const props = defineProps<{ definition: AdvancedSurvey; locale: 'en' | 'fr' }>()
const answers = ref<Record<string, string>>({})
watch(() => props.definition, () => { answers.value = {} }, { deep: true })
type Entry = { kind: 'heading'; title: string; depth: number } | { kind: 'field'; id: string }
const layout = (page: ResolvedAdvancedPage): Entry[] => {
  const visit = (groups: ResolvedAdvancedGroup[], depth: number): Entry[] => groups.flatMap((group) => [
    { kind: 'heading' as const, title: group.title[props.locale], depth },
    ...group.questionIds.map((id) => ({ kind: 'field' as const, id })),
    ...visit(group.groups, depth + 1)
  ])
  return [...page.questionIds.map((id) => ({ kind: 'field' as const, id })), ...visit(page.groups, 1)]
}
const fieldFor = (fields: SurveyField[], id: string) => fields.find((field) => field.id === id)
</script>
<template>
  <div class="space-y-4">
    <p class="text-sm text-muted">{{ locale === 'fr' ? 'Aperçu seulement. Aucune réponse n’est enregistrée.' : 'Preview only. No responses are saved.' }}</p>
    <HeadlessSurvey v-model="answers" :definition="definition" :locale="locale">
      <template #default="{ fields, page, pageIndex, canBack, isLastPage, complete, next, back }">
        <h4 class="text-lg font-semibold">{{ definition.title[locale] }}</h4>
        <template v-if="page && 'groups' in page">
          <p class="font-medium">{{ locale === 'fr' ? 'Page' : 'Page' }} {{ pageIndex + 1 }} · {{ page.title[locale] }}</p>
          <template v-for="(entry, index) in layout(page)" :key="`${entry.kind}-${index}`">
            <h5 v-if="entry.kind === 'heading'" class="border-t border-default pt-3 font-semibold">{{ entry.title }}</h5>
            <FormTestControl v-else-if="fieldFor(fields, entry.id)" :field="fieldFor(fields, entry.id)!" :locale="locale" />
          </template>
        </template>
        <p v-if="complete" role="status" class="text-success">{{ locale === 'fr' ? 'Réponses valides.' : 'Responses are valid.' }}</p>
        <div class="flex gap-2">
          <ExtensionButton v-if="canBack" @click="back">{{ locale === 'fr' ? 'Précédent' : 'Previous' }}</ExtensionButton>
          <ExtensionButton v-if="!complete" @click="next">{{ isLastPage ? (locale === 'fr' ? 'Vérifier' : 'Check') : (locale === 'fr' ? 'Suivant' : 'Next') }}</ExtensionButton>
        </div>
      </template>
    </HeadlessSurvey>
  </div>
</template>
