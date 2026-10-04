import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { rmSync } from 'fs'
import { join } from 'path'

const CACHE_FOLDER_NAME = 'qianzi-gongfang-psd-thumbnails'

/**
 * 缩略图缓存**改为持久化**（2026-10-01）。
 *
 * 旧实现每个进程启动时 `rmSync` 掉整个缓存目录，只活在当次会话里。当时的理由是
 * "崩溃会留下垃圾会话目录"。但那个理由换来的是：用户把某一话的文件夹删掉/移走之后
 * （这是他的日常工作流），重启程序就再也看不到那一话的缩略图了 —— 目录不在时缩略图
 * 唯一能依赖的就是这份缓存，清空它等于让"删图后仍可查看"这件事失效。
 *
 * 现在：单一目录、跨会话复用，靠**写入时间**做容量淘汰，不再有会话子目录。
 */
const MAX_CACHE_BYTES = 256 * 1024 * 1024

/**
 * 两次淘汰扫描之间至少写入这么多张。
 *
 * 淘汰要遍历整个目录，逐张写都扫一遍会让缩略图渲染变慢；批量阈值把开销摊薄，
 * 代价是缓存可能短暂超出上限（下次扫描时收回来）。
 */
const EVICT_EVERY_WRITES = 200

let writesSinceEvict = 0

function cacheRoot(): string {
  return join(app.getPath('temp'), CACHE_FOLDER_NAME)
}

function cacheFile(psdPath: string, mtimeMs: number): string {
  const key = createHash('sha256').update(`${psdPath}\0${mtimeMs}`).digest('hex')
  return join(cacheRoot(), `${key}.png`)
}

export async function readPsdThumbnailCache(
  psdPath: string,
  mtimeMs: number
): Promise<string | null> {
  try {
    const buffer = await readFile(cacheFile(psdPath, mtimeMs))
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

export async function writePsdThumbnailCache(
  psdPath: string,
  mtimeMs: number,
  dataUrl: string
): Promise<void> {
  const prefix = 'data:image/png;base64,'
  if (!dataUrl.startsWith(prefix)) return

  await mkdir(cacheRoot(), { recursive: true })
  await writeFile(cacheFile(psdPath, mtimeMs), Buffer.from(dataUrl.slice(prefix.length), 'base64'))

  writesSinceEvict += 1
  if (writesSinceEvict >= EVICT_EVERY_WRITES) {
    writesSinceEvict = 0
    void evictIfOverLimit()
  }
}

/** 缓存目录里的一条缩略图文件（淘汰策略的输入）。 */
export interface ThumbCacheEntry {
  path: string
  size: number
  /** 写入时间（见 pickEvictions 里为什么不用访问时间）。 */
  mtimeMs: number
}

/**
 * 超限时选出要淘汰的条目：按**最早写入**先删，直到总量降到上限内。
 *
 * 抽成纯函数是为了能直接测淘汰策略 —— 真正触发一次淘汰要写满 256MB，测试里做不到。
 */
export function pickEvictions(
  entries: ThumbCacheEntry[],
  maxBytes: number = MAX_CACHE_BYTES
): ThumbCacheEntry[] {
  const total = entries.reduce((sum, entry) => sum + entry.size, 0)
  if (total <= maxBytes) return []

  const picked: ThumbCacheEntry[] = []
  let remaining = total
  for (const entry of [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (remaining <= maxBytes) break
    picked.push(entry)
    remaining -= entry.size
  }
  return picked
}

/**
 * 超出上限时按最早写入淘汰（best-effort：任何失败都不该影响缩略图渲染）。
 *
 * 按写入时间而不是访问时间：NTFS 默认关闭"最后访问时间"更新，按 atime 淘汰在
 * Windows 上等于没淘汰。
 */
async function evictIfOverLimit(): Promise<void> {
  try {
    const root = cacheRoot()
    const names = await readdir(root)
    const entries: ThumbCacheEntry[] = []

    for (const name of names) {
      const full = join(root, name)
      try {
        const info = await stat(full)
        if (!info.isFile()) continue
        entries.push({ path: full, size: info.size, mtimeMs: info.mtimeMs })
      } catch {
        // 被并发删掉了，忽略。
      }
    }

    for (const entry of pickEvictions(entries)) {
      try {
        await rm(entry.path, { force: true })
      } catch {
        // 同上：淘汰失败不影响渲染。
      }
    }
  } catch {
    // 目录不存在或不可读都当作"无需淘汰"。
  }
}

/** 清空整个缩略图缓存（复位/设置页用）。 */
export function clearPsdThumbnailCacheSync(): void {
  try {
    rmSync(cacheRoot(), { recursive: true, force: true })
  } catch {
    // ignore：清不掉也不该让调用方崩。
  }
}
