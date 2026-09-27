<script setup lang="ts">
import { ref, watch } from 'vue'
import { HeadlessSurvey, type SurveyField } from '@gcs-ssc/survey/vue'
import type { AdvancedSurvey, ResolvedAdvancedGroup, ResolvedAdvancedPage } from '@gcs-ssc/survey'
import { ExtensionButton } from '@gcs-ssc/extensions/ui'
import FormTestControl from './FormTestControl.vue'
const props = defineProps<{ definition: AdvancedSurvey; locale: 'en' | 'fr' }>()
const answers = ref<Record<string, string>>({})
watch(() => props.definition, () => { answers.value = {} }, { deep: true })
type Entry = { kind: 'heading'; title: string; description: string; depth: number } | { kind: 'field'; id: string }
const layout = (page: ResolvedAdvancedPage): Entry[] => {
  const visit = (groups: ResolvedAdvancedGroup[], depth: number): Entry[] => groups.flatMap((group) => [
    { kind: 'heading' as const, title: group.title[props.locale], description: group.description?.[props.locale] ?? '', depth },
    ...group.questionIds.map((id) => ({ kind: 'field' as const, id })),
    ...visit(group.groups, depth + 1)
  ])
  return [...page.questionIds.map((id) => ({ kind: 'field' as const, id })), ...visit(page.groups, 1)]
}
const fieldFor = (fields: SurveyField[], id: string) => fields.find((field) => field.id === id)
const previous = (back: () => void, complete: boolean, pageIndex: number) => {
  back()
  if (complete && pageIndex > 0) back()
}
</script>
<template>
  <div class="space-y-4">
    <p class="text-sm text-muted">{{ locale === 'fr' ? 'Aperçu seulement. Aucune réponse n’est enregistrée.' : 'Preview only. No responses are saved.' }}</p>
    <HeadlessSurvey v-model="answers" :definition="definition" :locale="locale">
      <template #default="{ fields, page, pageIndex, canBack, isLastPage, complete, next, back }">
        <h4 class="text-lg font-semibold">{{ definition.title[locale] }}</h4>
        <p v-if="definition.description?.[locale]" class="text-sm text-muted whitespace-pre-line">{{ definition.description[locale] }}</p>
        <template v-if="page && 'groups' in page">
          <p class="font-medium">{{ locale === 'fr' ? 'Page' : 'Page' }} {{ pageIndex + 1 }} · {{ page.title[locale] }}</p>
          <p v-if="page.description?.[locale]" class="text-sm text-muted whitespace-pre-line">{{ page.description[locale] }}</p>
          <template v-for="(entry, index) in layout(page)" :key="`${entry.kind}-${index}`">
            <div v-if="entry.kind === 'heading'" class="border-t border-default pt-3"><h5 class="font-semibold">{{ entry.title }}</h5><p v-if="entry.description" class="mt-1 text-sm text-muted whitespace-pre-line">{{ entry.description }}</p></div>
            <FormTestControl v-else-if="fieldFor(fields, entry.id)" :field="fieldFor(fields, entry.id)!" :locale="locale" />
          </template>
        </template>
        <p v-if="complete" role="status" class="text-success">{{ locale === 'fr' ? 'Réponses valides.' : 'Responses are valid.' }}</p>
        <div class="flex gap-2">
          <ExtensionButton v-if="canBack" @click="previous(back, complete, pageIndex)">{{ locale === 'fr' ? 'Précédent' : 'Previous' }}</ExtensionButton>
          <ExtensionButton v-if="!complete" @click="next">{{ isLastPage ? (locale === 'fr' ? 'Vérifier' : 'Check') : (locale === 'fr' ? 'Suivant' : 'Next') }}</ExtensionButton>
        </div>
      </template>
    </HeadlessSurvey>
  </div>
</template>
