// @vitest-environment node
/**
 * 「部分读不到 ⇒ status=partial」—— 用 mock fs 造，而不是 chmod 000。
 *
 * 为什么单独一个文件：主测试套件跑在 **Windows** 上（`npx` 是 Windows 的），
 * NTFS 上 `chmod 000` 不生效，readdir 照样成功 —— 那个"造不出来"的坑在本文件头写清楚。
 * 这里把 `fs/promises` 的 `readdir` mock 成"遇到 basename 是 `locked` 的目录就抛 EACCES"，
 * 其余路径原样透传 —— Windows / Linux 上行为一致。
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: async (target: unknown, options?: unknown) => {
      const path = typeof target === 'string' ? target : String(target)
      const basename = path.split(/[\\/]/).pop()
      if (basename === 'locked') {
        const error = new Error(
          `EACCES: permission denied, scandir '${path}'`
        ) as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      }
      return actual.readdir(target as never, options as never)
    }
  }
})

import { scanChildProject } from '../scanner'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'qianzi-scanner-partial-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('scanChildProject — partial（mock fs）', () => {
  it('有目录读不到 ⇒ status=partial，且仍返回读得到的那些页', async () => {
    const dir = join(work, '第1話')
    await mkdir(join(dir, 'locked'), { recursive: true })
    await writeFile(join(dir, '01.jpg'), Buffer.alloc(0))
    await writeFile(join(dir, '01.psd'), Buffer.alloc(0))

    const result = await scanChildProject(dir)

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.status).toBe('partial')
    // 读得到的那一页照常配对 —— partial 不是"全盘作废"
    expect(result.jpgPairs.map((pair) => pair.psd.absPath)).toEqual([join(dir, '01.psd')])
  })
})
