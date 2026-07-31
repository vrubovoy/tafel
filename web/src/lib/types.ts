export interface Status {
  id: string
  projectId: string
  name: string
  color: string
  sortOrder: number
  isDone: boolean
}

export type Priority = 'low' | 'medium' | 'high'
export type RecurrenceInterval = 'daily' | 'weekly' | 'monthly'

export interface Task {
  id: string
  projectId: string
  parentTaskId: string | null
  statusId: string
  title: string
  description: string | null
  priority: Priority
  dueDate: string | null
  sortOrder: number
  completedAt: string | null
  recurrenceInterval: RecurrenceInterval | null
  recurrenceCount: number | null
  recurrenceAnchorDate: string | null
  archived: boolean
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
}

export const PRIORITY_COLORS: Record<Priority, string> = {
  low: '#94a3b8',
  medium: '#3b82f6',
  high: '#ef4444',
}
