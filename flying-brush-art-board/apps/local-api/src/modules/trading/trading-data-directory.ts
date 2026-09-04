import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')

/**
 * Resolve trading data independently of the package manager's working
 * directory. Relative environment values are documented relative to the
 * repository root, which is stable for `pnpm dev`, tests and production
 * builds.
 */
export function resolveTradingDataDirectory(
  configuredDirectory?: string,
  baseDirectory = repositoryRoot,
): string {
  const configured = configuredDirectory?.trim()
  if (configured) return isAbsolute(configured) ? resolve(configured) : resolve(baseDirectory, configured)
  return resolve(baseDirectory, '..', '..', '07_中短线选股器')
}
