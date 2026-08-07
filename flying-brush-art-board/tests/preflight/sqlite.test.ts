import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

describe('SQLite native module', () => {
  it('writes and reads an in-memory database', () => {
    const database = new Database(':memory:')

    try {
      database.exec('CREATE TABLE checks (value TEXT NOT NULL)')
      database.prepare('INSERT INTO checks (value) VALUES (?)').run('ready')
      const row = database.prepare('SELECT value FROM checks').get() as { value: string }

      expect(row.value).toBe('ready')
    } finally {
      database.close()
    }
  })
})
