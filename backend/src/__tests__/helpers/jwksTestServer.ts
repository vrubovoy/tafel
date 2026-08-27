import { createServer } from 'node:http'
import type { RequestListener, Server } from 'node:http'

async function startServer(handler: RequestListener): Promise<{ url: string; server: Server }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('failed to bind test server')
  return { url: `http://127.0.0.1:${address.port}/`, server }
}

// Setting SCHLUSSEL_JWKS_URL as a side effect of importing this module -
// not inside a function a test file calls later - matters: ES imports are
// hoisted above every other top-level statement in an importing file, so
// setting the env var from within the test file's own body (even textually
// before its other imports) would still run after middleware/auth.ts's
// module-load-time JWKS_URL constant had already been read. Importing
// *this* module before importing anything that reaches middleware/auth.ts
// keeps import-execution order doing the ordering instead.
export let jwksShouldFail = false
export const jwksServer = await startServer((_req, res) => {
  if (jwksShouldFail) {
    res.statusCode = 503
    res.end('unavailable')
    return
  }
  res.end('{"keys":[]}')
})
process.env['SCHLUSSEL_JWKS_URL'] = jwksServer.url

export function setJwksShouldFail(value: boolean): void {
  jwksShouldFail = value
}
