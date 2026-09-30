import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { foreignId } from '../server/forms.ts'

describe('portal form foreign identity', () => {
  it('preserves the deterministic 60-bit SHA-256 identity for calls and agreement sets', () => {
    expect(foreignId('form-call:V-ABCDE:1')).toBe('161736528191523518')
    expect(foreignId('form-set:V-ABCDE:2:G-ABCDE:N-ABCDE')).toBe('655547621582126624')
    expect(foreignId('form-call:V-ABCDE:1')).toBe(foreignId('form-call:V-ABCDE:1'))
  })

  it('typechecks the form identity source with the Nuxt ES2019 build target', () => {
    const file = fileURLToPath(new URL('../server/forms.ts', import.meta.url))
    const program = ts.createProgram([file], {
      target: ts.ScriptTarget.ES2019,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      noEmit: true,
      skipLibCheck: true,
      types: ['node']
    })
    const diagnostics = ts.getPreEmitDiagnostics(program)
      .filter(diagnostic => diagnostic.file?.fileName === file)
      .map(diagnostic => `${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
    expect(diagnostics).toEqual([])
  }, 15_000)
})
