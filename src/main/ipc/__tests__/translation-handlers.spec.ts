// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  ChapterTranslationCreateResult,
  ChapterTranslationDeleteSaveResult,
  ChapterTranslationInsertSaveResult,
  ChapterTranslationSaveResult,
  ChapterTranslationUndoResult
} from '@shared/chapter-translation'
import type { TranslationReviewRecord } from '@shared/translation-review'

const ROOT = resolve(__dirname, '../../../../.omo/fixtures/translation-handler-review-undo')
const handlers = new Map<string, (_event: unknown, request: unknown) => Promise<unknown>>()
vi.mock('electron', () => ({
  app: { getPath: () => ROOT },
  ipcMain: {
    handle: (name: string, handler: (_event: unknown, request: unknown) => Promise<unknown>) =>
      handlers.set(name, handler)
  }
}))

import { registerTranslationHandlers } from '../translation-handlers'
import { closeDatabase, getDatabase } from '../../services/db/connection'
import {
  listTranslationReviews,
  saveTranslationReview
} from '../../services/db/translation-review-store'
import {
  fingerprintChapterTranslationFile,
  sessionTranslationBaselines
} from '../../services/chapter-translation-write'
import { parseLabelPlusContent } from '../../services/labelplus-parser'

const FOLDER = join(ROOT, 'chapter')
const FILE = join(FOLDER, 'translations.txt')
const CONTENT = [
  '1,0',
  '-',
  '框内',
  '框外',
  '-',
  '',
  '>>>>>>>>[01.png]<<<<<<<<',
  '----------------[1]----------------[0.1,0.1,1]',
  'reviewed FIRST',
  '',
  '----------------[2]----------------[0.2,0.2,1]',
  'reviewed SECOND',
  '',
  '----------------[3]----------------[0.3,0.3,1]',
  'reviewed THIRD',
  '',
  '>>>>>>>>[02.png]<<<<<<<<',
  '----------------[1]----------------[0.1,0.1,1]',
  'other image',
  ''
].join('\n')

function record(
  index: number,
  patch: Partial<TranslationReviewRecord> = {}
): TranslationReviewRecord {
  return {
    folderPath: FOLDER,
    imageName: '01.png',
    labelIndex: index,
    page: 1,
    originalText: `original ${index}`,
    reviewedText: ['FIRST', 'SECOND', 'THIRD'][index - 1],
    reason: `reason ${index}`,
    at: 100 + index,
    ...patch
  }
}
async function invoke<T>(name: string, request: unknown): Promise<T> {
  return (await handlers.get(`comicType:${name}`)!(null, request)) as T
}
async function remove(
  index = 1,
  base?: Awaited<ReturnType<typeof fingerprintChapterTranslationFile>>
) {
  return invoke<ChapterTranslationDeleteSaveResult>('deleteChapterTranslation', {
    filePath: FILE,
    base: base ?? (await fingerprintChapterTranslationFile(FILE)),
    delete: { imageName: '01.PNG', labelIndex: index }
  })
}
async function undo(filePath = FILE) {
  return invoke<ChapterTranslationUndoResult>('undoChapterTranslation', {
    filePath,
    base: await fingerprintChapterTranslationFile(filePath)
  })
}
async function save(text: string, labelIndex = 1) {
  return invoke<ChapterTranslationSaveResult>('saveChapterTranslation', {
    filePath: FILE,
    base: await fingerprintChapterTranslationFile(FILE),
    edits: [{ imageName: '01.png', labelIndex, text }]
  })
}
async function seedReviews() {
  for (const index of [1, 2, 3]) await saveTranslationReview(record(index))
}
async function texts() {
  return parseLabelPlusContent(await readFile(FILE, 'utf8')).images[0].labels.map(
    (label) => label.text
  )
}

beforeEach(async () => {
  await closeDatabase()
  sessionTranslationBaselines.clear()
  await rm(ROOT, { recursive: true, force: true })
  await mkdir(FOLDER, { recursive: true })
  await writeFile(FILE, CONTENT, 'utf8')
  registerTranslationHandlers()
})
afterAll(async () => {
  await closeDatabase()
  await rm(ROOT, { recursive: true, force: true })
})

describe('translation IPC review identity and undo', () => {
  it('deletes using the chapter directory, then restores TXT and every review field on undo', async () => {
    await seedReviews()
    const before = await listTranslationReviews(FOLDER)
    const removed = await remove()
    expect(removed).toMatchObject({ ok: true, changed: true, deletedIndex: 1 })
    expect(await texts()).toEqual(['reviewed SECOND', 'reviewed THIRD'])
    expect(await listTranslationReviews(FOLDER)).toEqual(
      before.slice(1).map((row) => ({
        ...row,
        labelIndex: row.labelIndex - 1
      }))
    )
    expect((await undo()).ok).toBe(true)
    expect(await readFile(FILE, 'utf8')).toBe(CONTENT)
    expect(await listTranslationReviews(FOLDER)).toEqual(before)
    expect(sessionTranslationBaselines.size).toBe(0)
  })

  it('preserves later unrelated lower-label, image and chapter review changes on delete undo', async () => {
    await seedReviews()
    const before = await listTranslationReviews(FOLDER)
    expect((await remove(2)).ok).toBe(true)
    await saveTranslationReview(record(1, { reason: 'new lower-label reason', at: 500 }))
    await saveTranslationReview(
      record(1, { imageName: '02.png', reason: 'new other-image review' })
    )
    const otherFolder = join(ROOT, 'other')
    await saveTranslationReview(record(2, { folderPath: otherFolder, reason: 'other chapter' }))
    expect((await undo()).ok).toBe(true)
    const after = await listTranslationReviews(FOLDER)
    expect(after.find((row) => row.imageName === '01.png' && row.labelIndex === 1)?.reason).toBe(
      'new lower-label reason'
    )
    expect(after.filter((row) => row.imageName === '01.png' && row.labelIndex >= 2)).toEqual(
      before.slice(1)
    )
    expect(after.find((row) => row.imageName === '02.png')?.reason).toBe('new other-image review')
    expect((await listTranslationReviews(otherFolder))[0].reason).toBe('other chapter')
  })

  it('undoes repeated reviewed saves, including removing a review created by the first save', async () => {
    expect((await save('first correction')).ok).toBe(true)
    await invoke(
      'saveTranslationReview',
      record(1, { reviewedText: 'first correction', reason: 'first reason' })
    )
    const firstReview = await listTranslationReviews(FOLDER)
    expect((await save('second correction')).ok).toBe(true)
    await invoke(
      'saveTranslationReview',
      record(1, {
        originalText: 'wrong replacement',
        reviewedText: 'second correction',
        reason: 'second reason'
      })
    )
    await saveTranslationReview(record(1, { imageName: '02.png', reason: 'independent review' }))
    expect((await undo()).ok).toBe(true)
    expect((await texts())[0]).toBe('first correction')
    expect(
      (await listTranslationReviews(FOLDER)).filter((row) => row.imageName === '01.png')
    ).toEqual(firstReview)
    expect((await undo()).ok).toBe(true)
    expect(await readFile(FILE, 'utf8')).toBe(CONTENT)
    expect((await listTranslationReviews(FOLDER)).map((row) => row.imageName)).toEqual(['02.png'])
  })

  it('restores a review removed by the unreview flow when its TXT save is undone', async () => {
    await seedReviews()
    const before = await listTranslationReviews(FOLDER)
    expect((await save('original 1')).ok).toBe(true)
    await invoke('deleteTranslationReview', {
      folderPath: FOLDER,
      imageName: '01.png',
      labelIndex: 1
    })
    expect(await listTranslationReviews(FOLDER)).toHaveLength(2)
    expect((await undo()).ok).toBe(true)
    expect(await readFile(FILE, 'utf8')).toBe(CONTENT)
    expect(await listTranslationReviews(FOLDER)).toEqual(before)
  })

  it('rejects duplicate/stale deletes without moving reviews again, and no-op saves add no undo entry', async () => {
    await seedReviews()
    const base = await fingerprintChapterTranslationFile(FILE)
    const results = await Promise.all([remove(1, base), remove(1, base)])
    expect(results[0].ok).toBe(true)
    expect(results[1]).toMatchObject({ ok: false, kind: 'conflict' })
    const after = await listTranslationReviews(FOLDER)
    expect(after.map((row) => row.originalText)).toEqual(['original 2', 'original 3'])
    expect(await save('reviewed SECOND')).toMatchObject({ ok: true, changed: false })
    expect(sessionTranslationBaselines.get(FILE)).toHaveLength(1)
    expect(await remove(99)).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await listTranslationReviews(FOLDER)).toEqual(after)
    expect((await undo()).ok).toBe(true)
    expect(await listTranslationReviews(FOLDER)).toHaveLength(3)
  })

  it('keeps both stores and history unchanged when undo conflicts with an external edit', async () => {
    await seedReviews()
    expect((await remove()).ok).toBe(true)
    const base = await fingerprintChapterTranslationFile(FILE)
    const after = await listTranslationReviews(FOLDER)
    const external = (await readFile(FILE, 'utf8')).replace('reviewed SECOND', 'external edit')
    await writeFile(FILE, external)
    expect(await invoke('undoChapterTranslation', { filePath: FILE, base })).toMatchObject({
      ok: false,
      kind: 'conflict'
    })
    expect(await readFile(FILE, 'utf8')).toBe(external)
    expect(await listTranslationReviews(FOLDER)).toEqual(after)
    expect(sessionTranslationBaselines.get(FILE)).toHaveLength(1)
  })

  it('compensates TXT and retains undo history when review restoration fails, then retries successfully', async () => {
    await seedReviews()
    const before = await listTranslationReviews(FOLDER)
    expect((await remove()).ok).toBe(true)
    const deletedText = await readFile(FILE, 'utf8')
    const deletedReviews = await listTranslationReviews(FOLDER)
    const database = await getDatabase()
    database.exec(`CREATE TRIGGER reject_review_restore BEFORE INSERT ON translation_review
      BEGIN SELECT RAISE(ABORT, 'simulated review failure'); END`)
    expect(await undo()).toMatchObject({ ok: false, kind: 'io' })
    expect(await readFile(FILE, 'utf8')).toBe(deletedText)
    expect(await listTranslationReviews(FOLDER)).toEqual(deletedReviews)
    expect(sessionTranslationBaselines.get(FILE)).toHaveLength(1)
    database.exec('DROP TRIGGER reject_review_restore')
    expect((await undo()).ok).toBe(true)
    expect(await readFile(FILE, 'utf8')).toBe(CONTENT)
    expect(await listTranslationReviews(FOLDER)).toEqual(before)
  })

  it('compensates TXT and adds no history if review renumbering fails after deletion', async () => {
    await seedReviews()
    const before = await listTranslationReviews(FOLDER)
    const database = await getDatabase()
    database.exec(`CREATE TRIGGER reject_review_move BEFORE INSERT ON translation_review
      BEGIN SELECT RAISE(ABORT, 'simulated review failure'); END`)
    expect(await remove()).toMatchObject({ ok: false, kind: 'io' })
    expect(await readFile(FILE, 'utf8')).toBe(CONTENT)
    expect(await listTranslationReviews(FOLDER)).toEqual(before)
    expect(sessionTranslationBaselines.size).toBe(0)
    database.exec('DROP TRIGGER reject_review_move')
    expect((await remove()).ok).toBe(true)
  })

  it('does not write TXT when the review snapshot cannot be read', async () => {
    const database = await getDatabase()
    database.exec('DROP TABLE translation_review')
    expect(await remove()).toMatchObject({ ok: false, kind: 'io' })
    expect(await readFile(FILE, 'utf8')).toBe(CONTENT)
    expect(sessionTranslationBaselines.size).toBe(0)
  })

  it('restores review state even when TXT already matches the undo baseline', async () => {
    await seedReviews()
    const before = await listTranslationReviews(FOLDER)
    expect((await remove()).ok).toBe(true)
    await writeFile(FILE, CONTENT)
    expect(await undo()).toMatchObject({ ok: true, changed: false })
    expect(await listTranslationReviews(FOLDER)).toEqual(before)
    expect(sessionTranslationBaselines.size).toBe(0)
  })

  it('undoing coordinates does not discard a later reason-only review edit', async () => {
    await seedReviews()
    const result = await invoke<ChapterTranslationSaveResult>('saveChapterTranslation', {
      filePath: FILE,
      base: await fingerprintChapterTranslationFile(FILE),
      edits: [{ imageName: '01.png', labelIndex: 1, position: { x: 0.6, y: 0.6 } }]
    })
    expect(result.ok).toBe(true)
    await saveTranslationReview(record(1, { reason: 'independent new reason' }))
    expect((await undo()).ok).toBe(true)
    expect(await readFile(FILE, 'utf8')).toBe(CONTENT)
    expect((await listTranslationReviews(FOLDER))[0].reason).toBe('independent new reason')
  })

  it('undoes insertion without leaving an added review or changing an existing review', async () => {
    await seedReviews()
    const before = await listTranslationReviews(FOLDER)
    const inserted = await invoke<ChapterTranslationInsertSaveResult>('insertChapterTranslation', {
      filePath: FILE,
      base: await fingerprintChapterTranslationFile(FILE),
      insert: {
        imageName: '01.png',
        groupName: '框内',
        position: { x: 0.4, y: 0.4 },
        text: 'inserted'
      }
    })
    expect(inserted).toMatchObject({ ok: true, insertedIndex: 4 })
    await saveTranslationReview(record(4, { reviewedText: 'inserted' }))
    expect((await undo()).ok).toBe(true)
    expect(await readFile(FILE, 'utf8')).toBe(CONTENT)
    expect(await listTranslationReviews(FOLDER)).toEqual(before)
  })

  it('undoes creation with its review state and compensates a failed database step without losing the file', async () => {
    const fresh = join(ROOT, 'fresh')
    await mkdir(fresh)
    const created = await invoke<ChapterTranslationCreateResult>('createChapterTranslation', {
      folderPath: fresh,
      pages: ['01.png'],
      insert: {
        imageName: '01.png',
        groupName: '框内',
        position: { x: 0.1, y: 0.1 },
        text: 'created'
      }
    })
    if (!created.ok) throw new Error(created.message)
    await saveTranslationReview(record(1, { folderPath: fresh, reviewedText: 'created' }))
    const createdText = await readFile(created.path, 'utf8')
    const database = await getDatabase()
    database.exec(`CREATE TRIGGER reject_review_delete BEFORE DELETE ON translation_review
      BEGIN SELECT RAISE(ABORT, 'simulated review failure'); END`)
    expect(await undo(created.path)).toMatchObject({ ok: false, kind: 'io' })
    expect(await readFile(created.path, 'utf8')).toBe(createdText)
    expect(await listTranslationReviews(fresh)).toHaveLength(1)
    database.exec('DROP TRIGGER reject_review_delete')
    expect(await undo(created.path)).toMatchObject({ ok: true, deleted: true })
    expect(existsSync(created.path)).toBe(false)
    expect(await listTranslationReviews(fresh)).toEqual([])
  })
})
