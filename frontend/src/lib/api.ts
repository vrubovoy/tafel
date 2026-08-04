// Thin wrapper around @zudar107/schloss-ui's config-driven API client -
// `apiClient` (the raw instance) is also exported so hooks/useAuth.ts can
// share the exact same token state via useAuthProvider's `apiClient` config.
import { createApiClient, ApiError } from '@zudar107/schloss-ui'
import { buildSchluesselLoginUrl } from './authRedirect'

export { ApiError }

export const apiClient = createApiClient({
  base: '/backend',
  // A background request's own refresh-and-retry both failed - the
  // session is genuinely gone, so send the browser to schlussel's
  // hosted login (PKCE) rather than a local /login route this app
  // doesn't have.
  onUnauthorized: () => {
    void buildSchluesselLoginUrl(window.location.pathname).then((url) => {
      window.location.href = url
    })
  },
})

export const setAccessToken = apiClient.setAccessToken
export const getAccessToken = apiClient.getAccessToken

export const api = {
  get: apiClient.get,
  post: apiClient.post,
  put: apiClient.put,
  delete: apiClient.delete,
}
