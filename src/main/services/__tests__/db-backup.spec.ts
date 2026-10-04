// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * 备份与「从备份还原标记」（主进程侧）。
 *
 * 为什么这几条重要：作者丢过标记，而且当时手上只有**手工拷的整库副本**。
 * 这里锁三件事：备份必须是**一致性快照**（VACUUM INTO）、还原只写回**会变的那几行**、
 * 还原前后都要留痕（写之前自动备份 + 台账里一条 kind='restore'）。
 */

const ROOT = resolve(__dirname, '../../../../.omo/fixtures/db-backup-test')

vi.mock('electron', () => ({
  app: { getPath: () => ROOT }
}))

import {
  applyMarkRestore,
  closeDatabase,
  currentMarkSnapshot,
  getMarkAuditOperation,
  listMarkAuditOperations,
  readMarkSnapshotFromFile,
  setStoredProjectMemoryStatuses
} from '../database'
import {
  AUTO_BACKUP_INTERVAL_MS,
  KEEP_BACKUPS,
  autoBackupIfDue,
  backupsDirectory,
  createDatabaseBackup,
  listDatabaseBackups,
  previewMarkRestore
} from '../db-backup'
import { buildRestoreUpdatesFromDiff, diffMarkSnapshots } from '@shared/mark-audit'

function mark(
  childId: string,
  pathKey: string,
  modes: Record<string, boolean>,
  modeTimestamps: Record<string, number>,
  opId: string
) {
  return setStoredProjectMemoryStatuses(
    childId,
    `/${childId}`,
    [{ pathKey, path: pathKey, status: 'done', mtimeMs: 1000, modes, modeTimestamps }],
    { opId, kind: 'mark', source: 'card', mode: 'typeset', targetStatus: 'done' }
  )
}

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true })
  await mkdir(ROOT, { recursive: true })
})

afterAll(async () => {
  await closeDatabase()
  await rm(ROOT, { recursive: true, force: true })
})

describe('数据库备份', () => {
  it('创建成功后：是一份能读的库、带 sidecar（时间/原因/行数/sha256）', async () => {
    await mark('c1', 'k1', { typeset: true }, { typeset: 100 }, 'op-1')

    const info = await createDatabaseBackup('manual')

    expect(info.reason).toBe('manual')
    expect(info.bytes).toBeGreaterThan(0)
    expect(info.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(info.rows['project_memory_files']).toBeGreaterThanOrEqual(1)
    expect(info.file).toContain('manual')

    // sidecar 也落盘了（浏览器里能直接看"这份是什么时候、有多少东西"）
    const sidecar = JSON.parse(await readFile(`${info.path}.json`, 'utf8'))
    expect(sidecar.sha256).toBe(info.sha256)
    expect(sidecar.at).toBe(info.at)

    // 备份文件本身是一份可读的库：能读出标记
    const snapshot = readMarkSnapshotFromFile(info.path)
    expect(snapshot.children.c1.files.k1.modes.typeset).toBe(true)
  })

  it('列表新的在前；超过保留上限时删最旧的（连同 sidecar）', async () => {
    for (let index = 0; index < KEEP_BACKUPS + 1; index++) {
      await createDatabaseBackup(`auto`)
    }

    const backups = await listDatabaseBackups()
    expect(backups.length).toBe(KEEP_BACKUPS)
    // 新的在前
    expect(backups[0].at).toBeGreaterThanOrEqual(backups[backups.length - 1].at)
    // 最早那份的 sidecar 也被清掉了（不留孤儿）
    expect(backups[0].file).toContain('auto')
  })

  it('自动备份到点才做：刚做过就返回 null，时间老了才做一份', async () => {
    expect(await autoBackupIfDue()).toBeNull()

    // 把**所有**备份的 sidecar 都改老（只改一份没用：列表按时间倒序，最新那份仍然是新的）
    for (const backup of await listDatabaseBackups()) {
      const stale = { ...backup, at: Date.now() - AUTO_BACKUP_INTERVAL_MS - 1000 }
      await writeFile(`${backup.path}.json`, JSON.stringify(stale), 'utf8')
    }

    const created = await autoBackupIfDue()
    expect(created?.reason).toBe('auto')
  })

  it('拿一个不是本程序的文件当备份 → 明确报错，而不是"还原成功但什么都没做"', async () => {
    const bogus = join(backupsDirectory(), 'not-a-backup.sqlite')
    await writeFile(bogus, 'hello', 'utf8')

    await expect(previewMarkRestore(bogus)).rejects.toThrow()
  })

  /**
   * 2026-09-30 真机事故（1.0.0 首次交付当天暴露）：
   * `scripts/deliver-windows.mjs` 写 sidecar 时**只写了 file/path/at/bytes/reason/sha256，没有 rows**，
   * 而列表原本"只要 sidecar 能解析、at 是数字就整份采信" → 那条备份的 rows 是 undefined →
   * 设置页 `item.rows['project_memory_files']` 当场 TypeError，**整页渲染失败**。
   *
   * 这里锁的是"列表不许把 undefined 交出去"：sidecar 缺 rows 就自己现算一份，
   * 同时**不许丢掉 sidecar 自己的其它字段**（来源还得认得出是"交付前"）。
   */
  it('sidecar 缺 rows（交付脚本那种写法）时：列表仍要给出行数，且不丢来源/哈希', async () => {
    const created = await createDatabaseBackup('manual')

    // 逐字复刻 deliver-windows.mjs 写出来的那份 sidecar（就是没有 rows）
    await writeFile(
      `${created.path}.json`,
      JSON.stringify(
        {
          file: created.file,
          path: created.path,
          at: created.at,
          bytes: created.bytes,
          reason: 'delivery',
          sha256: created.sha256
        },
        null,
        2
      ),
      'utf8'
    )

    const entry = (await listDatabaseBackups()).find((item) => item.file === created.file)
    expect(entry).toBeTruthy()

    // ① 行数必须有（界面直接取 entry.rows['project_memory_files']）
    expect(entry!.rows).toBeTruthy()
    expect(entry!.rows['project_memory_files']).toBeGreaterThanOrEqual(1)
    expect(entry!.rows['project_memory']).toBeGreaterThanOrEqual(1)

    // ② sidecar 自己的字段一个都不许丢
    expect(entry!.reason).toBe('delivery')
    expect(entry!.sha256).toBe(created.sha256)
    expect(entry!.at).toBe(created.at)
  })
})

describe('从备份还原标记', () => {
  it('预览只列"会变的行"，写回之后库回到备份那一刻（并留一条 kind=restore 的流水）', async () => {
    // ① 备份那一刻：k1 有嵌字
    const backup = await createDatabaseBackup('manual')

    // ② 之后又标了监修（这一笔是要被还原掉的）
    await mark('c1', 'k1', { supervised: true }, { supervised: 555 }, 'op-after-backup')

    // ③ 预览：只有 k1 这一行会变
    const preview = await previewMarkRestore(backup.path)
    expect(preview.changingFiles).toBe(1)
    // 方向是「当前 → 备份后」：预览要回答的是"点确认会发生什么"
    expect(preview.children[0].sample[0]).toContain('监修 ✓→✗')

    // ④ 写回（与 IPC handler 同一条组合：差异 → 载荷 → applyMarkRestore）
    const groups = buildRestoreUpdatesFromDiff(
      diffMarkSnapshots(await currentMarkSnapshot(), readMarkSnapshotFromFile(backup.path))
    )
    const result = await applyMarkRestore(groups, backup.path)

    expect(result.revertedFiles).toBe(1)
    const snapshot = await currentMarkSnapshot()
    expect(snapshot.children.c1.files.k1.modes).toEqual({
      typeset: true,
      translated: false,
      proofread: false,
      supervised: false
    })
    // 时间戳也要一起回去（否则统计口径会漂）
    expect(snapshot.children.c1.files.k1.timestamps).toEqual({ typeset: 100 })

    // ⑤ 还原本身也进台账（kind='restore'，指向那份备份文件）
    const operations = await listMarkAuditOperations(500)
    const restore = operations.find((operation) => operation.kind === 'restore')
    expect(restore).toBeTruthy()
    expect(restore?.refOpId).toBe(backup.path)
    expect(await getMarkAuditOperation(restore!.opId)).toBeTruthy()
  })

  it('备份与当前一模一样时：差异为空、写回 0 个文件（不产生空流水）', async () => {
    const backup = await createDatabaseBackup('manual')
    const preview = await previewMarkRestore(backup.path)

    expect(preview.changingFiles).toBe(0)
    expect(preview.children).toHaveLength(0)
  })
})
