// @vitest-environment node

/**
 * 单话标记（项目记忆）层 —— **P4 第三刀**的回归锁（2026-10-02）。
 *
 * 这一刀把 `getStoredProjectMemory` / `setStoredProjectMemoryStatuses` /
 * `removeStoredProjectMemory` 从 `services/database.ts` 搬到
 * `services/db/project-memory-store.ts`，对外仍由 `./database` re-export。
 *
 * 这里锁三件事：
 * 1. **不是第二份实现**（`toBe` 身份）—— 纯搬运的经典事故；
 * 2. **`modes` 是补丁、不是整份**，且**时间戳也按补丁合并** —— 这是 2026-09-26
 *    那次"批量标记抹掉 15 话标记"的事故面，老锁在 `database.spec.ts` 里，
 *    这里再盯一遍**经由新模块**的这条路；
 * 3. **删除会级联删掉该话的标记行** —— `ON DELETE CASCADE` 是库里的契约。
 */

import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DATABASE_ROOT = resolve(__dirname, '../../../../../.omo/fixtures/project-memory-store-test')

vi.mock('electron', () => ({
  app: { getPath: () => DATABASE_ROOT }
}))

import {
  closeDatabase,
  databasePath,
  getStoredProjectMemory,
  removeStoredProjectMemory,
  setStoredProjectMemoryStatuses
} from '../../database'
import * as store from '../project-memory-store'
import type { ProjectMemoryStatusUpdate } from '@shared/ipc-api'

function update(partial: Partial<ProjectMemoryStatusUpdate>): ProjectMemoryStatusUpdate {
  return {
    pathKey: partial.pathKey ?? 'page',
    path: partial.path ?? 'D:\\漫画\\01.psd',
    status: partial.status ?? 'done',
    mtimeMs: partial.mtimeMs ?? 1000,
    modes: partial.modes,
    modeTimestamps: partial.modeTimestamps
  }
}

beforeAll(async () => {
  await rm(DATABASE_ROOT, { recursive: true, force: true })
  await mkdir(DATABASE_ROOT, { recursive: true })
})

afterAll(async () => {
  await closeDatabase()
  await rm(DATABASE_ROOT, { recursive: true, force: true })
})

it('db/project-memory-store 与 services/database 是同一份实现（兼容垫片）', () => {
  expect(store.getStoredProjectMemory).toBe(getStoredProjectMemory)
  expect(store.setStoredProjectMemoryStatuses).toBe(setStoredProjectMemoryStatuses)
  expect(store.removeStoredProjectMemory).toBe(removeStoredProjectMemory)
})

it('标记是补丁语义：只改本次带的模式，其余模式与时间戳原样保留', async () => {
  const childId = 'child-patch'
  await store.setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\补丁', [
    update({ modes: { typeset: true }, modeTimestamps: { typeset: 100 } })
  ])
  // 补丁只带 translated —— 嵌字那条不许被推成 false（2026-09-26 事故的正面）
  await store.setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\补丁', [
    update({ modes: { translated: true }, modeTimestamps: { translated: 200 } })
  ])

  const memory = await getStoredProjectMemory(childId)
  expect(memory?.files.page.modes).toEqual({
    typeset: true,
    translated: true,
    proofread: false,
    supervised: false
  })
  expect(memory?.files.page.modeTimestamps).toEqual({ typeset: 100, translated: 200 })

  // 空补丁 + status:'done'：`{}` 的语义是"什么都不改"，不许按 status 把嵌字推成 true
  await store.setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\补丁', [
    update({ pathKey: 'empty-patch', status: 'done', modes: {} })
  ])
  expect((await getStoredProjectMemory(childId))?.files['empty-patch'].modes?.typeset).toBe(false)
})

it('删掉一话会级联删掉它的标记行（外键契约）', async () => {
  const childId = 'child-remove'
  await store.setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\删', [
    update({ modes: { typeset: true } })
  ])

  const countFiles = (): number => {
    const raw = new DatabaseSync(databasePath(), { readOnly: true })
    try {
      return Number(
        (
          raw
            .prepare('SELECT COUNT(*) AS n FROM project_memory_files WHERE child_id = ?')
            .get(childId) as { n: number }
        ).n
      )
    } finally {
      raw.close()
    }
  }

  expect(countFiles()).toBe(1)
  await store.removeStoredProjectMemory(childId)
  expect(await getStoredProjectMemory(childId)).toBeNull()
  expect(countFiles()).toBe(0)
})
