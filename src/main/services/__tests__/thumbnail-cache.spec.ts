// @vitest-environment node
/**
 * PSD 缩略图缓存：**跨会话持久化**（2026-10-01）。
 *
 * 旧实现每个进程启动时 `rmSync` 掉整个缓存目录，理由是"崩溃会留下垃圾会话目录"。
 * 代价是：用户把某一话的文件夹删掉/移走之后，重启程序就再也看不到那一话的缩略图了
 * —— 而目录不在时，缩略图唯一能依赖的就是这份缓存。清空它等于让"删图后仍可查看"失效。
 *
 * 这里锁两件事：
 *   ① 写进去的缩略图**跨模块重载（≈ 新进程）仍读得到** —— 这就是"不再启动即清空"；
 *   ② 超限淘汰按**最早写入**先删（策略抽成纯函数 pickEvictions 才能直接测）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../../../.omo/fixtures/thumbnail-cache-test')

vi.mock('electron', () => ({
  app: { getPath: () => ROOT }
}))

import { pickEvictions, readPsdThumbnailCache, writePsdThumbnailCache } from '../thumbnail-cache'

const PNG_PREFIX = 'data:image/png;base64,'
const SAMPLE = `${PNG_PREFIX}${Buffer.from('fake-png-bytes').toString('base64')}`

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true })
  await mkdir(ROOT, { recursive: true })
})

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true })
})

describe('缩略图缓存', () => {
  it('写进去就能读回来', async () => {
    await writePsdThumbnailCache('D:\\comic\\ch1\\001.psd', 1000, SAMPLE)

    await expect(readPsdThumbnailCache('D:\\comic\\ch1\\001.psd', 1000)).resolves.toBe(SAMPLE)
  })

  it('键里带 mtime：PSD 改过之后不会命中旧图', async () => {
    await writePsdThumbnailCache('D:\\comic\\ch1\\002.psd', 1000, SAMPLE)

    await expect(readPsdThumbnailCache('D:\\comic\\ch1\\002.psd', 2000)).resolves.toBeNull()
  })

  it('没写过的路径返回 null（不抛错）', async () => {
    await expect(readPsdThumbnailCache('D:\\comic\\ch1\\never-written.psd', 1)).resolves.toBeNull()
  })

  it('★ 跨"重启"仍读得到：模块重载会清掉模块级状态，但缓存文件必须还在', async () => {
    const path = 'D:\\comic\\ch1\\persist.psd'
    await writePsdThumbnailCache(path, 3000, SAMPLE)

    // 重新加载模块 ≈ 新进程启动。旧实现在这一步会 rmSync 整个缓存目录。
    vi.resetModules()
    const fresh = await import('../thumbnail-cache')

    await expect(fresh.readPsdThumbnailCache(path, 3000)).resolves.toBe(SAMPLE)
  })
})

describe('pickEvictions（淘汰策略）', () => {
  const entry = (path: string, size: number, mtimeMs: number) => ({ path, size, mtimeMs })

  it('没超上限时一个都不淘汰', () => {
    const entries = [entry('a', 10, 1), entry('b', 10, 2)]

    expect(pickEvictions(entries, 100)).toEqual([])
  })

  it('超限时按最早写入先删，删到刚好回到上限内', () => {
    const entries = [
      entry('newest', 40, 300),
      entry('oldest', 40, 100),
      entry('middle', 40, 200)
    ]

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
