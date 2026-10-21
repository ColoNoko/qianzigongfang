import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHAPTER_TRANSLATION_MAX_ATTEMPTS } from '@shared/chapter-translation'
import { readChapterTranslation } from '../chapter-translation'

let work = ''

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'qianzi-chapter-translation-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

/** 一份最小的合法 LabelPlus 文本（两个分组 / 一张图 / 一条译文）。 */
function labelPlusText(imageName: string, text: string): string {
  return [
    '1,0',
    '-',
    '框内',
    '框外',
    '-',
    `>>>>>>[${imageName}]<<<<<<`,
    '------[1]------[0.5,0.5,1]',
    text,
    ''
  ].join('\n')
}

/** 写文件并把修改时间钉死，让"取最新"有确定的比较基准。 */
async function writeTxt(name: string, content: string, mtimeMs: number): Promise<string> {
  const path = join(work, name)
  await writeFile(path, content, 'utf8')
  const seconds = mtimeMs / 1000
  await utimes(path, seconds, seconds)
  return path
}

describe('读话目录里的 LabelPlus 译文', () => {
  it('目录里没有 txt ⇒ not-found，并如实报出 txt 数量 0', async () => {
    const result = await readChapterTranslation(work)
    expect(result.status).toBe('not-found')
    expect(result.file).toBeNull()
    expect(result.document).toBeNull()
    expect(result.txtCount).toBe(0)
    expect(result.message).toContain('没有 .txt')
  })

  it('只有普通 txt（不是 LabelPlus 文本）⇒ not-found，不抛异常', async () => {
    await writeTxt('原文.txt', '这只是普通文本\n没有图片标题行\n', 1_700_000_000_000)
    const result = await readChapterTranslation(work)
    expect(result.status).toBe('not-found')
    expect(result.txtCount).toBe(1)
    expect(result.file).toBeNull()
    expect(result.message).toContain('没有一份能当 LabelPlus 文本读')
  })

  it('有一份 LabelPlus txt ⇒ ok，解析出图片与条目', async () => {
    await writeTxt('20.txt', labelPlusText('20.jpg', '难道是我说错话了?'), 1_700_000_000_000)
    const result = await readChapterTranslation(work)
    expect(result.status).toBe('ok')
    expect(result.message).toBe('')
    expect(result.txtCount).toBe(1)
    expect(result.file?.name).toBe('20.txt')
    expect(result.document?.images).toHaveLength(1)
    expect(result.document?.images[0].labels[0].text).toBe('难道是我说错话了?')
  })

  it('多份 LabelPlus txt ⇒ 取修改时间最新的那一份', async () => {
    await writeTxt('old.txt', labelPlusText('20.jpg', '旧译文'), 1_700_000_000_000)
    await writeTxt('new.txt', labelPlusText('20.jpg', '新译文'), 1_700_000_500_000)
    const result = await readChapterTranslation(work)
    expect(result.status).toBe('ok')
    expect(result.file?.name).toBe('new.txt')
    expect(result.document?.images[0].labels[0].text).toBe('新译文')
  })

  it('最新的那份不是 LabelPlus、次新的才是 ⇒ 采用次新那份（取最新"能用"的）', async () => {
    await writeTxt('20.txt', labelPlusText('20.jpg', '正文译文'), 1_700_000_000_000)
    await writeTxt('说明.txt', '更新过的一条说明，但不是 LabelPlus 文本', 1_700_000_900_000)
    const result = await readChapterTranslation(work)
    expect(result.status).toBe('ok')
    expect(result.file?.name).toBe('20.txt')
    expect(result.document?.images[0].labels[0].text).toBe('正文译文')
  })

  it('尝试次数有上限：更旧那份能读也不越过上限去找', async () => {
    for (let index = 0; index < CHAPTER_TRANSLATION_MAX_ATTEMPTS; index += 1) {
      await writeTxt(`噪声${index}.txt`, `普通文本 ${index}`, 1_700_000_001_000 + index * 1_000)
    }
    // 这份是唯一能读的，但排在 MAX_ATTEMPTS 名之外
    await writeTxt('真译文.txt', labelPlusText('20.jpg', '排在很后面'), 1_700_000_000_000)
    const result = await readChapterTranslation(work)
    expect(result.status).toBe('not-found')
    expect(result.txtCount).toBe(CHAPTER_TRANSLATION_MAX_ATTEMPTS + 1)
  })

  it('目录不存在 ⇒ error + 人话，不抛', async () => {
    const result = await readChapterTranslation(join(work, '不存在的子目录'))
    expect(result.status).toBe('error')
    expect(result.file).toBeNull()
    expect(result.document).toBeNull()
    expect(result.message).toContain('读不了话目录')
  })

  it('空路径 ⇒ error，不去读当前工作目录', async () => {
    const result = await readChapterTranslation('   ')
    expect(result.status).toBe('error')
    expect(result.txtCount).toBe(0)
  })

  it('大小写扩展名一样认（.TXT）', async () => {
    await writeTxt('20.TXT', labelPlusText('20.jpg', '大写扩展名'), 1_700_000_000_000)
    const result = await readChapterTranslation(work)
    expect(result.status).toBe('ok')
    expect(result.file?.name).toBe('20.TXT')
  })

  it('只扫一层：子目录里的 txt 不算这一话的译文', async () => {
    await mkdir(join(work, 'backup'), { recursive: true })
    await writeFile(join(work, 'backup', '20.txt'), labelPlusText('20.jpg', '备份里的'), 'utf8')
    const result = await readChapterTranslation(work)
    expect(result.status).toBe('not-found')
    expect(result.txtCount).toBe(0)
  })
})
