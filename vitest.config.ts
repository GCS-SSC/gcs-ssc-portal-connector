import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const connectorRoot = dirname(fileURLToPath(import.meta.url))
const hostRoot = [resolve(connectorRoot, '../gcs-ssc'), resolve(connectorRoot, '../..')]
  .find(candidate => existsSync(resolve(candidate, 'server/utils/audit-ownership.ts')))

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: hostRoot ? [{ find: '~~', replacement: hostRoot }] : [] }
})
