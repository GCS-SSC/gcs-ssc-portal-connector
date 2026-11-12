import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { defineConfig } from 'vitest/config'

const connectorRoot = dirname(fileURLToPath(import.meta.url))
const hostRoot = [resolve(connectorRoot, '../gcs-ssc'), resolve(connectorRoot, '../..')]
  .find(candidate => existsSync(resolve(candidate, 'server/utils/audit-ownership.ts')))

export default defineConfig({
  plugins: [vue(), ui({ dts: false, components: false, autoImport: false })],
  resolve: { alias: hostRoot ? [{ find: '~~', replacement: hostRoot }] : [] },
  test: {
    include: ['tests/*.test.ts'],
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'shared/**/*.ts', 'components/**/*.{ts,vue}', 'i18n/**/*.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 }
    }
  }
})
