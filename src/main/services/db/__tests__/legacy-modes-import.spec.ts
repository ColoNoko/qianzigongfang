import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSchema } from '../schema'
import { importLegacyJsonFiles } from '../legacy-import'
import { importProjectMemory } from '../legacy-merge'
let db: DatabaseSync
let folder: string
vi.mock('../connection', () => ({ getDatabase: async () => db }))
import { getStoredProjectMemory } from '../project-memory-store'
const modes = { typeset: false, translated: true, proofread: true, supervised: true }
const modeTimestamps = { typeset: 100, translated: 200, proofread: 300, supervised: 400 }
const memory = {
  projects: {
    c: {
      childId: 'c',
      folderPath: '/book',
      updatedAt: 42,
      files: {
        '/book/1.psd': {
          path: '/book/1.psd',
          status: 'done' as const,
          mtimeMs: 10,
          updatedAt: 42,
          modes,
          modeTimestamps
        }
      }
    }
  }
}
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  createSchema(db)
  folder = mkdtempSync(join(tmpdir(), 'import-modes-'))
})
afterEach(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
})
it.each(['sqlite', 'json'])(
  '%s import preserves all explicit mode flags and timestamps without overwriting current rows',
  async (format) => {
    const file = join(folder, `source.${format}`)
    if (format === 'sqlite') {
      const source = new DatabaseSync(file)
      createSchema(source)
      source.prepare('INSERT INTO project_memory VALUES (?, ?, ?)').run('c', '/book', 42)
      source
        .prepare('INSERT INTO project_memory_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          'c',
          '/book/1.psd',
          '/book/1.psd',
          'done',
          10,
          42,
          JSON.stringify(modes),
          JSON.stringify(modeTimestamps)
        )
      source.close()
    } else writeFileSync(file, JSON.stringify(memory))
    const context = {
      databasePath: () => join(folder, 'target.sqlite'),
      getDatabase: async () => db
    }
    const result = await importLegacyJsonFiles([file], context)
    expect(result.warnings).toEqual([])
    expect((await getStoredProjectMemory('c'))?.files['/book/1.psd']).toMatchObject({
      modes,
      modeTimestamps,
      status: 'pending',
      updatedAt: 42
    })
    db.prepare('UPDATE project_memory_files SET mode_timestamps_json = ?').run('{"proofread":999}')
    await importLegacyJsonFiles([file], context)
    expect((await getStoredProjectMemory('c'))?.files['/book/1.psd'].modeTimestamps).toEqual({
      proofread: 999
    })
  }
)
it('legacy SQLite without mode columns retains legacy status and adds no invented completion dates', async () => {
  const file = join(folder, 'old.sqlite')
  const source = new DatabaseSync(file)
  source.exec(`CREATE TABLE project_memory_files(child_id TEXT, path_key TEXT, path TEXT, status TEXT, mtime_ms REAL, updated_at REAL);
    INSERT INTO project_memory_files VALUES ('c', '/book/1.psd', '/book/1.psd', 'done', 10, 42)`)
  source.close()
  await importLegacyJsonFiles([file], {
    databasePath: () => join(folder, 'target'),
    getDatabase: async () => db
  })
  expect((await getStoredProjectMemory('c'))?.files['/book/1.psd']).toMatchObject({
    modes: { typeset: true, translated: false, proofread: false, supervised: false },
    modeTimestamps: {}
  })
})
it('migration overwrite branch updates mode data and validates timestamp values', async () => {
  importProjectMemory(db, memory)
  importProjectMemory(db, {
    projects: {
      c: {
        ...memory.projects.c,
        files: {
          '/book/1.psd': {
            ...memory.projects.c.files['/book/1.psd'],
            modes: { typeset: true, translated: false, proofread: false, supervised: false },
            modeTimestamps: { typeset: 0, translated: Infinity }
          }
        }
      }
    }
  })
  expect((await getStoredProjectMemory('c'))?.files['/book/1.psd']).toMatchObject({
    modes: { typeset: true, translated: false },
    modeTimestamps: { typeset: 0 }
  })
})

it('SQLite rows with malformed optional JSON still import their readable legacy fields', async () => {
  const file = join(folder, 'damaged-optional.sqlite')
  const source = new DatabaseSync(file)
  createSchema(source)
  source.prepare('INSERT INTO project_memory VALUES (?, ?, ?)').run('c', '/book', 42)
  source
    .prepare('INSERT INTO project_memory_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('c', '/book/1.psd', '/book/1.psd', 'done', 10, 42, '{broken', '{broken')
  source.close()
  const result = await importLegacyJsonFiles([file], {
    databasePath: () => join(folder, 'target'),
    getDatabase: async () => db
  })
  expect(result.memoryProjectsImported).toBe(1)
  expect((await getStoredProjectMemory('c'))?.files['/book/1.psd']).toMatchObject({
    modes: { typeset: true, translated: false, proofread: false, supervised: false },
    modeTimestamps: {},
    updatedAt: 42
  })
})
