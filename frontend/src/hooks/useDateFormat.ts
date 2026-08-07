import { useQuery } from '@tanstack/react-query'
import type { DateFormat } from '@zudar107/schloss-ui'
import { api } from '../lib/api'

interface UserDateProfile {
  dateFormat: DateFormat | null
  timezone: string | null
}

// Same ['userProfile'] cache key CalendarPage/SettingsPage's own
// GET /users/me queries already use - React Query dedupes the request,
// so calling this from several components on the same page costs one
// network round trip total, not one per caller.
export function useDateFormat(): { dateFormat: DateFormat | null; timezone: string | null } {
  const { data } = useQuery<UserDateProfile>({
    queryKey: ['userProfile'],
    queryFn: () => api.get('/users/me'),
  })
  return { dateFormat: data?.dateFormat ?? null, timezone: data?.timezone ?? null }
}
