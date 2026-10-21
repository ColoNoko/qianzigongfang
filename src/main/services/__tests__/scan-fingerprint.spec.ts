// @vitest-environment node
/**
 * `computeSourceRevision`（2026-10-05 从 0.4.0 移植）—— 章节"内容指纹"。
 *
 * 为什么不是 PSD 的时间戳：译文导入只改 PSD，而**原图 / TXT** 变了同样意味着
 * "这一话的内容变了"（配对、进度口径都要重算）。0.4.0 的指纹取
 * `imageFiles + txtFiles` 的（路径、大小、mtime），PSD 单独由配对处理。
 * 目录监听就靠它判断"这一话到底变没变"，而不是任何文件动一下都全量重扫。
 */
import { mkdtemp, mkdir, writeFile, utimes, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeIdentityFingerprint, computeSourceRevision } from '../scan-fingerprint'
import type { ChildProjectScan } from '@shared/types'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'qianzi-fingerprint-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

function scanOf(imageFiles: string[], txtFiles: string[]): ChildProjectScan {
  return { jpgPairs: [], imageFiles, txtFiles, errors: [], status: 'complete' }
}

describe('computeSourceRevision — 内容指纹', () => {
  it('同一批文件 ⇒ 两次指纹一致（可当缓存判据）', async () => {
    const dir = join(work, '第1話')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '01.jpg'), 'img')
    await writeFile(join(dir, '01.txt'), '翻译 校对')

    const scan = scanOf([join(dir, '01.jpg')], [join(dir, '01.txt')])
    const first = await computeSourceRevision(scan)
    const second = await computeSourceRevision(scan)

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('原图 / TXT 变了 ⇒ 指纹变（PSD 动不动不影响它）', async () => {
    const dir = join(work, '第1話')
    await mkdir(dir, { recursive: true })
    const jpg = join(dir, '01.jpg')
    const txt = join(dir, '01.txt')
    await writeFile(jpg, 'img')
    await writeFile(txt, '翻译')

    const before = await computeSourceRevision(scanOf([jpg], [txt]))

    // 只改 TXT 内容（mtime 变）
    const later = new Date(Date.now() + 60_000)
    await utimes(txt, later, later)
    const after = await computeSourceRevision(scanOf([jpg], [txt]))

    expect(after).not.toBe(before)
  })

  it('文件被删 ⇒ 指纹变（而不是假装没变）', async () => {
    const dir = join(work, '第1話')
    await mkdir(dir, { recursive: true })
    const jpg = join(dir, '01.jpg')
    await writeFile(jpg, 'img')

    const before = await computeSourceRevision(scanOf([jpg], []))
    await rm(jpg)
    const after = await computeSourceRevision(scanOf([jpg], []))

    expect(after).not.toBe(before)
  })

  it('没有图片也没有 TXT ⇒ 稳定空指纹（不报错）', async () => {
    const first = await computeSourceRevision(scanOf([], []))
    const second = await computeSourceRevision(scanOf([], []))
    expect(first).toBe(second)
  })
})

/**
 * 「改名认领」用的**全文件指纹**（2026-10-05，R1）。
 *
 * ⚠️ 这里锁的是一个**真会咬人**的坑：`computeSourceRevision` 只看原图 + TXT，
 * 所以**只有 PSD 的话**在它那里会退化成"空集合的 sha256"（同一个常量）——
 * 拿它做改名比对，两话会被判成"内容完全相同"。`computeIdentityFingerprint` 必须含 PSD。
 */
describe('computeIdentityFingerprint — 含 PSD 的全文件指纹', () => {
  function scanOf(psds: string[], images: string[], txts: string[]): ChildProjectScan {
    return {
      jpgPairs: psds.map((absPath) => ({
        psd: { absPath, mtimeMs: 1, ctimeMs: 1, status: 'pending' as const }
      })),
      imageFiles: images,
      txtFiles: txts,
      errors: [],
      status: 'complete'
    }
  }

  it('只有 PSD 的两话：sourceRevision 相同（退化），identity 必须不同', async () => {
    const dir = join(work, '第1話')
    await mkdir(dir, { recursive: true })
    const a = join(dir, 'a.psd')
    const b = join(dir, 'b.psd')
    await writeFile(a, 'aaa')
    await writeFile(b, 'bbb')

    const onlyA = scanOf([a], [], [])
    const onlyB = scanOf([b], [], [])

    expect(await computeSourceRevision(onlyA)).toBe(await computeSourceRevision(onlyB))
    expect(await computeIdentityFingerprint(onlyA)).not.toBe(
      await computeIdentityFingerprint(onlyB)
    )
  })

  it('内容没动 ⇒ 同一个指纹（改名后仍能对上）', async () => {
    const dir = join(work, '第1話')
    await mkdir(dir, { recursive: true })
    const psd = join(dir, '01.psd')
    const jpg = join(dir, '01.jpg')
    await writeFile(psd, 'psd')
    await writeFile(jpg, 'jpg')

    const scan = scanOf([psd], [jpg], [])
    const before = await computeIdentityFingerprint(scan, dir)
    const moved = join(work, '改名后的第1話')
    await rename(dir, moved)
    expect(
      await computeIdentityFingerprint(
        scanOf([join(moved, '01.psd')], [join(moved, '01.jpg')], []),
        moved
      )
    ).toBe(before)
  })
})
