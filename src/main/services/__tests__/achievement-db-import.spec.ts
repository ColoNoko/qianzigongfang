// @vitest-environment node

/**
 * 「从对方的数据库文件导入」（2026-10-05，用户拍板 A 方案）。
 *
 * 场景：对面的朋友还停在老版本 / 别的分支（例如 0.4.0 的干净分享包），
 * **没有导出功能**。逼他升级是最差的选择 —— 他只要把
 * `data\database\qianzi-gongfang.sqlite` 拷过来就行。
 *
 * 这里锁三件事：
 * 1. 能按话汇总出与成就页**同一口径**的标记统计；
 * 2. **只读**：打得开、读得出，但绝不写回他的库；
 * 3. 不是汉化工坊的库（缺表 / 根本不是 SQLite）⇒ **明确报错**，绝不瞎算一个数字。
 */

import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DATABASE_ROOT = resolve(__dirname, '../../../../../.omo/fixtures/achievement-db-import-test')

// 这个服务会顺着 mark-stats-store → connection 链把 electron 拉进来，隔离掉它。
vi.mock('electron', () => ({
  app: { getPath: () => DATABASE_ROOT }
}))

import { importAchievementsFromDatabase } from '../achievement-db-import'

const FRIEND_DB = resolve(DATABASE_ROOT, '朋友的.sqlite')
const OTHER_DB = resolve(DATABASE_ROOT, '没有标记表的.sqlite')
const NOT_A_DB = resolve(DATABASE_ROOT, '照片.jpg')

/** 造一份"对方的库"：只建我们真正要读的两张表。 */
function makeFriendDatabase(file: string): void {
  const database = new DatabaseSync(file)
  database.exec(`
    CREATE TABLE project_memory (
      child_id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE project_memory_files (
      child_id TEXT NOT NULL,
      path_key TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      mode_statuses_json TEXT,
      mode_timestamps_json TEXT,
      PRIMARY KEY (child_id, path_key)
    );
  `)
  database
    .prepare('INSERT INTO project_memory (child_id, folder_path, updated_at) VALUES (?, ?, ?)')
    .run('c-friend', 'D:\\漫画\\朋友的', 1)
  const insert = database.prepare(`
    INSERT INTO project_memory_files
      (child_id, path_key, path, status, mtime_ms, updated_at, mode_statuses_json, mode_timestamps_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insert.run(
    'c-friend',
    'p1',
    'p1.psd',
    'done',
    1,
    111,
    JSON.stringify({ typeset: true, translated: true, proofread: false, supervised: false }),
    JSON.stringify({ typeset: 1000, translated: 2000 })
  )
  insert.run('c-friend', 'p2', 'p2.psd', 'pending', 1, 222, null, null)
  database.close()
}

beforeAll(async () => {
  await rm(DATABASE_ROOT, { recursive: true, force: true })
  await mkdir(DATABASE_ROOT, { recursive: true })
  makeFriendDatabase(FRIEND_DB)

  const empty = new DatabaseSync(OTHER_DB)
  empty.exec('CREATE TABLE key_value_store (key TEXT PRIMARY KEY, value_json TEXT)')
  empty.close()

  await writeFile(NOT_A_DB, '这不是数据库，只是一张图片的替身')
})

afterAll(async () => {
  await rm(DATABASE_ROOT, { recursive: true, force: true })
})

it('能把对方的库汇总成与成就页同口径的标记统计', () => {
  const result = importAchievementsFromDatabase(FRIEND_DB)

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.statistics).toHaveLength(1)
  const [stat] = result.statistics
  expect(stat.childId).toBe('c-friend')
  expect(stat.fileCount).toBe(2)
  // 每个模式各自成列、按时间升序；没时间戳的老记录回退到该行 updated_at
  expect(stat.completedTimestamps.typeset).toEqual([1000])
  expect(stat.completedTimestamps.translated).toEqual([2000])
  expect(stat.completedTimestamps.proofread).toEqual([])
})

it('只读打开：对方文件的内容一个字节都不变', async () => {
  const before = await import('node:fs/promises').then((fs) => fs.readFile(FRIEND_DB))
  importAchievementsFromDatabase(FRIEND_DB)
  const after = await import('node:fs/promises').then((fs) => fs.readFile(FRIEND_DB))

  expect(after.equals(before)).toBe(true)
})

it('缺标记记录表 → 明确报"这不是汉化工坊的数据库"', () => {
  expect(importAchievementsFromDatabase(OTHER_DB)).toEqual({
    ok: false,
    error: '这不是汉化工坊的数据库（找不到标记记录表）'
  })
})

it('根本不是 SQLite → 明确报错，不抛异常', () => {
  const result = importAchievementsFromDatabase(NOT_A_DB)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toContain('不是 SQLite')
})

it('文件不存在 → 明确报错', () => {
  expect(importAchievementsFromDatabase(resolve(DATABASE_ROOT, '没有这个文件.sqlite'))).toEqual({
    ok: false,
    error: '文件不存在'
  })
})
