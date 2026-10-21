// @vitest-environment node
/**
 * atomic-output 的回归锁（2026-10-05 从并行分支 T6 移植）。
 *
 * 锁三件事：
 *   1. **写一半失败 ⇒ 原文件原样、暂存文件被清掉**（磁盘满模拟）；
 *   2. **不覆盖模式：同目标的并发发布只允许一个成功**，且失败方不改原文件；
 *   3. **覆盖模式：安全替换** —— 成功后目录里只有目标文件自己（暂存被清理）。
 */
import { beforeEach, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const failure = vi.hoisted(() => ({ enabled: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (failure.enabled)
        handle.writeFile = async () => {
          await handle.write(Buffer.from('partial'))
          throw Error('simulated disk full')
        }
      return handle
    }
  }
})
import { publishOutput } from '../atomic-output'
beforeEach(() => {
  failure.enabled = false
})
it('keeps the previous output and cleans staging after a partial write failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qianzi-atomic-'))
  try {
    const file = join(dir, 'page.psd')
    await writeFile(file, 'original')
    failure.enabled = true
    await expect(publishOutput(file, Buffer.from('replacement'), true)).rejects.toThrow('disk full')
    expect(await readFile(file, 'utf8')).toBe('original')
    expect(await readdir(dir)).toEqual(['page.psd'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('publishes once without overwrite and safely replaces only when requested', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qianzi-atomic-'))
  try {
    const file = join(dir, 'page.psd')
    const results = await Promise.all([
      publishOutput(file, Buffer.from('first'), false),
      publishOutput(file, Buffer.from('second'), false)
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    const original = await readFile(file, 'utf8')
    expect(await publishOutput(file, Buffer.from('forbidden'), false)).toBe(false)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(await publishOutput(file, Buffer.from('replacement'), true)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('replacement')
    expect(await readdir(dir)).toEqual(['page.psd'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
