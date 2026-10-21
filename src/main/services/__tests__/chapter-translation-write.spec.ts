// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * 写回服务（P2-a）：备份 / 冲突 / 原子写 / 写后回读。
 *
 * 这一层是**第一次动用户话目录里的文件**，所以用例盯的是"出事时守不守得住"：
 * · 拒绝写入时**一个字节都不许变**（连备份都不该产生）；
 * · 冲突时**绝不静默覆盖**别人的改动；
 * · 每次真的写盘之前**必有一份备份**，且备份就是"写之前的那份"；
 * · 写完**读回来对不上就如实报错**（不假装成功）。
 *
 * fixture 目录在仓库 `.omo/fixtures` 下（与 db-backup 同一套做法；`.omo` 不进发布）。
 */

const ROOT = resolve(__dirname, '../../../../.omo/fixtures/chapter-translation-write')

vi.mock('electron', () => ({
  app: { getPath: () => ROOT }
}))

import {
  TRANSLATION_BACKUP_KEEP,
  createChapterTranslation,
  deleteChapterTranslation,
  fingerprintChapterTranslationFile,
  insertChapterTranslation,
  saveChapterTranslation,
  sessionTranslationBaselines,
  translationBackupsDirectory,
  undoChapterTranslation
} from '../chapter-translation-write'
import { parseLabelPlusContent } from '../labelplus-parser'
import { closeDatabase } from '../database'
import {
  listTranslationReviews,
  renumberTranslationReviews,
  saveTranslationReview
} from '../db/translation-review-store'
import type { ChapterTranslationFingerprint } from '@shared/chapter-translation'

const CHAPTER_DIR = join(ROOT, 'chapter')
const TXT_PATH = join(CHAPTER_DIR, 'sample.txt')
/**
 * 校对记录那条端到端锁专用的话目录。
 * ⚠️ 不能拿 `CHAPTER_DIR` 当真话目录：库是**跨 spec 共用**的，用同一个话目录会让
 * "还剩几条"跟着别的用例的执行顺序变（那种用例改天必假红 —— 本文件既有注释记过这条）。
 */
const DIR_FOR_REVIEWS = 'D:\\漫画\\5e-删除服务专用'

const LINES = [
  '1,0', //  1
  '-', //  2
  '框内', //  3
  '框外', //  4
  '-', //  5
  '翻译：某人', //  6  ← 回写要原样留着
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
const CONTENT = LINES.join('\n')

async function readFingerprint(): Promise<ChapterTranslationFingerprint> {
  return fingerprintChapterTranslationFile(TXT_PATH)
}

async function listBackups(): Promise<string[]> {
  try {
    return (await readdir(translationBackupsDirectory())).sort()
  } catch {
    return []
  }
}

async function writeChapterFile(text: string): Promise<void> {
  await writeFile(TXT_PATH, text, 'utf8')
}

function editText(imageName: string, labelIndex: number, text: string) {
  return { imageName, labelIndex, text }
}

beforeEach(async () => {
  // ⚠️ 本文件里有"记录跟着挪"那条用例会打开库 ⇒ 每次重建 fixture 之前**先关库**，
  //    否则 sqlite 的 -wal/-shm 句柄会把 fixture 目录锁住、`rm -rf` 直接 EBUSY。
  await closeDatabase()
  await rm(ROOT, { recursive: true, force: true })
  await mkdir(CHAPTER_DIR, { recursive: true })
  await writeChapterFile(CONTENT)
})

afterAll(async () => {
  // ⚠️ 本文件新增了"记录跟着挪"那条锁之后会打开库 ⇒ 收尾必须**先关库**，
  //    否则全局 fixture 目录被 sqlite 句柄锁住、`rm -rf` 直接 EBUSY。
  await closeDatabase()
  await rm(ROOT, { recursive: true, force: true })
})

describe('写回服务 · 正常路径', () => {
  it('改一条 → 文件真的变了、返回新指纹、且写前备了一份（备份=改之前那份）', async () => {
    const base = await readFingerprint()
    const result = await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('01.png', 1, '改过的甲\n改过的乙')]
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.changed).toBe(true)
    expect(result.backupPath).toBeTruthy()

    const after = await readFile(TXT_PATH, 'utf8')
    expect(after.split('\n').slice(11, 13)).toEqual(['改过的甲', '改过的乙'])
    // 除目标行，其余逐字节相同
    expect(after.split('\n').slice(0, 11)).toEqual(CONTENT.split('\n').slice(0, 11))
    expect(after.split('\n').slice(13)).toEqual(CONTENT.split('\n').slice(13))

    // 备份就是"写之前的那份"
    expect(await readFile(result.backupPath as string, 'utf8')).toBe(CONTENT)

    // 返回的指纹与盘上一致（界面据此更新基指纹，连着改第二条不会误判冲突）
    expect(result.fingerprint.sha256).toBe((await readFingerprint()).sha256)
    expect(result.fingerprint.sha256).not.toBe(base.sha256)
  })

  it('内容没变 ⇒ 跳过写入（changed:false），不产生备份、不动 mtime', async () => {
    const base = await readFingerprint()
    const before = (await stat(TXT_PATH)).mtimeMs

    const result = await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('01.png', 1, '第一句\n第二行')]
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.changed).toBe(false)
    expect(result.backupPath).toBeNull()
    expect((await stat(TXT_PATH)).mtimeMs).toBe(before)
    expect(await listBackups()).toEqual([])
  })
})

describe('写回服务 · 拒绝路径（一个字节都不许变）', () => {
  it('找不到那条 ⇒ invalid，文件没被碰、也没有备份', async () => {
    const base = await readFingerprint()

    const result = await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('09.png', 3, '甲')]
    })

    expect(result).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await readFile(TXT_PATH, 'utf8')).toBe(CONTENT)
    expect(await readFingerprint()).toEqual(base)
    expect(await listBackups()).toEqual([])
  })

  it('冲突：文件在读完之后被别处改过 ⇒ 拒绝写入，**别人的改动原样留着**', async () => {
    const base = await readFingerprint()
    const othersVersion = CONTENT.replace('第一句', '别处改过的第一句')
    await writeChapterFile(othersVersion)

    const result = await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('01.png', 1, '我改的')]
    })

    expect(result).toMatchObject({ ok: false, kind: 'conflict' })
    if (result.ok) throw new Error('不该成功')
    expect(result.message).toContain('被改过')
    // 关键：**没有覆盖**
    expect(await readFile(TXT_PATH, 'utf8')).toBe(othersVersion)
    expect(result.current?.sha256).toBe((await readFingerprint()).sha256)
    expect(await listBackups()).toEqual([])
  })

  it('冲突 + 用户明确选"强制覆盖" ⇒ 才允许写入', async () => {
    const base = await readFingerprint()
    await writeChapterFile(CONTENT.replace('第一句', '别处改过的第一句'))

    const result = await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('01.png', 1, '我改的')],
      force: true
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect((await readFile(TXT_PATH, 'utf8')).split('\n')[11]).toBe('我改的')
    // 备份里是"被覆盖掉的那份"（别处的改动仍能找回）
    expect(await readFile(result.backupPath as string, 'utf8')).toContain('别处改过的第一句')
  })

  it('文件不存在 ⇒ io 错误，人话，不抛', async () => {
    const base = await readFingerprint()
    await rm(TXT_PATH)

    const result = await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('01.png', 1, '甲')]
    })

    expect(result).toMatchObject({ ok: false, kind: 'io' })
  })
})

describe('写回服务 · 备份保留策略', () => {
  it(`最多留最近 ${TRANSLATION_BACKUP_KEEP} 份`, async () => {
    const rounds = TRANSLATION_BACKUP_KEEP + 2
    for (let index = 0; index < rounds; index += 1) {
      const base = await readFingerprint()
      const result = await saveChapterTranslation({
        filePath: TXT_PATH,
        base,
        // 每次都换一个值，保证真的写盘（否则会被 changed:false 跳过）
        edits: [editText('01.png', 1, `第 ${index} 轮`)]
      })
      expect(result.ok).toBe(true)
    }

    const backups = await listBackups()
    expect(backups).toHaveLength(TRANSLATION_BACKUP_KEEP)
    // 留下的必须是**最近**的那些：最新一轮的备份内容是倒数第二轮写的值
    const newest = await readFile(
      join(translationBackupsDirectory(), backups[backups.length - 1]),
      'utf8'
    )
    expect(newest).toContain(`第 ${rounds - 2} 轮`)
  })

  it('备份目录在数据库备份的**子目录**里（不混进那份列表），且话名进了文件名', async () => {
    const base = await readFingerprint()
    const result = await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('01.png', 1, '甲')]
    })
    if (!result.ok) throw new Error(result.message)

    expect(translationBackupsDirectory()).toBe(join(ROOT, 'backups', 'translation'))
    expect(result.backupPath?.startsWith(translationBackupsDirectory())).toBe(true)
    expect(result.backupPath).toContain('sample')
    expect(result.backupPath?.endsWith('.txt')).toBe(true)
  })
})

/**
 * 「回退最近一次保存」（2026-10-07）—— 依据是**会话内的内存堆栈**，不是磁盘上那串备份。
 *
 * 为什么不能读磁盘备份：备份只留最近 {@link TRANSLATION_BACKUP_KEEP} 份、且跨话共享，
 * 而译文是"失焦即存"，一次会话轻松超过 20 次保存 ⇒ 本会话最早那份备份会被 prune 删掉，
 * "本会话的基线"就找不回来了。内存堆栈天然"限本会话"（进程退出即空）。
 *
 * 数据层是**栈**（每次保存压一层），当前界面只暴露"退一步" ——
 * 将来放开多步只改界面与热键，这一层一个字都不用动。
 */
describe('写回服务 · 回退最近一次保存（会话内一步）', () => {
  beforeEach(() => {
    // 每条用例都从"全新会话"开始（内存表清空 = 进程重启之后的样子）
    sessionTranslationBaselines.clear()
  })

  it('保存一次后回退 ⇒ 文件回到保存前那一版（逐字节），并留一份"回退前"的返程票', async () => {
    const base = await readFingerprint()
    await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('01.png', 1, '改过的甲\n改过的乙')]
    })
    const afterSave = await readFingerprint()

    const result = await undoChapterTranslation({ filePath: TXT_PATH, base: afterSave })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.changed).toBe(true)
    // 回到保存前那一版，**逐字节**
    expect(await readFile(TXT_PATH, 'utf8')).toBe(CONTENT)
    // 返程票 = 回退**前**那一份（万一点错了还能回去）
    expect(result.backupPath).toBeTruthy()
    expect(await readFile(result.backupPath as string, 'utf8')).toContain('改过的甲')
    expect(result.fingerprint.sha256).toBe((await readFingerprint()).sha256)
  })

  it('锁4 · 指纹对不上 ⇒ 拒绝、不写盘、说人话（别人的改动原样留着）', async () => {
    const base = await readFingerprint()
    const saved = await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('01.png', 1, '我改的')]
    })
    if (!saved.ok) throw new Error(saved.message)

    // 界面手上这份（保存后重读得到）
    const stale = await readFingerprint()
    // 别处（LabelPlusFX）在界面读完之后又动了一次
    const others = (await readFile(TXT_PATH, 'utf8')).replace('我改的', '别处又改的')
    await writeChapterFile(others)

    const result = await undoChapterTranslation({ filePath: TXT_PATH, base: stale })

    expect(result).toMatchObject({ ok: false, kind: 'conflict' })
    if (result.ok) throw new Error('不该成功')
    expect(result.message).toContain('被改过')
    // 关键：**没有覆盖**别人的改动
    expect(await readFile(TXT_PATH, 'utf8')).toBe(others)
    expect(result.current?.sha256).toBe((await readFingerprint()).sha256)
  })

  it('本会话没保存过 ⇒ 说人话，不写盘、也不留备份', async () => {
    const base = await readFingerprint()

    const result = await undoChapterTranslation({ filePath: TXT_PATH, base })

    expect(result).toMatchObject({ ok: false, kind: 'invalid' })
    if (result.ok) throw new Error('不该成功')
    expect(result.message).toContain('没有可回退')
    expect(await readFile(TXT_PATH, 'utf8')).toBe(CONTENT)
    expect(await listBackups()).toEqual([])
  })

  it('锁6 · **重启后不认上一会话的备份**（依据是内存表，不是磁盘上那份备份）', async () => {
    const base = await readFingerprint()
    await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('01.png', 1, '会话一改的')]
    })

    // 磁盘上**确实**留了备份 —— 证明"不认"不是因为没得认
    expect(await listBackups()).not.toEqual([])
    const onDisk = await readFile(TXT_PATH, 'utf8')

    // 模拟重启：进程内存没了
    sessionTranslationBaselines.clear()

    const result = await undoChapterTranslation({
      filePath: TXT_PATH,
      base: await readFingerprint()
    })

    expect(result).toMatchObject({ ok: false, kind: 'invalid' })
    // 磁盘上那份备份**没有被当成基线拿来覆盖**：文件一字未动
    expect(await readFile(TXT_PATH, 'utf8')).toBe(onDisk)
  })

  it('内存表是"每次保存前原文"的**栈**：退一步回到上一次保存前，再退一步回到更早', async () => {
    const first = await readFingerprint()
    await saveChapterTranslation({
      filePath: TXT_PATH,
      base: first,
      edits: [editText('01.png', 1, '第一轮')]
    })
    const afterFirst = await readFile(TXT_PATH, 'utf8')

    const second = await readFingerprint()
    await saveChapterTranslation({
      filePath: TXT_PATH,
      base: second,
      edits: [editText('01.png', 1, '第二轮')]
    })

    // 退一步 = 回到"第二次保存前" = 第一次保存之后的样子
    const step1 = await undoChapterTranslation({
      filePath: TXT_PATH,
      base: await readFingerprint()
    })
    expect(step1.ok).toBe(true)
    expect(await readFile(TXT_PATH, 'utf8')).toBe(afterFirst)

    // 再退一步 = 回到最初（数据层是栈，界面每按一次 Ctrl+Z 走一步）
    const step2 = await undoChapterTranslation({
      filePath: TXT_PATH,
      base: await readFingerprint()
    })
    expect(step2.ok).toBe(true)
    expect(await readFile(TXT_PATH, 'utf8')).toBe(CONTENT)

    // 退到空 ⇒ 明确回"没有可回退的"（**不静默**），文件也不再动
    const step3 = await undoChapterTranslation({
      filePath: TXT_PATH,
      base: await readFingerprint()
    })
    expect(step3).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await readFile(TXT_PATH, 'utf8')).toBe(CONTENT)
  })

  it('换话 ⇒ **上一话的会话历史整份丢掉**（不许跨话退）', async () => {
    // 会话一：在这份 txt 上保存过（历史里有它）
    const base = await readFingerprint()
    await saveChapterTranslation({
      filePath: TXT_PATH,
      base,
      edits: [editText('01.png', 1, '第一话改的')]
    })
    expect(sessionTranslationBaselines.size).toBe(1)

    // 换到另一话（另一份 txt）
    const otherPath = join(CHAPTER_DIR, 'other.txt')
    await writeFile(otherPath, CONTENT, 'utf8')
    const otherBase = await fingerprintChapterTranslationFile(otherPath)

    // 在新话上按 Ctrl+Z ⇒ 不许退到上一话那一层
    const result = await undoChapterTranslation({ filePath: otherPath, base: otherBase })
    expect(result).toMatchObject({ ok: false, kind: 'invalid' })

    // 上一话的历史已被丢掉（"换话 ⇒ 堆栈清空"）
    expect(sessionTranslationBaselines.size).toBe(0)
    expect(await readFile(TXT_PATH, 'utf8')).toContain('第一话改的')
  })
})

/**
 * 「新增框」的两条写盘路径（第 5 批，2026-10-07）。
 *
 * · **有 txt** ⇒ 插进现有那份（与「保存」共用同一段安全网 ⇒ 自动能 Ctrl+Z 撤回）；
 * · **没有 txt** ⇒ 在话目录新建一份（**绝不覆盖**、同名加 `-2`…、名字要洗、试到 `-10` 就停）。
 */
describe('写回服务 · 新增框（插入 / 从零新建）', () => {
  const FRESH_DIR = join(ROOT, 'fresh')
  const PAGES = ['20.jpg', '21.jpg']

  beforeEach(async () => {
    sessionTranslationBaselines.clear()
    await rm(FRESH_DIR, { recursive: true, force: true })
    await mkdir(FRESH_DIR, { recursive: true })
  })

  function insertRequest(
    overrides?: Partial<{
      imageName: string
      groupName: string
      position: { x: number; y: number }
      text: string
    }>
  ) {
    return {
      imageName: '01.png',
      groupName: '框内',
      position: { x: 0.5, y: 0.5 },
      text: '新增的一句',
      ...overrides
    }
  }

  it('插入：文件多了那一条、返回新序号（该图末尾 +1）、写前有备份、写后指纹与盘上一致', async () => {
    const base = await readFingerprint()

    const result = await insertChapterTranslation({
      filePath: TXT_PATH,
      base,
      insert: insertRequest()
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.changed).toBe(true)
    expect(result.insertedIndex).toBe(2) // 这份 fixture 里 01.png 已有 1 条
    expect(result.backupPath).toBeTruthy()
    expect(await readFile(result.backupPath as string, 'utf8')).toBe(CONTENT)
    expect(result.fingerprint.sha256).toBe((await readFingerprint()).sha256)

    const document = parseLabelPlusContent(await readFile(TXT_PATH, 'utf8'))
    const image = document.images.find((item) => item.fileName === '01.png')
    expect(image?.labels.map((label) => [label.index, label.text])).toEqual([
      [1, '第一句\n第二行'],
      [2, '新增的一句']
    ])
  })

  it('插入撞上冲突（读完之后被别处改过）⇒ 拒绝写入，**别人的改动原样留着**', async () => {
    const base = await readFingerprint()
    const others = CONTENT.replace('第一句', '别处改过的第一句')
    await writeChapterFile(others)

    const result = await insertChapterTranslation({
      filePath: TXT_PATH,
      base,
      insert: insertRequest()
    })

    expect(result).toMatchObject({ ok: false, kind: 'conflict' })
    expect(await readFile(TXT_PATH, 'utf8')).toBe(others)
  })

  it('creates a credits-only TXT with no fabricated translation anchors', async () => {
    const credits = {source:'秦爷', translator:'译者', proofreader:'校对', typesetter:'我', supervisor:'', combined:false, initialized:true}
    const result = await createChapterTranslation({folderPath:FRESH_DIR,pages:PAGES,credits})
    if (!result.ok) throw new Error(result.message)
    const document = parseLabelPlusContent(await readFile(result.path, 'utf8'))
    expect(document.credits).toEqual(credits)
    expect(document.images.map(page=>page.fileName)).toEqual(PAGES)
    expect(document.images.every(page=>page.labels.length===0)).toBe(true)
  })

  it('从零新建：落到**话目录**、名字是 `{话文件夹名}.txt`，且能被自己的解析器读回', async () => {
    const result = await createChapterTranslation({
      folderPath: FRESH_DIR,
      pages: PAGES,
      insert: insertRequest({
        imageName: '20.jpg',
        groupName: '框外',
        position: { x: 0.25, y: 0.75 },
        text: '第一句'
      })
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.fileName).toBe('fresh.txt')
    expect(result.path).toBe(join(FRESH_DIR, 'fresh.txt'))
    expect(result.insertedIndex).toBe(1)
    expect(await readdir(FRESH_DIR)).toEqual(['fresh.txt'])

    const document = parseLabelPlusContent(await readFile(result.path, 'utf8'))
    expect(document.groups).toEqual(['框内', '框外'])
    expect(document.images.map((item) => item.fileName)).toEqual(PAGES)
    expect(document.images.find((item) => item.fileName === '20.jpg')?.labels[0]).toMatchObject({
      index: 1,
      group: '框外',
      text: '第一句'
    })
  })

  it('**绝不覆盖**：同名已在 ⇒ 落到 `-2`，而且老那份**一字未变**', async () => {
    const first = await createChapterTranslation({
      folderPath: FRESH_DIR,
      pages: PAGES,
      insert: insertRequest({ imageName: '20.jpg' })
    })
    if (!first.ok) throw new Error(first.message)
    const before = await readFile(first.path, 'utf8')

    const second = await createChapterTranslation({
      folderPath: FRESH_DIR,
      pages: PAGES,
      insert: insertRequest({ imageName: '21.jpg', groupName: '框外' })
    })
    if (!second.ok) throw new Error(second.message)

    expect(second.fileName).toBe('fresh-2.txt')
    expect(await readFile(first.path, 'utf8')).toBe(before)
    expect((await readdir(FRESH_DIR)).sort()).toEqual(['fresh-2.txt', 'fresh.txt'])
  })

  it('同名一路占到 `-10` ⇒ 明确拒绝（人话），不再无限试名字', async () => {
    for (let index = 0; index < 10; index += 1) {
      const name = index === 0 ? 'fresh.txt' : `fresh-${index + 1}.txt`
      await writeFile(join(FRESH_DIR, name), CONTENT, 'utf8')
    }

    const result = await createChapterTranslation({
      folderPath: FRESH_DIR,
      pages: PAGES,
      insert: insertRequest({ imageName: '20.jpg' })
    })

    expect(result).toMatchObject({ ok: false, kind: 'invalid' })
    if (result.ok) throw new Error('不该成功')
    expect(result.message).toContain('同名')
    expect(await readdir(FRESH_DIR)).toHaveLength(10)
  })

  it('**有 txt 的插入也能 Ctrl+Z 撤回**（退回去的内容就是插入前那份）', async () => {
    const base = await readFingerprint()
    await insertChapterTranslation({ filePath: TXT_PATH, base, insert: insertRequest() })
    const afterInsert = await readFingerprint()

    const undone = await undoChapterTranslation({ filePath: TXT_PATH, base: afterInsert })

    expect(undone.ok).toBe(true)
    expect(await readFile(TXT_PATH, 'utf8')).toBe(CONTENT)
  })

  it('**从零新建也能 Ctrl+Z 撤回**：`deleted:true` + 刚建的那份真的没了', async () => {
    const created = await createChapterTranslation({
      folderPath: FRESH_DIR,
      pages: PAGES,
      insert: insertRequest({ imageName: '20.jpg' })
    })
    if (!created.ok) throw new Error(created.message)

    const undone = await undoChapterTranslation({
      filePath: created.path,
      base: created.fingerprint
    })

    expect(undone).toMatchObject({ ok: true, changed: true, deleted: true })
    expect(await readdir(FRESH_DIR)).toEqual([])
  })
})

/**
 * 「**删除一条译文**」（第 5 批 5e，2026-10-07）—— 写盘那一半。
 *
 * 这一层盯的是"出事时守不守得住"，与保存 / 新增同一套尺子：
 * · 删完之后**文件其余字节逐字节不变**（这条 fixture 的承重墙）；
 * · 撞上冲突 ⇒ **一个字节都不写**，别人的改动原样留着；
 * · 删完 **Ctrl+Z 能撤回**（会话基线已经压了一层）—— 这是用户拍板的"不加二次确认"的兜底；
 * · **写盘失败时库里的记录一条都不动**（顺序：先 txt、后记录）。
 */
describe('写回服务 · 删除一条译文（5e）', () => {
  beforeEach(() => {
    // fixture 由文件顶部的全局 `beforeEach` 装好（这里只清会话栈）
    sessionTranslationBaselines.clear()
  })

  it('删掉第 1 条：文件里那一条没了、**其余字节逐字节不变**、写前有备份、写后指纹一致', async () => {
    const base = await readFingerprint()

    const result = await deleteChapterTranslation({
      filePath: TXT_PATH,
      base,
      delete: { imageName: '01.png', labelIndex: 1 }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.changed).toBe(true)
    expect(result.deletedIndex).toBe(1)
    expect(result.backupPath).toBeTruthy()
    // 写前备份 = **删之前**那份
    expect(await readFile(result.backupPath as string, 'utf8')).toBe(CONTENT)
    expect(result.fingerprint.sha256).toBe((await readFingerprint()).sha256)

    const after = await readFile(TXT_PATH, 'utf8')
    // 其余字节逐字节不变：只在原文件基础上少了"那一条占的那三行"
    expect(after).toBe(LINES.filter((_, index) => !(index >= 10 && index <= 12)).join('\n'))
    // 头部 credits / 别的图 / 条目间空行照旧
    expect(after).toContain('翻译：某人')
    expect(after).toContain('>>>>>>>>[02.png]<<<<<<<<')
    expect(after).toContain('另一句')

    const document = parseLabelPlusContent(after)
    const image = document.images.find((item) => item.fileName === '01.png')
    expect(image?.labels).toEqual([])
  })

  it('删完 **Ctrl+Z 能撤回**（会话基线压了一层，回退后与原文一字不差）', async () => {
    const base = await readFingerprint()
    const removed = await deleteChapterTranslation({
      filePath: TXT_PATH,
      base,
      delete: { imageName: '02.png', labelIndex: 1 }
    })
    expect(removed.ok).toBe(true)
    if (!removed.ok) throw new Error(removed.message)

    // 会话栈里应当有一层"删之前那份"
    expect(sessionTranslationBaselines.get(TXT_PATH)?.length).toBe(1)

    const undone = await undoChapterTranslation({
      filePath: TXT_PATH,
      base: {
        size: removed.fingerprint.size,
        mtimeMs: removed.fingerprint.mtimeMs,
        sha256: removed.fingerprint.sha256
      }
    })
    expect(undone.ok).toBe(true)
    expect(await readFile(TXT_PATH, 'utf8')).toBe(CONTENT)
  })

  it('删除撞上冲突（读完之后被别处改过）⇒ 拒绝，**别人的改动原样留着**、一条都不写', async () => {
    const base = await readFingerprint()
    const others = CONTENT.replace('第一句', '别处改过的第一句')
    await writeChapterFile(others)

    const result = await deleteChapterTranslation({
      filePath: TXT_PATH,
      base,
      delete: { imageName: '01.png', labelIndex: 1 }
    })

    expect(result).toMatchObject({ ok: false, kind: 'conflict' })
    expect(await readFile(TXT_PATH, 'utf8')).toBe(others)
  })

  it('这一话里没有那一条 ⇒ 拒绝（`invalid`），**一个字节都不写**', async () => {
    const base = await readFingerprint()
    const result = await deleteChapterTranslation({
      filePath: TXT_PATH,
      base,
      delete: { imageName: '01.png', labelIndex: 9 }
    })

    expect(result).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await readFile(TXT_PATH, 'utf8')).toBe(CONTENT)
  })

  it('删完之后**校对记录跟着挪**（端到端：删第 1 条 ⇒ 原第 2 条的记录变成第 1 条）', async () => {
    // ⚠️ fixture 里 01.png 只有**一条**译文 ⇒ 删除它时 txt 那侧没有"后续条目要重排"，
    //    `renumbered` 是 `[]`（这是对的）。而库里那两条记录**照着迁移口径**走：
    //    第 1 条（被删的那条）连原文一起消失、第 2 条挪到 1。
    //    —— 用"记录里有、txt 里没有"的那一条来盯迁移口径，正好把两件事分开看。
    await saveTranslationReview({
      folderPath: DIR_FOR_REVIEWS,
      imageName: '01.png',
      labelIndex: 1,
      page: 1,
      originalText: '要被删掉的原文',
      reviewedText: '校文甲',
      reason: '',
      at: 1
    })
    await saveTranslationReview({
      folderPath: DIR_FOR_REVIEWS,
      imageName: '01.png',
      labelIndex: 2,
      page: 1,
      originalText: '跟着挪的原文',
      reviewedText: '校文乙',
      reason: '理由乙',
      at: 2
    })

    const base = await readFingerprint()
    const result = await deleteChapterTranslation({
      filePath: TXT_PATH,
      base,
      delete: { imageName: '01.png', labelIndex: 1 }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.renumbered).toEqual([])

    // 与生产同一条顺序：写盘成功之后由**调用方**把记录挪过去
    await renumberTranslationReviews(DIR_FOR_REVIEWS, '01.png', 1)

    const rows = await listTranslationReviews(DIR_FOR_REVIEWS)
    expect(rows.map((row) => row.labelIndex)).toEqual([1])
    expect(rows[0]).toMatchObject({
      originalText: '跟着挪的原文',
      reviewedText: '校文乙',
      reason: '理由乙'
    })
    expect(rows.some((row) => row.originalText === '要被删掉的原文')).toBe(false)
  })

  it('没指定文件 / 没指定删哪一条 ⇒ 拒绝', async () => {
    const base = await readFingerprint()
    expect(
      await deleteChapterTranslation({
        filePath: '',
        base,
        delete: { imageName: '01.png', labelIndex: 1 }
      })
    ).toMatchObject({ ok: false, kind: 'io' })
    expect(
      await deleteChapterTranslation({
        filePath: TXT_PATH,
        base,
        delete: { imageName: '   ', labelIndex: 1 }
      })
    ).toMatchObject({ ok: false, kind: 'invalid' })
  })
})

it('saves credits without changing dialogue, shares one name, and rejects stale writes', async () => {
 const before = await readFile(TXT_PATH, 'utf8')
 const base = await fingerprintChapterTranslationFile(TXT_PATH)
 const credits = { translator: '同一位', proofreader: '忽略', combined: true }
 const result = await saveChapterTranslation({ filePath: TXT_PATH, base, edits: [], credits })
 expect(result.ok).toBe(true)
 const after = await readFile(TXT_PATH, 'utf8')
 expect(after.slice(after.indexOf('>>>>>>>>['))).toBe(before.slice(before.indexOf('>>>>>>>>[')))
 expect(parseLabelPlusContent(after, TXT_PATH).credits).toEqual({ translator: '同一位', proofreader: '同一位', combined: true })
 const conflict = await saveChapterTranslation({ filePath: TXT_PATH, base, edits: [], credits: { ...credits, translator: '其他人' } })
 expect(conflict.ok).toBe(false)
 expect(await readFile(TXT_PATH, 'utf8')).toBe(after)
})
