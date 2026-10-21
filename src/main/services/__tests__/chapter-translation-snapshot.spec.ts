// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const race = vi.hoisted(() => ({ path: '', replacement: '', work: '' }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const result = await actual.readFile(...args)
      if (String(args[0]) === race.path) {
        race.path = ''
        // A real external save completes after this read captured its bytes.
        await actual.writeFile(String(args[0]), race.replacement, 'utf8')
      }
      return result
    }
  }
})
// Keep every backup in the temporary fixture; this test never uses app data.
vi.mock('../db-backup', () => ({
  backupsDirectory: () => join(race.work, 'backups'),
  stamp: (at: number) => String(at)
}))

import { readChapterTranslation } from '../chapter-translation'
import { readLabelPlusFileSnapshot } from '../labelplus-parser'
import { saveChapterTranslation } from '../chapter-translation-write'

const prefix = join(tmpdir(), 'qianzi-snapshot-test-')
const original = [
  '\uFEFF1,0', '-', '框内', '框外', '-', '图源：原图源', '翻译：原译者',
  '校对：原校对', '>>>>>>>>[001.jpg]<<<<<<<<',
  '----------------[1]----------------[0.5,0.5,1]', '原台词', ''
].join('\r\n')

beforeEach(async () => {
  race.work = await mkdtemp(prefix)
  race.path = ''
  race.replacement = ''
})

afterEach(async () => {
  race.path = ''
  if (!race.work.startsWith(prefix)) throw new Error('Unexpected fixture path')
  await rm(race.work, { recursive: true, force: true })
})

it('keeps parsed credits and SHA on one snapshot and rejects saving over a later external edit', async () => {
  const file = join(race.work, 'chapter.txt')
  await writeFile(file, original, 'utf8')
  const externallySaved = original.replace('翻译：原译者', '翻译：外部新译者')
  race.path = file
  race.replacement = externallySaved

  const loaded = await readChapterTranslation(race.work)
  expect(loaded.status).toBe('ok')
  expect(loaded.document?.credits?.translator).toBe('原译者')
  expect(loaded.file?.sha256).toBe(createHash('sha256').update(original, 'utf8').digest('hex'))
  expect(loaded.file?.size).toBe(Buffer.byteLength(original))
  expect(await readFile(file, 'utf8')).toBe(externallySaved)

  const saved = await saveChapterTranslation({
    filePath: file,
    base: loaded.file!,
    edits: [],
    credits: { ...loaded.document!.credits!, source: '仅修改图源' }
  })
  expect(saved).toMatchObject({ ok: false, kind: 'conflict' })
  expect(await readFile(file, 'utf8')).toBe(externallySaved)
})

it('does not turn a no-op save into a write when the file changes after capturing current bytes', async () => {
  const file = join(race.work, 'chapter.txt')
  await writeFile(file, original, 'utf8')
  const loaded = await readChapterTranslation(race.work)
  const externallySaved = original.replace('原台词', '外部新台词')
  race.path = file
  race.replacement = externallySaved

  const saved = await saveChapterTranslation({
    filePath: file,
    base: loaded.file!,
    edits: [{ imageName: '001.jpg', labelIndex: 1, text: '原台词' }]
  })
  expect(saved).toMatchObject({ ok: true, changed: false })
  expect(await readFile(file, 'utf8')).toBe(externallySaved)
})

it('retains the LabelPlus file size limit before reading a snapshot', async () => {
  const file = join(race.work, 'large.txt')
  await writeFile(file, '')
  await truncate(file, 64 * 1024 * 1024 + 1)
  await expect(readLabelPlusFileSnapshot(file)).rejects.toThrow('文件超过 64 MB 限制')
})
