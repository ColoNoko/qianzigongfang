// @vitest-environment node
/**
 * 「另存一份译文」（第 3 批）：**复制原文件 + 原地改**，写的是用户选的位置。
 *
 * 这一批的用例盯的是四件事：
 * 1. **一个字节都不许碰话目录里那份原件**（另存不是保存 —— 每次都用前后指纹证明）；
 * 2. **保译名 / 保格式**：`翻译：` / `校对：` 那两行、BOM、换行风格、坐标小数位都得原样
 *    （整份重生成最容易丢的就是它们）；
 * 3. **"当前翻译"要带上还没落盘的改动**，而算不出来时**整份拒绝**（不静默少一条）；
 * 4. **不许另存到原件本身**（那会绕过"保存"那条有备份与冲突检查的通道）。
 *
 * fixture 在仓库 `.omo/fixtures` 下（与 chapter-translation-write 同一套做法；`.omo` 不进发布）。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../../../.omo/fixtures/chapter-translation-export')

/** 对话框与"原子写"都换成可编程的替身：不这样就没法测"取消"与"写完读回来对不上"。 */
const bench = vi.hoisted(() => ({
  saveResult: { canceled: true, filePath: undefined as string | undefined },
  saveCalls: [] as Array<Record<string, unknown>>,
  publish: undefined as undefined | ((...args: unknown[]) => Promise<boolean>)
}))

vi.mock('electron', () => ({
  app: { getPath: () => ROOT },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {
    showSaveDialog: async (options: Record<string, unknown>) => {
      bench.saveCalls.push(options)
      return bench.saveResult
    }
  }
}))

vi.mock('../atomic-output', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../atomic-output')>()
  return {
    ...actual,
    publishOutput: (...args: unknown[]) => bench.publish!(...args)
  }
})

import { exportChapterTranslation } from '../chapter-translation-export'
import { fingerprintChapterTranslationFile } from '../chapter-translation-write'
import { parseLabelPlusTextWithSpans } from '../labelplus-parser'
import {
  buildEmptyChapterTranslationText,
  type ChapterTranslationExportRequest
} from '@shared/chapter-translation'

const CHAPTER_DIR = join(ROOT, 'chapter')
const TXT_PATH = join(CHAPTER_DIR, '译文.txt')
const OUT_DIR = join(ROOT, 'out')
const OUT_PATH = join(OUT_DIR, '另存.txt')

const LINES = [
  '1,0', //  1
  '-', //  2
  '框内', //  3
  '框外', //  4
  '-', //  5
  '翻译：某人', //  6  ← parser 不解析的名字，另存必须原样留着
  '校对：另一位', //  7
  '', //  8
  '', //  9
  '>>>>>>>>[01.png]<<<<<<<<', // 10
  '----------------[1]----------------[0.4950,0.6920,1]', // 11
  '第一句', // 12
  '第二行', // 13
  '', // 14
  '>>>>>>>>[02.png]<<<<<<<<', // 15
  '----------------[1]----------------[0.8330,0.6410,2]', // 16
  '另一句', // 17
  '' // 18  ← 末尾换行
]
/** 真实文件是 **UTF-8 带 BOM + 纯 LF**（见 P2 方案 §2 的实测）。 */
const CONTENT = `\uFEFF${LINES.join('\n')}`

function request(
  partial: Partial<ChapterTranslationExportRequest> = {}
): ChapterTranslationExportRequest {
  return {
    sourcePath: TXT_PATH,
    edits: [],
    defaultFileName: '译文-另存-20261006-2130.txt',
    defaultDirectory: CHAPTER_DIR,
    pages: [],
    ...partial
  }
}

async function sourceFingerprint(): Promise<string> {
  const info = await fingerprintChapterTranslationFile(TXT_PATH)
  return `${info.sha256}|${info.size}|${info.mtimeMs}`
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('../atomic-output')>('../atomic-output')
  bench.publish = actual.publishOutput as unknown as (...args: unknown[]) => Promise<boolean>
  bench.saveResult = { canceled: true, filePath: undefined }
  bench.saveCalls = []
  await rm(ROOT, { recursive: true, force: true })
  await mkdir(CHAPTER_DIR, { recursive: true })
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(TXT_PATH, Buffer.from(CONTENT, 'utf8'))
})

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true })
})

describe('第3批 · 没有待写改动 ⇒ 按字节复制', () => {
  it('另存出来的与原件**逐字节相同**（连 BOM 都在），而原件**一个字节都没动**', async () => {
    const before = await sourceFingerprint()
    bench.saveResult = { canceled: false, filePath: OUT_PATH }

    const result = await exportChapterTranslation(request())
    expect(result).toMatchObject({ ok: true, path: OUT_PATH, generated: false })

    const source = await readFile(TXT_PATH)
    const target = await readFile(OUT_PATH)
    expect(target.equals(source)).toBe(true)
    expect(target[0]).toBe(0xef) // BOM 的第一个字节
    if (result.ok) expect(result.bytes).toBe(source.length)

    // ⚠️ 这一条是整批的底线：另存**不是**保存
    expect(await sourceFingerprint()).toBe(before)
  })

  it('默认路径 = 话目录 + 渲染层给的默认名（`defaultPath` 就地断言）', async () => {
    bench.saveResult = { canceled: true, filePath: undefined }
    await exportChapterTranslation(request({ defaultDirectory: 'D:\\漫画\\第1話' }))
    const options = bench.saveCalls.at(-1)
    // 目录与名字由主进程用 node:path 拼（渲染层只给"一段名字"）
    expect(String(options?.defaultPath).replace(/\\/g, '/')).toBe(
      'D:/漫画/第1話/译文-另存-20261006-2130.txt'
    )
    expect(options?.title).toBe('另存译文')
  })

  it('用户取消 ⇒ `canceled` + **空 message**，而且一个文件都没产生', async () => {
    bench.saveResult = { canceled: true, filePath: undefined }
    const result = await exportChapterTranslation(request())
    expect(result).toEqual({ ok: false, kind: 'canceled', message: '' })
    expect(existsSync(OUT_PATH)).toBe(false)
  })
})

describe('第3批 · 有待写改动 ⇒ 原地改行（只动那几行）', () => {
  it('改一条文本 ⇒ 只有那几行变，`翻译：`/`校对：` 与其它条目逐字不变', async () => {
    const before = await sourceFingerprint()
    bench.saveResult = { canceled: false, filePath: OUT_PATH }

    const result = await exportChapterTranslation(
      request({
        edits: [{ imageName: '01.png', labelIndex: 1, text: '改过的第一句' }]
      })
    )
    expect(result.ok).toBe(true)

    // **整份逐字断言**：只有第 12、13 行那两行（原本是两句译文）被换成一句，其余一行不变。
    // （逐行按下标比会假红：条目从两行变一行之后，后面的行号整体前移。）
    const expected = [...LINES.slice(0, 11), '改过的第一句', ...LINES.slice(13)].join('\n')
    expect(await readFile(OUT_PATH, 'utf8')).toBe(`\uFEFF${expected}`)

    const lines = expected.split('\n')
    expect(lines[5]).toBe('翻译：某人') // credits 一行都没动
    expect(lines[6]).toBe('校对：另一位')
    // 被"少掉"的是原来那两行（替换，不是追加）
    expect(lines).not.toContain('第一句')
    expect(lines).not.toContain('第二行')

    expect(await sourceFingerprint()).toBe(before)
  })

  it('换行风格与 BOM 都跟着**原件**走（CRLF 的文件另存出来还是 CRLF）', async () => {
    const crlfPath = join(CHAPTER_DIR, 'crlf.txt')
    await writeFile(crlfPath, Buffer.from(LINES.join('\r\n'), 'utf8'))
    bench.saveResult = { canceled: false, filePath: OUT_PATH }

    await exportChapterTranslation(
      request({
        sourcePath: crlfPath,
        edits: [{ imageName: '02.png', labelIndex: 1, text: '改了' }]
      })
    )
    const target = await readFile(OUT_PATH, 'utf8')
    expect(target.startsWith('\uFEFF')).toBe(false) // 原件没有 BOM，另存也不能凭空造一个
    expect(target.includes('\r\n')).toBe(true)
    expect(target.includes('>>>>>>>>[02.png]<<<<<<<<\r\n----------------[1]')).toBe(true)
  })

  it('待写的改动指向**不存在**的条目 ⇒ 整份拒绝，**连对话框都不弹**（不静默少一条）', async () => {
    bench.saveResult = { canceled: false, filePath: OUT_PATH }
    const result = await exportChapterTranslation(
      request({ edits: [{ imageName: '99.png', labelIndex: 1, text: '没这一条' }] })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('invalid')
      expect(result.message).toContain('99.png')
    }
    expect(bench.saveCalls).toHaveLength(0)
    expect(existsSync(OUT_PATH)).toBe(false)
  })
})

describe('第3批 · 一条硬安全线：不许另存到原件本身', () => {
  it('目标就是原件 ⇒ 拒绝写入、原件未变（要写回原件请用「保存」）', async () => {
    const before = await sourceFingerprint()
    bench.saveResult = { canceled: false, filePath: TXT_PATH }

    const result = await exportChapterTranslation(
      request({ edits: [{ imageName: '01.png', labelIndex: 1, text: '想偷偷写回原件' }] })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('invalid')
      expect(result.message).toContain('保存')
    }
    expect(await sourceFingerprint()).toBe(before)
    expect(await readFile(TXT_PATH, 'utf8')).toContain('第一句')
  })

  it('大小写 / 斜杠写法不同但同一个文件 ⇒ 一样拦住', async () => {
    bench.saveResult = { canceled: false, filePath: TXT_PATH.replace(/\\/g, '/').toUpperCase() }
    const result = await exportChapterTranslation(request())
    // Windows 上那条路径指的还是同一个文件 ⇒ 必须拦住（这不是"文件不存在"那种失败）
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('invalid')
  })
})

describe('第3批 · 这一话没有可解析的 txt ⇒ 从零生成一份空底稿', () => {
  it('生成的文件**能被自己的解析器读回来**：N 张图、0 条标签', async () => {
    bench.saveResult = { canceled: false, filePath: OUT_PATH }
    const result = await exportChapterTranslation(
      request({ sourcePath: null, pages: ['01.png', '02.png', '03.png'] })
    )
    expect(result).toMatchObject({ ok: true, generated: true })

    const text = await readFile(OUT_PATH, 'utf8')
    expect(text).toBe(buildEmptyChapterTranslationText(['01.png', '02.png', '03.png']))
    const parsed = parseLabelPlusTextWithSpans(text, OUT_PATH)
    expect(parsed.document.images.map((image) => image.fileName)).toEqual([
      '01.png',
      '02.png',
      '03.png'
    ])
    expect(parsed.document.images.every((image) => image.labels.length === 0)).toBe(true)
    expect(parsed.document.groups).toEqual(['默认'])
  })

  it('既没有 txt、也没有页面 ⇒ 一句人话（不是"另存成功但文件是空的"）', async () => {
    const result = await exportChapterTranslation(request({ sourcePath: null, pages: [] }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('invalid')
      expect(result.message).toContain('没有东西可以另存')
    }
    expect(existsSync(OUT_PATH)).toBe(false)
  })
})

describe('第3批 · 写完读回来不一致 ⇒ 如实报错（不假装成功）', () => {
  it('原子写"写歪了" ⇒ `io` 失败，且消息里带上路径', async () => {
    bench.saveResult = { canceled: false, filePath: OUT_PATH }
    bench.publish = async (path: unknown) => {
      await writeFile(String(path), Buffer.from('短一截的内容', 'utf8'))
      return true
    }
    const result = await exportChapterTranslation(request())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('io')
      expect(result.message).toContain(OUT_PATH)
    }
  })

  it('写不进去（目标目录不存在）⇒ `io` 失败，且不影响原件', async () => {
    const before = await sourceFingerprint()
    bench.saveResult = { canceled: false, filePath: join(ROOT, '没有这个目录', 'x.txt') }
    const result = await exportChapterTranslation(request())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('io')
    expect(await sourceFingerprint()).toBe(before)
  })
})

describe('第3批 · 顺带证明"这一批没有新增写话目录的路径"', () => {
  it('另存前后：话目录里的文件清单与那份 txt 的 mtime 都不变', async () => {
    const { readdir } = await import('node:fs/promises')
    const beforeNames = (await readdir(CHAPTER_DIR)).sort()
    const beforeStat = await stat(TXT_PATH)
    bench.saveResult = { canceled: false, filePath: OUT_PATH }

    await exportChapterTranslation(
      request({ edits: [{ imageName: '01.png', labelIndex: 1, text: '改了' }] })
    )

    expect((await readdir(CHAPTER_DIR)).sort()).toEqual(beforeNames)
    expect((await stat(TXT_PATH)).mtimeMs).toBe(beforeStat.mtimeMs)
  })
})
