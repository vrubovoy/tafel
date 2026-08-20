import { createRouter, createRootRouteWithContext, createRoute, Outlet, redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { NotFoundPage } from '@zudar107/schloss-ui'
import { Layout } from '../components/Layout'
import { HeroIllustration } from '../components/HeroIllustration'
import { KanbanPage } from '../features/kanban/KanbanPage'
import { TaskListPage } from '../features/tasks/TaskListPage'
import { CalendarPage } from '../features/calendar/CalendarPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
import { StatsPage } from '../features/stats/StatsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { DocsPage } from '../features/docs/DocsPage'
import { HelpPage } from '../features/help/HelpPage'
import { AuthCallbackPage } from '../features/auth/AuthCallbackPage'
import { getAccessToken, api } from '../lib/api'
import { buildSchluesselLoginUrl } from '../lib/authRedirect'
import { queryClient } from '../lib/queryClient'

interface RouterContext {
  queryClient: QueryClient
}

// A loader's job here is purely to warm the cache before the route
// transition completes, so the page component's own useQuery finds data
// already there instead of mounting empty and fetching. A prefetch
// failing (e.g. a network hiccup) must never turn into a hard error
// screen in place of the page - the component's own useQuery already
// retries and degrades gracefully, so loader errors are swallowed and
// left for it to handle exactly as it does today.
function prefetch(loader: (queryClient: QueryClient) => Promise<unknown>) {
  return async ({ context }: { context: RouterContext }) => {
    try {
      await loader(context.queryClient)
    } catch {
      // swallowed - see comment above
    }
  }
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
  notFoundComponent: () => <NotFoundPage homeHref="/" illustration={<HeroIllustration size={100} />} />,
})

const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  component: AuthCallbackPage,
})

const protectedLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  beforeLoad: async () => {
    if (!getAccessToken()) {
      window.location.href = await buildSchluesselLoginUrl(window.location.pathname + window.location.search)
    }
  },
  component: () => <Layout><Outlet /></Layout>,
})

const indexRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/',
  beforeLoad: () => { throw redirect({ to: '/kanban' }) },
})

const projectsPrefetch = prefetch((qc) => qc.ensureQueryData({
  queryKey: ['projects'],
  queryFn: () => api.get('/projects'),
}))

// The kanban/list/calendar views are all scoped by a `project` search
// param picked on the Projects page (or their own in-page picker) -
// which project (if any) is selected isn't known until the route
// actually renders, so their loaders only warm the cheap, certain-to-be-
// needed projects list rather than guessing at a project-scoped query.
const kanbanRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/kanban',
  loader: projectsPrefetch,
  component: KanbanPage,
})

const tasksRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/tasks',
  loader: projectsPrefetch,
  component: TaskListPage,
})

const calendarRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/calendar',
  loader: projectsPrefetch,
  component: CalendarPage,
})

const projectsRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/projects',
  loader: projectsPrefetch,
  component: ProjectsPage,
})

const statsRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/stats',
  loader: prefetch((qc) => qc.ensureQueryData({
    queryKey: ['stats', 'summary'],
    queryFn: () => api.get('/stats/summary'),
  })),
  component: StatsPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/settings',
  loader: prefetch((qc) => qc.ensureQueryData({
    queryKey: ['userProfile'],
    queryFn: () => api.get('/users/me'),
  })),
  component: SettingsPage,
})

// Role-gated inside DocsPage itself, not here - the current user's role
// only lives in useAuth()'s React state (populated asynchronously), which
// a beforeLoad running before that state exists can't check synchronously.
const docsRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/docs',
  component: DocsPage,
})

const helpRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/help',
  component: HelpPage,
})

const routeTree = rootRoute.addChildren([
  authCallbackRoute,
  protectedLayout.addChildren([
    indexRoute,
    kanbanRoute,
    tasksRoute,
    calendarRoute,
    projectsRoute,
    statsRoute,
    settingsRoute,
    docsRoute,
    helpRoute,
  ]),
])

export const router = createRouter({ routeTree, context: { queryClient } })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
