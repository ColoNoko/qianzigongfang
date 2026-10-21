import { DatabaseSync } from 'node:sqlite'
import { previewCachePath } from '../preview-cache'
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, rm, writeFile, stat, utimes, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
const ROOT = resolve(__dirname, '../../../../.omo/fixtures/thumbnail-cache-test')
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }))
import {
  pickEvictions,
  readPsdThumbnailCache,
  writePsdThumbnailCache,
  writePsdThumbnailBytes,
  invalidatePsdThumbnail
} from '../thumbnail-cache'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
  'base64'
)
const SAMPLE = 'data:image/png;base64,' + PNG.toString('base64')
beforeAll(async () => {
  await mkdir(ROOT, { recursive: true })
})
afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true })
})
async function source(name: string) {
  const path = join(ROOT, name)
  await writeFile(path, 'source')
  await utimes(path, new Date(1000), new Date(1000))
  return { path, mtime: (await stat(path)).mtimeMs }
}
describe('persistent versioned thumbnail cache', () => {
  it('round-trips a PNG through binary and compatibility APIs', async () => {
    const { path, mtime } = await source('roundtrip.psd')
    await writePsdThumbnailBytes(path, mtime, PNG)
    expect(await readPsdThumbnailCache(path, mtime)).toBe(SAMPLE)
    await invalidatePsdThumbnail(path, mtime)
    expect(await readPsdThumbnailCache(path, mtime)).toBeNull()
  })
  it('rejects changed mtime and changed size even with restored mtime', async () => {
    const { path, mtime } = await source('revision.psd')
    await writePsdThumbnailCache(path, mtime, SAMPLE)
    expect(await readPsdThumbnailCache(path, mtime + 1)).toBeNull()
    await writeFile(path, 'different size')
    await utimes(path, new Date(mtime), new Date(mtime))
    expect(await readPsdThumbnailCache(path, mtime)).toBeNull()
  })
  it('retains offline history across module reloads', async () => {
    const { path, mtime } = await source('offline.psd')
    await writePsdThumbnailCache(path, mtime, SAMPLE)
    await rm(path)
    vi.resetModules()
    const fresh = await import('../thumbnail-cache')
    expect(await fresh.readPsdThumbnailCache(path, mtime)).toBe(SAMPLE)
  })
  it('reads legacy caches for deleted sources but not live unversioned sources', async () => {
    const { path, mtime } = await source('legacy.psd')
    const dir = join(ROOT, 'qianzi-gongfang-psd-thumbnails')
    await mkdir(dir, { recursive: true })
    const name = createHash('sha256').update(`${path}\0${mtime}`).digest('hex') + '.png'
    await writeFile(join(dir, name), PNG)
    expect(await readPsdThumbnailCache(path, mtime)).toBeNull()
    await rm(path)
    expect(await readPsdThumbnailCache(path, mtime)).toBe(SAMPLE)
  })
  it('rejects malformed PNGs and corrupt entries without blocking recovery', async () => {
    const { path, mtime } = await source('corrupt.png')
    await writePsdThumbnailBytes(path, mtime, Buffer.from('fake PNG'))
    expect(await readPsdThumbnailCache(path, mtime)).toBeNull()
    await writePsdThumbnailBytes(path, mtime, PNG)
    const db = new DatabaseSync(previewCachePath())
    db.prepare('UPDATE previews SET payload=? WHERE kind=?').run(Buffer.from('corrupt'),'thumbnail')
    db.close()
    expect(await readPsdThumbnailCache(path, mtime)).toBeNull()
    await writePsdThumbnailBytes(path, mtime, PNG)
    expect(await readPsdThumbnailCache(path, mtime)).toBe(SAMPLE)
    expect(await readdir(join(ROOT,'cache'))).toContain('previews.sqlite')
  })
})
describe('pickEvictions（淘汰策略）', () => {
  const entry = (path: string, size: number, mtimeMs: number) => ({ path, size, mtimeMs })

  it('没超上限时一个都不淘汰', () => {
    const entries = [entry('a', 10, 1), entry('b', 10, 2)]

    expect(pickEvictions(entries, 100)).toEqual([])
  })

  it('超限时按最早写入先删，删到刚好回到上限内', () => {
    const entries = [entry('newest', 40, 300), entry('oldest', 40, 100), entry('middle', 40, 200)]

    // 总量 120 > 100：删掉 oldest(40) 后是 80 ≤ 100，就停手。
    expect(pickEvictions(entries, 100).map((item) => item.path)).toEqual(['oldest'])
  })

  it('一遍删不干净就继续删（顺序仍是最早优先）', () => {
    const entries = [entry('a', 60, 100), entry('b', 60, 200), entry('c', 60, 300)]

    // 总量 180 > 100：删 a(60)=120 仍超，再删 b(60)=60 ≤ 100。
    expect(pickEvictions(entries, 100).map((item) => item.path)).toEqual(['a', 'b'])
  })

  it('空目录不炸', () => {
    expect(pickEvictions([], 100)).toEqual([])
  })
})
