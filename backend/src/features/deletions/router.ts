import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import {
  deletionJobs, notificationOccurrences, notificationOutbox, tasks, users, userTombstones,
} from '../../db/schema.js'

const bodySchema = z.object({ jobId: z.string().min(1).max(128), userId: z.string().min(1).max(128) }).strict()

function claims(payload: JWTPayload, audience: string) {
  const scope = payload['scope']
  const jobId = payload['job_id']
  if (payload.aud !== audience || payload['token_use'] !== 'deletion' ||
    typeof payload.sub !== 'string' || !payload.sub || typeof jobId !== 'string' || !jobId ||
    typeof payload.jti !== 'string' || !payload.jti || typeof payload.exp !== 'number' ||
    typeof scope !== 'string' || !scope.split(/\s+/).includes('account:delete')) {
    throw new Error('Invalid deletion claims')
  }
  return { userId: payload.sub, jobId, tokenId: payload.jti }
}

export function createDeletionsRouter(config: { jwksUrl: string; issuer: string; service: string }) {
  const audience = `hof-deletion:${config.service}`
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl))
  const router = new Hono()
  router.post('/account-deletions', async (c) => {
    const authorization = c.req.header('Authorization')
    if (!authorization?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
    let principal: ReturnType<typeof claims>
    try {
      const verified = await jwtVerify(authorization.slice(7), jwks, {
        algorithms: ['RS256'], issuer: config.issuer, audience, requiredClaims: ['sub', 'exp', 'jti'],
      })
      principal = claims(verified.payload, audience)
    } catch { return c.json({ error: 'Invalid or expired token' }, 401) }
    let json: unknown
    try { json = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) return c.json({ error: 'Invalid deletion request' }, 400)
    if (parsed.data.jobId !== principal.jobId || parsed.data.userId !== principal.userId) {
      return c.json({ error: 'Deletion token does not match request' }, 409)
    }
    const result = db.transaction((tx) => {
      const existing = tx.select().from(deletionJobs).where(eq(deletionJobs.jobId, principal.jobId)).get()
      if (existing) return existing.userId === principal.userId ? 'duplicate' : 'conflict'
      const tombstone = tx.select().from(userTombstones).where(eq(userTombstones.userId, principal.userId)).get()
      if (tombstone) return tombstone.deletionJobId === principal.jobId ? 'duplicate' : 'conflict'
      const completedAt = new Date()
      tx.insert(deletionJobs).values({ ...principal, completedAt }).run()
      tx.insert(userTombstones).values({ userId: principal.userId, deletionJobId: principal.jobId, deletedAt: completedAt }).run()
      tx.run(sql`delete from ${notificationOccurrences} where exists (
        select 1 from ${tasks} where ${tasks.userId} = ${principal.userId}
        and ${notificationOccurrences.dedupeKey} like ${tasks.id} || ':%'
      )`)
      tx.delete(notificationOutbox).where(eq(notificationOutbox.userId, principal.userId)).run()
      tx.delete(users).where(eq(users.id, principal.userId)).run()
      return 'completed'
    })
    if (result === 'conflict') return c.json({ error: 'Deletion job identity conflict' }, 409)
    return c.json({ status: result, jobId: principal.jobId })
  })
  return router
}

export const deletionsRouter = createDeletionsRouter({
  jwksUrl: process.env['SCHLUSSEL_JWKS_URL'] ?? 'http://localhost:4000/.well-known/jwks.json',
  issuer: process.env['JWT_ISSUER'] ?? 'schlussel', service: 'tafel',
})
