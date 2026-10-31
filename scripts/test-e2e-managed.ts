import { fileURLToPath } from 'node:url'
import { runManagedExtensionE2e, type ManagedExtensionE2eConfig } from '../../../scripts/extension-managed-e2e'
import { NUXT_ARTIFACT_LOCK_ENV, runWithNuxtArtifactLock } from '../../../scripts/nuxt-artifact-lock'

export const portalCurrencyManagedE2eConfig: ManagedExtensionE2eConfig = {
  acceptedSpec: 'tests/e2e/currency-grant-preview.spec.ts',
  extensionKey: 'gcs-ssc-portal-connector',
  extensionRoot: fileURLToPath(new URL('../', import.meta.url)),
  suite: 'extension-portal-currency'
}

const main = async () => {
  if (process.env[NUXT_ARTIFACT_LOCK_ENV] !== '1') {
    process.exitCode = await runWithNuxtArtifactLock(
      [process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      process.env,
      fileURLToPath(new URL('../../../', import.meta.url))
    )
    return
  }
  await runManagedExtensionE2e(portalCurrencyManagedE2eConfig, process.argv.slice(2))
}
if (import.meta.main) await main()
