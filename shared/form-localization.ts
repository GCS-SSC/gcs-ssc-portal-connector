/** Computed values have one template for both languages, so only field references and neutral symbols may be fixed text. */
export const languageNeutralTemplate = (template: string) =>
  !/\p{L}/u.test(template.replace(/\{\{[a-zA-Z][a-zA-Z0-9_-]{0,63}\}\}/g, ''))

/** A calculated answer must interpolate selected fields and contain no language-specific prose. */
export const computedTemplateReady = (template: string, sourceIds: string[]) => {
  const references = [...template.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_-]{0,63})\}\}/g)]
    .map((match) => match[1]!)
  return languageNeutralTemplate(template) && references.length > 0
    && references.every((id) => sourceIds.includes(id))
}
