import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Reads the root package.json (this app's backend half) rather than
// frontend/'s own (always "0.0.0", never bumped) - backend and frontend
// are one logical service.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string }

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5175,
    proxy: {
      '/backend': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/backend/, ''),
      },
      // Proxy schlussel auth service
      '/auth': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
