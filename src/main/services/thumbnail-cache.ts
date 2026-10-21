import {readPreview,writePreview,deletePreview} from './preview-cache'
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { readFile, stat, unlink, utimes } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = 'v1-480-composite'
const MAX_CACHE_BYTES = 512 * 1024 * 1024
const cacheRoot = (): string => join(app.getPath('userData'), 'cache', 'media-thumbnails', VERSION)
const legacyRoot = (): string => join(app.getPath('temp'), 'qianzi-gongfang-psd-thumbnails')
function cacheFile(path: string, mtime: number): string {
  const key = createHash('sha256')
    .update(JSON.stringify([path.replace(/\\/g, '/').toLowerCase(), mtime, VERSION]))
    .digest('hex')
  return join(cacheRoot(), `${key}.cache`)
}
function legacyFile(path: string, mtime: number): string {
  return join(legacyRoot(), createHash('sha256').update(`${path}\0${mtime}`).digest('hex') + '.png')
}
async function sourceStat(path: string) {
  try {
    return await stat(path)
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null
    throw error
  }
}
function validThumbnail(bytes: Uint8Array): boolean {
  const data = Buffer.from(bytes)
  if (
    data.length < 45 ||
    data.length > 8 * 1024 * 1024 ||
    !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return false
  if (data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') return false
  if (
    !data.readUInt32BE(16) ||
    !data.readUInt32BE(20) ||
    data.readUInt32BE(16) > 480 ||
    data.readUInt32BE(20) > 480
  )
    return false
  let pixels = false
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset),
      end = offset + 12 + length
    if (end > data.length) return false
    const kind = data.toString('ascii', offset + 4, offset + 8)
    if (kind === 'IDAT' && length) pixels = true
    if (kind === 'IEND') return pixels && length === 0 && end === data.length
    offset = end
  }
  return false
}

/** One atomic entry includes source size and PNG; an absent source may use its historical revision. */
export async function readPsdThumbnailBytes(
  path: string,
  mtime: number
): Promise<Uint8Array | null> {
  try {
    const source = await sourceStat(path)
    if (source && (!source.isFile() || source.mtimeMs !== mtime)) return null
    const cached = readPreview('thumbnail', path, String(mtime))
    if (cached) {
      const meta = JSON.parse(cached.metadata)
      if ((!source || meta.size === source.size) && validThumbnail(cached.payload)) return cached.payload
      deletePreview('thumbnail',path)
    }
    const file = cacheFile(path, mtime)
    let bytes: Buffer
    try {
      if ((await stat(file)).size > 8 * 1024 * 1024 + 1024) {
        await unlink(file)
        return null
      }
      const data = await readFile(file)
      if (data.length < 4) throw new Error('Invalid cache header')
      const length = data.readUInt32BE(0)
      if (length > 1024 || length + 4 >= data.length) throw new Error('Invalid cache metadata')
      const metadata = JSON.parse(data.toString('utf8', 4, length + 4))
      if (metadata.mtime !== mtime || !Number.isFinite(metadata.size)) return null
      if (source && metadata.size !== source.size) return null
      bytes = data.subarray(length + 4)
      if (!validThumbnail(bytes)) {
        await unlink(file)
        return null
      }
      void utimes(file, new Date(), new Date()).catch(() => undefined)
    } catch {
      // Old cache has no size metadata. Only trust it when the original is absent.
      if (source) return null
      const old = legacyFile(path, mtime)
      if ((await stat(old)).size > 8 * 1024 * 1024) return null
      bytes = await readFile(old)
      if (!validThumbnail(bytes)) return null
    }
    writePreview('thumbnail',path,String(mtime),bytes,{size:source?.size ?? -1})
    return bytes
  } catch {
    return null
  }
}
export async function writePsdThumbnailBytes(
  path: string,
  mtime: number,
  bytes: Uint8Array,
  size?: number
): Promise<void> {
  if (!validThumbnail(bytes)) return
  const source = await sourceStat(path)
  if (!source?.isFile() || source.mtimeMs !== mtime || (size !== undefined && size !== source.size))
    return
  writePreview('thumbnail',path,String(mtime),bytes,{size:source.size})
}
export async function invalidatePsdThumbnail(path: string, mtime: number): Promise<void> {
  deletePreview('thumbnail',path)
  await unlink(cacheFile(path, mtime)).catch(() => undefined)
  await unlink(legacyFile(path, mtime)).catch(() => undefined)
}
export async function readPsdThumbnailCache(path: string, mtime: number): Promise<string | null> {
  const bytes = await readPsdThumbnailBytes(path, mtime)
  return bytes ? `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` : null
}
export async function writePsdThumbnailCache(
  path: string,
  mtime: number,
  url: string
): Promise<void> {
  const prefix = 'data:image/png;base64,'
  if (url.startsWith(prefix))
    await writePsdThumbnailBytes(path, mtime, Buffer.from(url.slice(prefix.length), 'base64'))
}
export interface ThumbCacheEntry {
  path: string
  size: number
  /** 最近访问时间，通过 utimes 显式更新，避免依赖 NTFS atime。 */
  mtimeMs: number
}

/**
 * 超限时选出要淘汰的条目：按**最久未使用**先删，直到总量降到上限内。
 *
 * 抽成纯函数是为了能直接测淘汰策略 —— 真正触发一次淘汰要写满 512MB，测试里做不到。
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

/** Explicit reset only, never on ordinary application exit. */
export function clearPsdThumbnailCacheSync(): void {
  deletePreview('thumbnail')
  for (const root of [cacheRoot(), legacyRoot()]) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}
