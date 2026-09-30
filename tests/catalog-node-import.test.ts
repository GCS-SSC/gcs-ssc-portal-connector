import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
it('loads the translation catalog through the native Node ESM importer used by development dispatch', () => {
  const file = new URL('../i18n/messages.ts', import.meta.url)
  const code = `import(${JSON.stringify(file.href)}).then(m => console.log(m.messages.en.grantCostItem))`
  expect(execFileSync('node', ['--input-type=module', '-e', code], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }).trim()).toBe('Cost category / line item')
})
