// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { basename, resolve, join } from 'path'
import { tmpdir } from 'os'
import { mkdir, writeFile, rm, stat, utimes, mkdtemp } from 'fs/promises'
import { scanChildProject } from '../scanner'
import { computeProgress, countablePsdStats } from '../../../shared/status'

const TEMP_DIR = resolve(__dirname, '../../../../.omo/fixtures/temp-scanner-test')

describe('scanChildProject', () => {
  beforeAll(async () => {
    // Ensure temp directory exists for our synthetic tests
    await mkdir(TEMP_DIR, { recursive: true })
  })

  afterAll(async () => {
    // Clean up temp directory
    await rm(TEMP_DIR, { recursive: true, force: true })
  })

  it.each(['1.jpg', '01.jpg', '001.jpg'])('matches padded PSD page numbers to %s', async image => {
    const folder=join(TEMP_DIR, 'numeric-' + image)
    await mkdir(folder, { recursive:true })
    await writeFile(join(folder,'001.psd'), '')
    await writeFile(join(folder,image), '')
    expect((await scanChildProject(folder)).jpgPairs[0].jpgPath).toBe(join(folder,image))
  })
  it('prefers an exact stem when padded alternatives coexist', async () => {
    const folder=join(TEMP_DIR,'numeric-priority')
    await mkdir(folder,{recursive:true})
    for(const file of ['001.psd','1.jpg','01.jpg','001.png','page1.psd']) await writeFile(join(folder,file),'')
    const result=await scanChildProject(folder)
    expect(result.jpgPairs.find(pair=>pair.psd.absPath.endsWith('001.psd'))?.jpgPath).toBe(join(folder,'001.png'))
    expect(result.jpgPairs.find(pair=>pair.psd.absPath.endsWith('page1.psd'))?.jpgPath).toBeUndefined()
  })

  it('groups jpg + psd + txt with the same stem', async () => {
    const sampleDir = join(TEMP_DIR, 'basic-grouping')
    await mkdir(sampleDir, { recursive: true })
    await writeFile(join(sampleDir, '1.jpg'), Buffer.alloc(0))
    await writeFile(join(sampleDir, '1.psd'), Buffer.alloc(0))
    await writeFile(join(sampleDir, '1.txt'), 'hello')

    const result = await scanChildProject(sampleDir)

    expect(result.jpgPairs).toHaveLength(1)
    expect(result.imageFiles).toEqual([join(sampleDir, '1.jpg')])
    expect(result.txtFiles).toHaveLength(1)
    expect(result.errors).toHaveLength(0)

    const pair = result.jpgPairs[0]
    expect(pair.jpgPath).toBe(join(sampleDir, '1.jpg'))
    expect(pair.psd.absPath).toBe(join(sampleDir, '1.psd'))
    expect(pair.psd.status).toBeDefined()
    expect(typeof pair.psd.mtimeMs).toBe('number')
    expect(typeof pair.psd.ctimeMs).toBe('number')

    expect(result.txtFiles[0]).toBe(join(sampleDir, '1.txt'))
  })

  it('returns a pair with jpgPath undefined when only .psd exists', async () => {
    const onlyPsdDir = join(TEMP_DIR, 'only-psd')
    await mkdir(onlyPsdDir, { recursive: true })
    await writeFile(join(onlyPsdDir, 'page1.psd'), Buffer.alloc(0))

    const result = await scanChildProject(onlyPsdDir)

    expect(result.jpgPairs).toHaveLength(1)
    expect(result.jpgPairs[0].jpgPath).toBeUndefined()
    expect(result.jpgPairs[0].psd.absPath).toBe(join(onlyPsdDir, 'page1.psd'))
    // 完成度只认手动标记：只有 PSD、没有任何图，也不再顺手算成已完成。
    expect(result.jpgPairs[0].psd.status).toBe('pending')
    expect(result.jpgPairs[0].countsTowardProgress).toBe(true)
    expect(result.txtFiles).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it('uses naturally sorted images as preview fallbacks when no PSD exists', async () => {
    const imageOnlyDir = join(TEMP_DIR, 'image-only-natural-sort')
    await mkdir(imageOnlyDir, { recursive: true })
    await writeFile(join(imageOnlyDir, '10.jpg'), Buffer.alloc(0))
    await writeFile(join(imageOnlyDir, '2.jpg'), Buffer.alloc(0))
    await writeFile(join(imageOnlyDir, '1.jpg'), Buffer.alloc(0))

    const result = await scanChildProject(imageOnlyDir)

    expect(result.jpgPairs.map((pair) => pair.jpgPath && basename(pair.jpgPath))).toEqual([
      '1.jpg',
      '2.jpg',
      '10.jpg'
    ])
    expect(result.jpgPairs.every((pair) => pair.previewOnly)).toBe(true)
    expect(computeProgress(countablePsdStats(result.jpgPairs))).toEqual({
      done: 0,
      total: 3,
      pct: 0
    })
  })

  it('does not count an unmatched PSD when exactly five images were found', async () => {
    const mixedDir = join(TEMP_DIR, 'many-images-unmatched-psd')
    await mkdir(mixedDir, { recursive: true })
    await writeFile(join(mixedDir, 'orphan.psd'), Buffer.alloc(0))
    for (let index = 1; index <= 5; index++) {
      await writeFile(join(mixedDir, `image-${index}.jpg`), Buffer.alloc(0))
    }

    const result = await scanChildProject(mixedDir)

    expect(result.imageFiles).toHaveLength(5)
    expect(result.jpgPairs).toHaveLength(1)
    expect(result.jpgPairs[0].countsTowardProgress).toBe(false)
    expect(countablePsdStats(result.jpgPairs)).toHaveLength(0)
  })

  it('counts an unmatched PSD when more than five images were found', async () => {
    const mixedDir = join(TEMP_DIR, 'six-images-unmatched-psd')
    await mkdir(mixedDir, { recursive: true })
    await writeFile(join(mixedDir, 'orphan.psd'), Buffer.alloc(0))
    for (let index = 1; index <= 6; index++) {
      await writeFile(join(mixedDir, `image-${index}.jpg`), Buffer.alloc(0))
    }

    const result = await scanChildProject(mixedDir)

    expect(result.imageFiles).toHaveLength(6)
    expect(result.jpgPairs[0].jpgPath).toBeUndefined()
    expect(result.jpgPairs[0].countsTowardProgress).toBe(true)
    expect(countablePsdStats(result.jpgPairs)).toHaveLength(1)
  })

  it('不再按 PSD 自身时间推导完成（只认手动标记）', async () => {
    const doneDir = join(TEMP_DIR, 'done-status')
    const psdPath = join(doneDir, 'page1.psd')
    await mkdir(doneDir, { recursive: true })
    await writeFile(psdPath, Buffer.alloc(0))

    const createdMs = (await stat(psdPath)).birthtimeMs
    const modifiedDate = new Date(createdMs + 6 * 60 * 1000)
    await utimes(psdPath, modifiedDate, modifiedDate)

    const result = await scanChildProject(doneDir)

    expect(result.jpgPairs).toHaveLength(1)
    // 这个 PSD 确实比创建时间晚 6 分钟被改动过，但那不等于"嵌字完成"：
    // 改动可能只是打开看了眼或脚本写入。完成度只由手动标记决定。
    expect(result.jpgPairs[0].psd.status).toBe('pending')
    expect(computeProgress(countablePsdStats(result.jpgPairs)).done).toBe(0)
  })

  it('不再按原图时间推导完成（只认手动标记）', async () => {
    const imageBaselineDir = join(TEMP_DIR, 'image-baseline-done-status')
    const psdPath = join(imageBaselineDir, 'page1.psd')
    const jpgPath = join(imageBaselineDir, 'page1.jpg')
    await mkdir(imageBaselineDir, { recursive: true })
    await writeFile(psdPath, Buffer.alloc(0))
    await writeFile(jpgPath, Buffer.alloc(0))

    const psdCreatedMs = (await stat(psdPath)).birthtimeMs
    const jpgMtimeMs = psdCreatedMs - 10 * 60 * 1000
    const psdMtimeMs = psdCreatedMs + 60 * 1000

    await utimes(jpgPath, new Date(jpgMtimeMs), new Date(jpgMtimeMs))
    await utimes(psdPath, new Date(psdMtimeMs), new Date(psdMtimeMs))

    const result = await scanChildProject(imageBaselineDir)

    expect(result.jpgPairs).toHaveLength(1)
    // PSD 比原图晚 10 分钟——同样是"看起来像"，不再据此判定完成。
    expect(result.jpgPairs[0].psd.status).toBe('pending')
    expect(computeProgress(countablePsdStats(result.jpgPairs)).done).toBe(0)
  })

  it('keeps same-stem files in different subfolders as separate pairs', async () => {
    const nestedDir = join(TEMP_DIR, 'same-stem-nested')
    const chapterA = join(nestedDir, 'chapter-a')
    const chapterB = join(nestedDir, 'chapter-b')
    await mkdir(chapterA, { recursive: true })
    await mkdir(chapterB, { recursive: true })
    await writeFile(join(chapterA, '001.psd'), Buffer.alloc(0))
    await writeFile(join(chapterA, '001.jpg'), Buffer.alloc(0))
    await writeFile(join(chapterB, '001.psd'), Buffer.alloc(0))
    await writeFile(join(chapterB, '001.jpg'), Buffer.alloc(0))

    const result = await scanChildProject(nestedDir)

    expect(result.jpgPairs).toHaveLength(2)
    const paths = result.jpgPairs.map((pair) => pair.psd.absPath).sort()
    expect(paths).toEqual([join(chapterA, '001.psd'), join(chapterB, '001.psd')].sort())
  })

  it('matches same-stem png and webp images, preferring the project root image', async () => {
    const imageDir = join(TEMP_DIR, 'root-image-preferred')
    const nested = join(imageDir, 'nested')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'page1.psd'), Buffer.alloc(0))
    await writeFile(join(nested, 'page1.png'), Buffer.alloc(0))
    await writeFile(join(imageDir, 'page1.webp'), Buffer.alloc(0))

    const result = await scanChildProject(imageDir)

    expect(result.jpgPairs).toHaveLength(1)
    expect(result.jpgPairs[0].jpgPath).toBe(join(imageDir, 'page1.webp'))
  })

  it('matches image stems case-insensitively on Windows-like folders', async () => {
    const imageDir = join(TEMP_DIR, 'case-insensitive-image-stem')
    await mkdir(imageDir, { recursive: true })
    await writeFile(join(imageDir, 'Page_001.PNG'), Buffer.alloc(0))
    await writeFile(join(imageDir, 'page_001.psd'), Buffer.alloc(0))

    const result = await scanChildProject(imageDir)

    expect(result.jpgPairs).toHaveLength(1)
    expect(result.jpgPairs[0].jpgPath).toBe(join(imageDir, 'Page_001.PNG'))
  })

  it('returns empty result with errors for a non-existent folder', async () => {
    const nonExistent = join(TEMP_DIR, 'does-not-exist-12345')
    const result = await scanChildProject(nonExistent)

    expect(result.jpgPairs).toHaveLength(0)
    expect(result.txtFiles).toHaveLength(0)
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
    expect(result.errors[0].path).toBe(nonExistent)
    // 2026-10-01：根目录**自己**就不在 —— 界面据此改用安静的状态条说明
    // "本地目录已不在"，而不是每次切回窗口都弹一次红色告警。
    expect(result.rootMissing).toBe(true)
  })

  it('根目录存在时不标 rootMissing（权限/网络盘那类真错误照旧报警）', async () => {
    const dir = join(TEMP_DIR, 'root-exists-flag')
    await mkdir(dir, { recursive: true })

    const result = await scanChildProject(dir)

    expect(result.rootMissing).toBe(false)
    expect(result.errors).toHaveLength(0)
  })
})

/**
 * 2026-10-05：从 0.4.0 干净分享包移植"扫描可靠性"第一批里的**状态与排除目录**。
 *
 * ⚠️ 移植边界写在这：0.4.0 的扫描器还会按文件时间**推断完成度**（`isTypesetDone`），
 * 那一半**刻意不搬** —— 本项目 §5 的语义是"完成度只认手动标记"，上面那两条
 * 旧锁（`不再按 PSD 自身时间推导完成` / `不再按原图时间推导完成`）就守着这件事。
 */
describe('scanChildProject — status 与排除目录（2026-10-05 移植）', () => {
  // ⚠️ 这个 describe 用真 /tmp（mkdtemp），不用上面的 TEMP_DIR：造"读不到"靠 chmod 000，
  // 而 TEMP_DIR 在 /mnt/d（DrvFs），chmod 不生效（实测 readdir 不会 EACCES）。
  let work: string

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), 'qianzi-scanner-'))
  })

  afterEach(async () => {
    await rm(work, { recursive: true, force: true })
  })

  it('读全 ⇒ status=complete', async () => {
    const dir = join(work, 'status-complete')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '01.jpg'), Buffer.alloc(0))
    await writeFile(join(dir, '01.psd'), Buffer.alloc(0))

    const result = await scanChildProject(dir)

    expect(result.status).toBe('complete')
    expect(result.rootMissing).toBe(false)
    expect(result.errors).toHaveLength(0)
  })

  it('目录不在 ⇒ status=unavailable（rootMissing 照旧）', async () => {
    const result = await scanChildProject(join(work, 'does-not-exist-12345'))

    expect(result.status).toBe('unavailable')
    expect(result.rootMissing).toBe(true)
  })

  it('排除目录里的 PSD 与图不计入这一话（导出目录不会被当成"多画了几页"）', async () => {
    const dir = join(work, 'excluded-output')
    const output = join(dir, 'output')
    await mkdir(output, { recursive: true })
    await writeFile(join(dir, '01.jpg'), Buffer.alloc(0))
    await writeFile(join(dir, '01.psd'), Buffer.alloc(0))
    await writeFile(join(output, '02.jpg'), Buffer.alloc(0))
    await writeFile(join(output, '02.psd'), Buffer.alloc(0))

    const result = await scanChildProject(dir, [output])

    expect(result.status).toBe('complete')
    expect(result.jpgPairs.map((pair) => pair.psd.absPath)).toEqual([join(dir, '01.psd')])
    expect(result.imageFiles).toEqual([join(dir, '01.jpg')])
  })

  it('不传排除目录 ⇒ 行为与改前一致（子目录照旧被扫）', async () => {
    const dir = join(work, 'excluded-none')
    const sub = join(dir, 'output')
    await mkdir(sub, { recursive: true })
    await writeFile(join(dir, '01.jpg'), Buffer.alloc(0))
    await writeFile(join(dir, '01.psd'), Buffer.alloc(0))
    await writeFile(join(sub, '02.psd'), Buffer.alloc(0))

    const result = await scanChildProject(dir)

    expect(result.jpgPairs.map((pair) => pair.psd.absPath).sort()).toEqual(
      [join(dir, '01.psd'), join(sub, '02.psd')].sort()
    )
  })
})
