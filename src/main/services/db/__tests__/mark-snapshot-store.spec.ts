// @vitest-environment node

/**
 * 标记快照层（备份 / 还原预览的两侧）—— **P4 第六刀（收官）**的回归锁（2026-10-02）。
 *
 * `currentMarkSnapshot` / `readMarkSnapshotFromFile` 从 `services/database.ts` 搬到
 * `services/db/mark-snapshot-store.ts`，对外仍由 `./database` re-export。
 *
 * 这里锁三件事：
 * 1. **不是第二份实现**（`toBe` 身份）；
 * 2. **撤销逐字回到从前，包括时间戳**（台账里的 `mtimeMs` 也是"这行标记属于哪个版本的
 *    文件"的信息，用当前时间覆盖它就把这层信息抹掉了）；
 * 3. **从备份文件读快照也能把模式与时间戳带出来**（还原预览的"那一侧"）。
 */

import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const DATABASE_ROOT = resolve(__dirname, '../../../../../.omo/fixtures/mark-snapshot-store-test')

vi.mock('electron', () => ({
  app: { getPath: () => DATABASE_ROOT }
}))

import {
  applyMarkRestore,
  closeDatabase,
  currentMarkSnapshot,
  getStoredProjectMemory,
  readMarkSnapshotFromFile,
  setStoredProjectMemoryStatuses,
  writeDatabaseSnapshotTo
} from '../../database'
import * as snapshotStore from '../mark-snapshot-store'
import type { MarkSnapshot } from '@shared/mark-audit'
import type { ProjectMemoryStatusUpdate } from '@shared/ipc-api'

function update(partial: Partial<ProjectMemoryStatusUpdate>): ProjectMemoryStatusUpdate {
  return {
    pathKey: partial.pathKey ?? 'page',
    path: partial.path ?? 'D:\\漫画\\01.psd',
    status: partial.status ?? 'done',
    mtimeMs: partial.mtimeMs ?? 4242,
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

it('db/mark-snapshot-store 与 services/database 是同一份实现（兼容垫片）', () => {
  expect(snapshotStore.currentMarkSnapshot).toBe(currentMarkSnapshot)
  expect(snapshotStore.readMarkSnapshotFromFile).toBe(readMarkSnapshotFromFile)
})

it('撤销逐字回到从前：连 mtimeMs 与时间戳一起还原', async () => {
  const childId = 'child-snapshot'
  await setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\快照', [
    update({ modes: { typeset: true }, modeTimestamps: { typeset: 777 } })
  ])
  const before = await currentMarkSnapshot()
  const beforeFile = before.children[childId].files.page
  expect(beforeFile.mtimeMs).toBe(4242)
  expect(beforeFile.timestamps.typeset).toBe(777)

  // 标记一笔（会进台账），然后把这一行改到"另一个版本"，再用台账撤销
  await setStoredProjectMemoryStatuses(
    childId,
    'D:\\漫画\\快照',
    [update({ mtimeMs: 9999, modes: { typeset: true }, modeTimestamps: { typeset: 888 } })],
    { kind: 'mark', source: 'viewer', opId: 'op-snapshot' }
  )

  await applyMarkRestore(
    [
      {
        childId,
        folderPath: 'D:\\漫画\\快照',
        updates: [
          update({ mtimeMs: 4242, modes: { typeset: true }, modeTimestamps: { typeset: 777 } })
        ]
      }
    ],
    'backup.sqlite'
  )

  const after = await getStoredProjectMemory(childId)
  expect(after?.files.page.mtimeMs).toBe(4242)
  expect(after?.files.page.modeTimestamps?.typeset).toBe(777)
  expect(after?.files.page.modes?.typeset).toBe(true)

  // 快照那一侧（磁盘上真正落盘的那份）也要能读出同样的模式与时间戳 ——
  // 只查上面那个"读回来的对象"是不够的：写回时把时间戳丢掉、mtime 照旧，上面那几条看不出来
  const snapshotAfter = await currentMarkSnapshot()
  const fileAfter = snapshotAfter.children[childId].files.page
  expect(fileAfter.mtimeMs).toBe(4242)
  expect(fileAfter.modes.typeset).toBe(true)
  expect(fileAfter.timestamps.typeset).toBe(777)
})

it('从另一份库文件读快照：模式与时间戳都要带出来（还原预览的那一侧）', async () => {
  const backupPath = resolve(DATABASE_ROOT, 'backup-snapshot.sqlite')
  await writeDatabaseSnapshotTo(backupPath)

  const snapshot: MarkSnapshot = readMarkSnapshotFromFile(backupPath)
  const file = snapshot.children['child-snapshot'].files.page
  expect(file.mtimeMs).toBe(4242)
  expect(file.modes.typeset).toBe(true)
  expect(file.timestamps.typeset).toBe(777)
})
