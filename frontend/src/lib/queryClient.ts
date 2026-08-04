import { QueryClient } from '@tanstack/react-query'

// Single shared instance - the router's route loaders (see router/index.tsx)
// prefetch into this same client before a route transition completes, so
// the page component's own useQuery calls find already-cached data instead
// of mounting empty and fetching again. Prefetching into a *different*
// QueryClient instance than the one wrapping the app would silently do
// nothing useful.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})
