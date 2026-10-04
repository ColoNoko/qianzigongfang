// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { rm, stat } from 'fs/promises'
import { resolve } from 'path'

const MEMORY_ROOT = resolve(__dirname, '../../../../.omo/fixtures/project-memory-test')

vi.mock('electron', () => ({
  app: { getPath: () => MEMORY_ROOT }
}))

import { getProjectMemory, setProjectMemoryStatuses } from '../project-memory'
import { closeDatabase, databasePath } from '../database'

describe('project memory file', () => {
  beforeAll(async () => {
    await rm(MEMORY_ROOT, { recursive: true, force: true })
  })

  afterAll(async () => {
    await closeDatabase()
    await rm(MEMORY_ROOT, { recursive: true, force: true })
  })

  it('persists statuses by child project in SQLite', async () => {
    await setProjectMemoryStatuses('child-1', 'C:\\漫画\\第1集', [
      {
        pathKey: 'c:/漫画/第1集/001.psd',
        path: 'C:\\漫画\\第1集\\001.psd',
        status: 'done',
        mtimeMs: 123
      }
    ])

    const project = await getProjectMemory('child-1')
    expect(project?.files['c:/漫画/第1集/001.psd'].status).toBe('done')
    expect(project?.folderPath).toBe('C:\\漫画\\第1集')
    expect((await stat(databasePath())).isFile()).toBe(true)
  })
})
