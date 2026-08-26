import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sqlite } from './db/index.js'
import { migrateDatabase } from './db/migrate.js'

try {
  migrateDatabase(sqlite, join(dirname(fileURLToPath(import.meta.url)), 'db/migrations'))
} finally {
  sqlite.close()
}
