import { exportEnvelopeSchema } from '@zudar107/schloss-server-kit'
import type { ExportAuthEnv } from '@zudar107/schloss-server-kit'
import { Hono } from 'hono'
import { requireExportAuth } from '../../middleware/auth.js'
import { readTafelSnapshot } from './snapshot.js'

const router = new Hono<ExportAuthEnv>()

router.get('/me', requireExportAuth, (c) => {
  const snapshot = readTafelSnapshot(c.get('exportPrincipal').sub)
  const data: unknown = JSON.parse(JSON.stringify(snapshot))

  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')
  c.header('X-Content-Type-Options', 'nosniff')

  return c.json(exportEnvelopeSchema.parse({
    version: '1',
    service: 'tafel',
    exportedAt: new Date().toISOString(),
    data,
  }))
})

export { router as exportsRouter }
