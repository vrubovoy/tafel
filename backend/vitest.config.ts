import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    // A local `pnpm build` leaves compiled test files under dist/, which
    // vitest would otherwise happily discover and run alongside the real
    // src/ tests - harmless in CI (no dist/ there) but confusing locally.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
