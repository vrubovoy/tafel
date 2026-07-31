// Thin, Tafel-named wrapper around @zudar107/schloss-ui's config-driven
// auth-redirect helpers. Reads import.meta.env.VITE_SCHLUSSEL_URL fresh on
// every call (not memoized at module load) so it keeps honoring a value
// changed after the module was first imported (e.g. via test env stubbing).
import { buildLoginUrl, buildLogoutUrl, buildAccountUrl, CODE_VERIFIER_STORAGE_KEY } from '@zudar107/schloss-ui'

const DEFAULT_SCHLUSSEL_URL = 'http://localhost:4001'

function config() {
  return {
    schluesselUrl: (import.meta.env.VITE_SCHLUSSEL_URL as string | undefined) ?? DEFAULT_SCHLUSSEL_URL,
  }
}

export { CODE_VERIFIER_STORAGE_KEY }

export function buildSchluesselLoginUrl(currentPath: string, origin?: string): Promise<string> {
  return buildLoginUrl(config(), currentPath, origin)
}

export function buildSchluesselLogoutUrl(returnTo?: string): string {
  return buildLogoutUrl(config(), returnTo)
}

export function buildSchluesselAccountUrl(currentPath: string, origin?: string): string {
  return buildAccountUrl(config(), currentPath, origin)
}
