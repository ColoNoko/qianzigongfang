// @vitest-environment node

/**
 * 键值设置层（`services/db/key-value.ts`）—— **P4 第二刀** 的回归锁（2026-10-02）。
 *
 * 这一刀是**纯搬运**：`getStoredValue` / `setStoredValue` / `setStoredValueSync` 从
 * `services/database.ts` 搬到 `services/db/key-value.ts`，对外仍由 `./database`
 * re-export。纯搬运最容易出的两种事故，就是下面这两条锁盯的东西：
 *
 * 1. **re-export 变成"另一份实现"**：`./database` 那边自己又写了一份键值读写 ——
 *    两边读同一个 key 会各说各话。锁法：**函数身份必须同一**（`toBe`）。
 * 2. **新模块偷偷自己开了一个库**（复制一份连接状态）：那样"通过模块 A 写、通过模块 B 读"
 *    就不通了 —— 关闭期那条同步写会写进一个没人读的库。锁法：用 `node:sqlite` 直接看
 *    **磁盘上那个库**里到底有没有这一行。
 *
 * 这两条都**不测新行为**：它们锁的是"搬家前后一模一样"（与 P1/P2 的规矩一致）。
 */

import { afterAll, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

const DATABASE_ROOT = resolve(__dirname, '../../../../../.omo/fixtures/key-value-test')

vi.mock('electron', () => ({
  app: { getPath: () => DATABASE_ROOT }
}))

import {
  closeDatabase,
  databasePath,
  getStoredValue,
  setStoredValue,
  setStoredValueSync
} from '../../database'
import * as keyValue from '../key-value'

afterAll(async () => {
  await closeDatabase()
  await rm(DATABASE_ROOT, { recursive: true, force: true })
})

it('db/key-value 与 services/database 是同一份实现，不是两份（纯搬运的兼容垫片）', () => {
  // ⚠️ 这里必须是 `toBe`（身份），不能退化成"同名函数"：再写一份实现同样能"同名"。
  expect(keyValue.getStoredValue).toBe(getStoredValue)
  expect(keyValue.setStoredValue).toBe(setStoredValue)
  expect(keyValue.setStoredValueSync).toBe(setStoredValueSync)
})

it('键值读写落在连接层那一个库上（新模块没有自己另开一份连接）', async () => {
  // 异步写 → 异步读（走懒打开的那条路）
  await keyValue.setStoredValue('ui.p4KeyValueAudit', { from: 'key-value' })
  expect(await getStoredValue('ui.p4KeyValueAudit')).toEqual({ from: 'key-value' })

  // 关闭期那条同步写 → 由**另一个模块**读回来（同一份连接状态才可能通过）
  expect(keyValue.setStoredValueSync('ui.p4KeyValueSyncAudit', 42)).toBe(true)
  expect(await getStoredValue('ui.p4KeyValueSyncAudit')).toBe(42)

  // 直接看磁盘上那个库：两行都在，值就是写进去的 JSON
  const raw = new DatabaseSync(databasePath(), { readOnly: true })
  try {
    const rows = raw
      .prepare(
        `SELECT key, value_json FROM key_value_store WHERE key LIKE 'ui.p4KeyValue%' ORDER BY key`
      )
      .all() as Array<{ key: string; value_json: string }>
    expect(rows).toEqual([
      { key: 'ui.p4KeyValueAudit', value_json: '{"from":"key-value"}' },
      { key: 'ui.p4KeyValueSyncAudit', value_json: '42' }
    ])
  } finally {
    raw.close()
  }
})
