import { eq, getTableColumns } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { projects, statuses, tasks, users } from '../../db/schema.js'

export function readTafelSnapshot(userId: string) {
  return db.transaction((tx) => {
    const user = tx.select({ weekStartsOn: users.weekStartsOn })
      .from(users)
      .where(eq(users.id, userId))
      .get()
    const ownedProjects = tx.select().from(projects).where(eq(projects.userId, userId)).all()
    const ownedStatuses = tx.select(getTableColumns(statuses))
      .from(statuses)
      .innerJoin(projects, eq(statuses.projectId, projects.id))
      .where(eq(projects.userId, userId))
      .all()
    const ownedTasks = tx.select().from(tasks).where(eq(tasks.userId, userId)).all()

    return {
      weekStartsOn: user?.weekStartsOn ?? null,
      projects: ownedProjects,
      statuses: ownedStatuses,
      tasks: ownedTasks,
    }
  })
}
