import { restoreStatisticsTimes } from './db/statistics-time-store'
/**
 * db-backup —— 数据库备份与"从备份还原标记"。
 *
 * 为什么要有它：作者真的丢过标记（见 `shared/mark-audit.ts` 顶部），而出事时手上只有
 * **手工拷贝**的整库副本（工作区里那两坨 `data-backups-*` 文件夹）。程序里没有任何兜底
 * 是说不过去的 —— 这一轮补上，并且做成三件小事：
 *
 *   ① 备份 = `VACUUM INTO` 出的**一致性快照**（单文件、含 WAL 里的内容），
 *      不是"拷一半的 sqlite"（第十轮吃过这个亏：只拷主库 = 只代表最后一次检查点）；
 *   ② 每份备份配一个 `.json` sidecar（时间 / 原因 / 行数 / sha256）—— 台账与界面都靠它说话；
 *   ③ 保底策略：**只保留最近 N 份**，避免把磁盘吃满；每次创建后自动清理并记日志。
 *
 * 「还原」刻意**不做整库替换**（那要在程序持有连接时换文件、还得重启）：
 * 这里只把**标记**按备份写回去 —— 走的是和手动标记完全相同的写入通道
 * （`setStoredProjectMemoryStatuses`），因此照样进台账（`kind='restore'`），可追溯。
 * 真要整库回滚：备份文件本身就在 `backups/` 里，关掉程序手工替换即可（见交接文档）。
 */
import { basenameOf } from '@shared/paths'
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DbBackupInfo, MarkRestorePreview } from '@shared/ipc-api'
import { describeMarkEntry, diffMarkSnapshots, type MarkAuditEntry } from '@shared/mark-audit'
import { currentMarkSnapshot, readMarkSnapshotFromFile, writeDatabaseSnapshotTo } from './database'

/** 每隔多久算"该自动备份了"（同一次运行里只判断一次）。 */
export const AUTO_BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000
/** 最多留几份（大约每份 3 MB，20 份 ≈ 60 MB —— 对磁盘无压力，但足够找回几天前）。 */
export const KEEP_BACKUPS = 20

// Reference counts protect a selected restore source across concurrent backup creation.
const pinnedBackups = new Map<string, number>()
export async function withPinnedDatabaseBackup<T>(
  file: string,
  action: () => Promise<T>
): Promise<T> {
  const key = resolve(file)
  pinnedBackups.set(key, (pinnedBackups.get(key) ?? 0) + 1)
  try {
    return await action()
  } finally {
    const remaining = (pinnedBackups.get(key) ?? 1) - 1
    if (remaining) pinnedBackups.set(key, remaining)
    else pinnedBackups.delete(key)
  }
}

export function backupsDirectory(): string {
  return join(app.getPath('userData'), 'backups')
}

/**
 * 文件名里的时间戳：到**毫秒**。
 *
 * 到秒是不够的 —— 测试里连着建 21 份就会同名，而同名会让 `VACUUM INTO` 直接失败
 * （它不允许覆盖已有文件）。真人不会在同一毫秒点两次「立即备份」，但"同一秒"完全可能。
 */
export function stamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `${pad(date.getMilliseconds(), 3)}`
  )
}

function sidecarPath(file: string): string {
  return `${file}.json`
}

/**
 * 数一份备份里各表有多少行（只读打开，读完就关）。
 *
 * 打不开/不是数据库时返回空表：备份目录里可能躺着用户手工放的、或拷了一半的文件，
 * **列表不能因此整页崩掉**（真要还原时 `assertUsableBackup` 会拦住它）。
 */
function countRowsIn(file: string): Record<string, number> {
  let database: DatabaseSync
  try {
    database = new DatabaseSync(file, { readOnly: true })
  } catch {
    return {}
  }
  try {
    const tables = database
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name`)
      .all() as Array<{ name: string }>
    const counts: Record<string, number> = {}
    for (const table of tables) {
      if (table.name.startsWith('sqlite_')) continue
      const row = database
        .prepare(`SELECT COUNT(*) AS count FROM "${table.name.replace(/"/g, '""')}"`)
        .get() as { count: number } | undefined
      counts[table.name] = row?.count ?? 0
    }
    return counts
  } catch {
    return {}
  } finally {
    database.close()
  }
}

async function sha256Of(file: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}

async function describeBackup(file: string, reason: string, at: number): Promise<DbBackupInfo> {
  const stats = await stat(file)
  return {
    file: basenameOf(file),
    path: file,
    at,
    bytes: stats.size,
    reason,
    sha256: await sha256Of(file),
    rows: countRowsIn(file)
  }
}

/**
 * 一致性快照 + sidecar。`reason` 会写进文件名与 sidecar：
 * `manual`（界面按钮）/ `auto`（启动时到点）/ `delivery`（交付脚本）/ `before-restore`（还原前）。
 */
export async function createDatabaseBackup(reason: string): Promise<DbBackupInfo> {
  const dir = backupsDirectory()
  await mkdir(dir, { recursive: true })
  const at = Date.now()
  const safeReason = reason.replace(/[^a-z0-9-]/gi, '') || 'manual'
  // 双保险：万一同毫秒撞名，就加序号（宁可名字难看，也不要"备份失败"或覆盖已有备份）。
  let target = join(dir, `qianzi-gongfang-${stamp(at)}-${safeReason}.sqlite`)
  let suffix = 2
  while (existsSync(target)) {
    target = join(dir, `qianzi-gongfang-${stamp(at)}-${safeReason}-${suffix}.sqlite`)
    suffix++
  }
  await writeDatabaseSnapshotTo(target)
  const info = await describeBackup(target, safeReason, at)
  await writeFile(sidecarPath(target), JSON.stringify(info, null, 2), 'utf8')
  await pruneBackups()
  return info
}

/** 只保留最近 `KEEP_BACKUPS` 份（按文件修改时间倒序），连同 sidecar 一起删。 */
async function pruneBackups(): Promise<string[]> {
  const dir = backupsDirectory()
  if (!existsSync(dir)) return []
  const entries = await readdir(dir)
  const files = entries.filter((name) => name.endsWith('.sqlite'))
  const described: Array<{ path: string; mtimeMs: number }> = []
  for (const name of files) {
    const full = join(dir, name)
    described.push({ path: full, mtimeMs: (await stat(full)).mtimeMs })
  }
  described.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const removed: string[] = []
  let remaining = described.length
  for (const item of [...described].reverse()) {
    if (remaining <= KEEP_BACKUPS) break
    if (pinnedBackups.has(resolve(item.path))) continue
    await unlink(item.path)
    await unlink(sidecarPath(item.path)).catch(() => undefined)
    removed.push(basenameOf(item.path))
    remaining--
  }
  return removed
}

/**
 * sidecar 里的 `rows` 不一定可信 —— 只在它真的给了非空行数时才采信，否则按备份文件现算。
 *
 * 由来（2026-09-30 真机事故，1.0 首次交付当天暴露）：`scripts/deliver-windows.mjs` 写 sidecar 时
 * 只写了 `file/path/at/bytes/reason/sha256`，**没有 `rows`**。而列表原本"只要 sidecar 能解析、
 * `at` 是数字就整份采信"，于是那条备份的 `rows` 是 `undefined`；设置页模板里
 * `item.rows['project_memory_files']` 直接取属性 → **整页 TypeError、设置页全白**。
 *
 * 兜底放在这一层的理由：`rows` 是列表对外的契约，谁写 sidecar 都不该让界面拿到 `undefined`。
 * 将来再冒出第三个写 sidecar 的地方，也炸不了。
 */
function rowsFromSidecarOrFile(rows: unknown, file: string): Record<string, number> {
  if (rows && typeof rows === 'object' && Object.keys(rows).length > 0) {
    return rows as Record<string, number>
  }
  return countRowsIn(file)
}

/** 备份列表（新的在前）。sidecar 缺失/损坏时用文件本身现算一份。 */
export async function listDatabaseBackups(): Promise<DbBackupInfo[]> {
  const dir = backupsDirectory()
  if (!existsSync(dir)) return []
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sqlite'))
  const infos: DbBackupInfo[] = []
  for (const name of names) {
    const full = join(dir, name)
    try {
      const raw = await readFile(sidecarPath(full), 'utf8')
      const parsed = JSON.parse(raw) as DbBackupInfo
      if (parsed && typeof parsed.at === 'number') {
        // ⚠️ `rows` 必须补齐：交付脚本写的那份 sidecar 没有这个字段，缺了会让设置页整页崩。
        infos.push({
          ...parsed,
          path: full,
          file: name,
          rows: rowsFromSidecarOrFile(parsed.rows, full)
        })
        continue
      }
    } catch {
      // sidecar 没了就用文件现算（宁可慢一点，也不要"备份列表里少一份"）。
    }
    infos.push(await describeBackup(full, 'unknown', (await stat(full)).mtimeMs))
  }
  infos.sort((a, b) => b.at - a.at)
  return infos
}

/**
 * 启动时的保底备份：距最近一份超过 `AUTO_BACKUP_INTERVAL_MS` 才做，失败由调用方吞掉。
 * 返回 null = 不需要 / 不该做。
 */
export async function autoBackupIfDue(): Promise<DbBackupInfo | null> {
  const backups = await listDatabaseBackups()
  const newest = backups[0]
  if (newest && Date.now() - newest.at < AUTO_BACKUP_INTERVAL_MS) return null
  return createDatabaseBackup('auto')
}

/** 备份文件的基本校验（防止把随便一个文件当备份去还原）。 */
function assertUsableBackup(file: string): void {
  if (!existsSync(file)) throw new Error(`备份文件不存在：${file}`)
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    const names = (
      database.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table'`).all() as Array<{
        name: string
      }>
    ).map((row) => row.name)
    if (!names.includes('project_memory_files')) {
      throw new Error('这个文件里没有标记数据（不是本程序的备份）')
    }
  } finally {
    database.close()
  }
}

/**
 * 还原预览：备份 vs 当前库，**只列会变的行**。
 * 备份里没有的（备份之后新建的）与当前库里没有的（那一话被删过）都只报数，**不猜也不删**。
 */
export async function previewMarkRestore(file: string): Promise<MarkRestorePreview> {
  assertUsableBackup(file)
  const backup = readMarkSnapshotFromFile(file)
  const current = await currentMarkSnapshot()
  const diff = diffMarkSnapshots(current, backup)
  const info = (await listDatabaseBackups()).find((item) => item.path === file)

  return {
    file: basenameOf(file),
    at: info?.at ?? Date.now(),
    changingFiles: diff.changingFiles,
    statisticsTimeChanges: await restoreStatisticsTimes(file),
    missingInBackup: diff.missingInBackup,
    missingInCurrent: diff.missingInCurrent,
    children: diff.children.map((child) => ({
      childId: child.childId,
      folderPath: child.folderPath,
      changingCount: child.changing.length,
      sample: child.changing.slice(0, 5).map((row) => {
        const entry: MarkAuditEntry = {
          pathKey: row.pathKey,
          path: row.path,
          mtimeMs: row.mtimeMs,
          beforeModes: row.currentModes,
          afterModes: row.backupModes,
          beforeTimestamps: row.currentTimestamps,
          afterTimestamps: row.backupTimestamps
        }
        return describeMarkEntry(entry)
      })
    }))
  }
}
