// @vitest-environment node

/**
 * 标记统计层（成就 / 首页的数据源）—— **P4 第四刀**的回归锁（2026-10-02）。
 *
 * `collectChildMarkStatistics()` 从 `services/database.ts` 搬到
 * `services/db/mark-stats-store.ts`，对外仍由 `./database` re-export。
 *
 * 这里锁三件事：
 * 1. **不是第二份实现**（`toBe` 身份）；
 * 2. **数据只来自标记记录**（`project_memory_files`），与"磁盘上还剩几张图"无关 ——
 *    这正是第十五轮把成就换源的语义（删图不掉历史），换文件后不能走样；
 * 3. **时间戳缺失的老记录回退到该行 `updated_at`**，且**每个模式各自按时间排序**。
 */

import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const DATABASE_ROOT = resolve(__dirname, '../../../../../.omo/fixtures/mark-stats-store-test')

vi.mock('electron', () => ({
  app: { getPath: () => DATABASE_ROOT }
}))

import {
  closeDatabase,
  collectChildMarkStatistics,
  getStoredProjectMemory,
  setStoredProjectMemoryStatuses
} from '../../database'
import * as statsStore from '../mark-stats-store'
import type { ProjectMemoryStatusUpdate } from '@shared/ipc-api'

beforeAll(async () => {
  await rm(DATABASE_ROOT, { recursive: true, force: true })
  await mkdir(DATABASE_ROOT, { recursive: true })
})

afterAll(async () => {
  await closeDatabase()
  await rm(DATABASE_ROOT, { recursive: true, force: true })
})

it('db/mark-stats-store 与 services/database 是同一份实现（兼容垫片）', () => {
  expect(statsStore.collectChildMarkStatistics).toBe(collectChildMarkStatistics)
})

it('按标记记录汇总：每个模式的完成时间戳各自成列、按时间升序', async () => {
  await setStoredProjectMemoryStatuses('c-stats', 'D:\\漫画\\统计', [
    {
      pathKey: 'p1',
      path: 'p1.psd',
      status: 'done',
      mtimeMs: 1,
      modes: { typeset: true, proofread: true },
      modeTimestamps: { typeset: 300, proofread: 100 }
    },
    {
      pathKey: 'p2',
      path: 'p2.psd',
      status: 'done',
      mtimeMs: 2,
      modes: { typeset: true },
      modeTimestamps: { typeset: 200 }
    }
  ] as ProjectMemoryStatusUpdate[])

  const mine = (await statsStore.collectChildMarkStatistics()).find((s) => s.childId === 'c-stats')
  expect(mine?.fileCount).toBe(2)
  expect(mine?.completedTimestamps.typeset).toEqual([200, 300])
  expect(mine?.completedTimestamps.proofread).toEqual([100])
  expect(mine?.completedTimestamps.translated).toEqual([])
  expect(mine?.folderPath).toBe('D:\\漫画\\统计')
})

it('时间戳缺失的老记录回退到该行 updated_at（宁可粗一点，也别让历史少一截）', async () => {
  // 旧式写入（没带 modes）⇒ 只有 legacy 的 status，没有 modeTimestamps
  await setStoredProjectMemoryStatuses('c-legacy', 'D:\\漫画\\老', [
    { pathKey: 'old', path: 'old.psd', status: 'done', mtimeMs: 1 }
  ])

  const memory = await getStoredProjectMemory('c-legacy')
  const fallback = memory?.files.old.updatedAt ?? 0
  const stat = (await statsStore.collectChildMarkStatistics()).find((s) => s.childId === 'c-legacy')

  expect(stat?.fileCount).toBe(1)
  expect(fallback).toBeGreaterThan(0)
  expect(stat?.completedTimestamps.typeset).toEqual([fallback])
})
