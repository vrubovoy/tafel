import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { assertDatabaseCurrent, prepareDatabase } from '../db/migrate.js'

const migrationsFolder = fileURLToPath(new URL('../db/migrations', import.meta.url))
const databases: Database.Database[] = []

function database(): Database.Database {
  const sqlite = new Database(':memory:')
  databases.push(sqlite)
  return sqlite
}

afterEach(() => {
  for (const sqlite of databases.splice(0)) sqlite.close()
})

describe('MIGRATE_ON_STARTUP', () => {
  it.each([undefined, '', 'false'])('asserts rather than migrating for %s', (value) => {
    expect(() => prepareDatabase(database(), migrationsFolder, value)).toThrow('has not been applied')
  })

  it('migrates only when explicitly true', () => {
    const sqlite = database()
    prepareDatabase(sqlite, migrationsFolder, 'true')
    expect(() => assertDatabaseCurrent(sqlite, migrationsFolder)).not.toThrow()
  })

  it('rejects invalid values', () => {
    expect(() => prepareDatabase(database(), migrationsFolder, 'yes')).toThrow('must be true or false')
  })
})
