import { createAuthMiddleware, createExportAuthMiddleware } from '@zudar107/schloss-server-kit'
import type { AuthUser } from '@zudar107/schloss-server-kit'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users, userTombstones } from '../db/schema.js'

export type { AuthUser }

const JWKS_URL = process.env['SCHLUSSEL_JWKS_URL'] ?? 'http://localhost:4000/.well-known/jwks.json'
const ISSUER = process.env['JWT_ISSUER'] ?? 'schlussel'

export const { requireAuth, requireAdmin } = createAuthMiddleware({
  jwksUrl: JWKS_URL,
  issuer: ISSUER,
  // Auto-provision a local user row on first sight - Tafel stores only
  // the user id from the JWT, no passwords here. Every subsequent
  // sighting also mirrors the JWT's own timezone claim locally (see
  // schema.ts's `timezone` column comment for why this needs to live
  // here, not just be read live off each request) - coalesced rather
  // than overwritten: a token with no timezone claim (an old cached
  // token, an admin/service token) never erases an already-known value.
  onUserSeen: async (user) => {
    const deleted = db.transaction((tx) => {
      const tombstone = tx.select({ userId: userTombstones.userId })
        .from(userTombstones).where(eq(userTombstones.userId, user.id)).get()
      if (tombstone) return true
      const existing = tx.select().from(users).where(eq(users.id, user.id)).get()
      if (!existing) {
        tx.insert(users).values({
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone ?? null,
        createdAt: new Date(),
        }).run()
      } else if (user.timezone) {
        tx.update(users).set({ timezone: user.timezone }).where(eq(users.id, user.id)).run()
      }
      return false
    })
    if (deleted) throw new Error('Deleted account')
  },
})

export const requireExportAuth = createExportAuthMiddleware({
  jwksUrl: JWKS_URL,
  issuer: ISSUER,
  service: 'tafel',
})
