// @vitest-environment node

/**
 * 台账 / 撤销 / 还原层 —— **P4 第五刀**的回归锁（2026-10-02）。
 *
 * `readMarkAuditOperation` / `listMarkAuditOperations` / `getMarkAuditOperation` /
 * `findUndoableMarkOperation` / `applyMarkWriteBack` / `undoMarkOperation` /
 * `applyMarkRestore` 从 `services/database.ts` 搬到 `services/db/mark-audit-store.ts`，
 * 对外仍由 `./database` re-export。
 *
 * 这里锁三件事（这是 2026-09-26 那次数据损坏事故之后立的规矩，换文件也不能走样）：
 * 1. **不是第二份实现**（`toBe` 身份）；
 * 2. **撤销精确回到从前** —— 模式与**时间戳**都要回到"改之前"，其它模式不许被顺手改；
 * 3. **撤销过的操作不再是候选**（`findUndoableMarkOperation` 不许把它再交出来）。
 */

import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const DATABASE_ROOT = resolve(__dirname, '../../../../../.omo/fixtures/mark-audit-store-test')

vi.mock('electron', () => ({
  app: { getPath: () => DATABASE_ROOT }
}))

import {
  applyMarkRestore,
  closeDatabase,
  findUndoableMarkOperation,
  getMarkAuditOperation,
  getStoredProjectMemory,
  listMarkAuditOperations,
  setStoredProjectMemoryStatuses,
  undoMarkOperation
} from '../../database'
import * as auditStore from '../mark-audit-store'
import type { MarkAuditContext } from '@shared/mark-audit'
import type { ProjectMemoryStatusUpdate } from '@shared/ipc-api'

function context(partial: Partial<MarkAuditContext> & { opId: string }): MarkAuditContext {
  return { kind: 'mark', source: 'viewer', ...partial }
}

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

it('db/mark-audit-store 与 services/database 是同一份实现（兼容垫片）', () => {
  expect(auditStore.listMarkAuditOperations).toBe(listMarkAuditOperations)
  expect(auditStore.getMarkAuditOperation).toBe(getMarkAuditOperation)
  expect(auditStore.findUndoableMarkOperation).toBe(findUndoableMarkOperation)
  expect(auditStore.undoMarkOperation).toBe(undoMarkOperation)
  expect(auditStore.applyMarkRestore).toBe(applyMarkRestore)
})

it('撤销精确回到从前：模式与时间戳都还原，且撤销过的操作不再可撤销', async () => {
  const childId = 'child-undo'
  // 先铺一层"其它模式已经做了"的底：撤销时不许把它顺手改掉
  await setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\撤销', [
    update({ modes: { translated: true }, modeTimestamps: { translated: 50 } })
  ])

  await setStoredProjectMemoryStatuses(
    childId,
    'D:\\漫画\\撤销',
    [update({ modes: { typeset: true }, modeTimestamps: { typeset: 900 } })],
    context({ opId: 'op-undo', mode: 'typeset', targetStatus: 'done' })
  )

  const beforeUndo = await getStoredProjectMemory(childId)
  expect(beforeUndo?.files.page.modes?.typeset).toBe(true)
  expect((await findUndoableMarkOperation())?.opId).toBe('op-undo')

  const result = await undoMarkOperation('op-undo')
  expect(result.revertedFiles).toBe(1)

  const afterUndo = await getStoredProjectMemory(childId)
  // 回到"改之前"：嵌字取消、时间戳一并撤掉
  expect(afterUndo?.files.page.modes?.typeset).toBe(false)
  expect(afterUndo?.files.page.modeTimestamps?.typeset).toBeUndefined()
  // 别的模式原样保留（撤销不是"清空这一行"）
  expect(afterUndo?.files.page.modes?.translated).toBe(true)
  expect(afterUndo?.files.page.modeTimestamps?.translated).toBe(50)

  // 已经撤销过的不再是候选（否则可以绕成圈）
  expect(await findUndoableMarkOperation()).toBeNull()
  // 撤销本身也留痕（台账里能看到这次 undo）
  const operations = await listMarkAuditOperations()
  expect(operations.map((operation) => operation.kind)).toContain('undo')
})

it('台账里没有的操作必须抛错（不许静默地"什么都没改还报成功"）', async () => {
  await expect(undoMarkOperation('op-does-not-exist')).rejects.toThrow(/台账里没有这次操作/)
})
