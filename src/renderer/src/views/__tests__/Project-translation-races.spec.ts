import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, ref, type EffectScope } from 'vue'
import type {
  ChapterTranslationDeleteSaveResult,
  ChapterTranslationReadResult,
  ChapterTranslationSaveResult
} from '@shared/chapter-translation'
import {
  normalizeReviewFolder,
  normalizeReviewImage,
  type TranslationReviewListResult,
  type TranslationReviewRecord
} from '@shared/translation-review'
import { draftKey, useChapterTranslationDraft } from '@renderer/features/translation/useChapterTranslationDraft'

const bridge = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), undo: vi.fn() }))
vi.mock('@renderer/features/translation/translationBridge', () => ({
  saveChapterTranslation: bridge.save,
  deleteChapterTranslation: bridge.remove,
  undoChapterTranslation: bridge.undo
}))

/** Execute the real SFC handlers with Vue state and the real draft composable.
 * IPC is deferred/stubbed so failure and navigation ordering are deterministic.
 * Existing mounted Project tests cover template event wiring; this is not Electron E2E.
 */
const project = readFileSync(new URL('../Project.vue', import.meta.url), 'utf8')
const script = project.slice(project.indexOf('>') + 1, project.indexOf('</script>'))
const ast = ts.createSourceFile('Project.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const declarations = new Set([
  'translationDraft', 'translationReviewLoadSequence', 'reloadTranslationReviews',
  'onTranslationEditText', 'captureTranslationReviewTarget', 'translationReviewTargetIsCurrent',
  'writeTranslationReview', 'onTranslationEditReason', 'reviewRecordFor', 'onTranslationDeleteEntry'
])
const handlerNames = [
  'translationDraft', 'reloadTranslationReviews', 'onTranslationEditText',
  'onTranslationEditReason', 'onTranslationDeleteEntry'
]
const selected = ast.statements.filter((statement) => {
  if (ts.isFunctionDeclaration(statement)) return declarations.has(statement.name?.text ?? '')
  if (!ts.isVariableStatement(statement)) return false
  return statement.declarationList.declarations.some((item) =>
    ts.isIdentifier(item.name) && declarations.has(item.name.text))
}).map((statement) => statement.getText(ast)).join('\n')
const executable = ts.transpileModule(selected, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const fingerprint = { size: 100, mtimeMs: 1, sha256: 'a'.repeat(64) }
const nextFingerprint = { size: 110, mtimeMs: 2, sha256: 'b'.repeat(64) }
function readResult(folder: string): ChapterTranslationReadResult {
  return {
    status: 'ok', txtCount: 1, message: '',
    file: { path: `${folder}/translation.txt`, name: 'translation.txt', ...fingerprint },
    document: {
      sourcePath: `${folder}/translation.txt`, version: { first: 1, last: 0 },
      groups: ['inside'], warnings: [], images: [{
        fileName: '001.jpg', labels: [1, 2, 3].map((index) => ({
          index, text: `${folder} original ${index}`, group: 'inside',
          position: { unit: 'normalized' as const, x: 0.5, y: 0.5 }
        }))
      }]
    }
  }
}
function review(folder: string, extra: Partial<TranslationReviewRecord> = {}): TranslationReviewRecord {
  return {
    folderPath: folder, imageName: '001.jpg', labelIndex: 1, page: 1,
    originalText: `${folder} earliest original`, reviewedText: `${folder} reviewed`,
    reason: `${folder} reason`, at: 1, ...extra
  }
}
const success: ChapterTranslationSaveResult = {
  ok: true, changed: true, fingerprint: nextFingerprint, backupPath: '/backup.txt'
}
const deleted: ChapterTranslationDeleteSaveResult = {
  ...success, deletedIndex: 1, renumbered: [2, 3]
}
const scopes: EffectScope[] = []
function harness() {
  const child = ref({ folderPath: 'A' })
  const chapterTranslation = ref<ChapterTranslationReadResult | null>(readResult('A'))
  const currentTranslationEntry = computed(() => chapterTranslation.value?.document?.images[0] ?? null)
  const compareTranslation = computed(() => ({ entry: currentTranslationEntry.value }))
  const currentPageNumber = ref(1)
  const translationEnabled = ref(true)
  const translationPaneMode = ref('review')
  const translationReviews = ref<TranslationReviewRecord[]>([])
  const translationFileNotice = ref('')
  const listTranslationReviews = vi.fn().mockResolvedValue({ ok: true, records: [] })
  const saveTranslationReview = vi.fn().mockResolvedValue({ ok: true })
  const reloadChapterTranslation = vi.fn(async () => {})
  const clearJustAdded = vi.fn()
  const context = {
    child, chapterTranslation, currentTranslationEntry, compareTranslation, currentPageNumber,
    translationEnabled, translationPaneMode, translationReviews, translationFileNotice,
    listTranslationReviews, saveTranslationReview, reloadChapterTranslation, clearJustAdded,
    useChapterTranslationDraft, normalizeReviewFolder, normalizeReviewImage
  }
  const scope = effectScope()
  scopes.push(scope)
  const handlers = scope.run(() => new Function(
    ...Object.keys(context), `${executable}; return { ${handlerNames.join(', ')} };`
  )(...Object.values(context))) as {
    translationDraft: ReturnType<typeof useChapterTranslationDraft>
    reloadTranslationReviews: () => Promise<void>
    onTranslationEditText: (index: number, text: string, done?: (saved: boolean) => void) => Promise<void>
    onTranslationEditReason: (index: number, reason: string) => Promise<void>
    onTranslationDeleteEntry: (index: number) => Promise<void>
  }
  return {
    ...context, ...handlers,
    async navigate(folder: string) {
      child.value = { folderPath: folder }
      chapterTranslation.value = readResult(folder)
      translationReviews.value = []
      await nextTick()
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  bridge.save.mockResolvedValue(success)
  bridge.remove.mockResolvedValue(deleted)
})
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop() })

describe('Project translation review immutable targets', () => {
  it('writes A review to A/page 1 with captured prior reason after navigating to B/page 7', async () => {
    const h = harness()
    const write = deferred<ChapterTranslationSaveResult>()
    bridge.save.mockReturnValueOnce(write.promise)
    h.translationReviews.value = [review('B'), review('A')]
    const done = vi.fn()
    const pending = h.onTranslationEditText(1, 'A new review', done)
    await vi.waitFor(() => expect(bridge.save).toHaveBeenCalledTimes(1))
    h.translationReviews.value[1].reason = 'changed while pending'
    await h.navigate('B')
    h.currentPageNumber.value = 7
    h.translationPaneMode.value = 'translate'
    h.translationReviews.value = [review('B')]
    h.translationFileNotice.value = 'B notice'
    write.resolve(success)
    await pending

    expect(h.saveTranslationReview).toHaveBeenCalledWith(expect.objectContaining({
      folderPath: 'A', imageName: '001.jpg', labelIndex: 1, page: 1,
      originalText: 'A earliest original', reviewedText: 'A new review', reason: 'A reason'
    }))
    expect(h.translationReviews.value).toEqual([review('B')])
    expect(h.translationFileNotice.value).toBe('B notice')
    expect(h.listTranslationReviews).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledWith(true)
  })

  it('keeps the original page on a same-chapter page switch', async () => {
    const h = harness()
    const write = deferred<ChapterTranslationSaveResult>()
    bridge.save.mockReturnValueOnce(write.promise)
    const pending = h.onTranslationEditText(1, 'reviewed on page one')
    h.currentPageNumber.value = 9
    write.resolve(success)
    await pending
    expect(h.saveTranslationReview).toHaveBeenCalledWith(expect.objectContaining({
      folderPath: 'A', page: 1, originalText: 'A original 1'
    }))
  })

  it('does not create a review when text save fails', async () => {
    const h = harness()
    bridge.save.mockResolvedValueOnce({ ok: false, kind: 'conflict', message: 'changed externally' })
    const done = vi.fn()
    await h.onTranslationEditText(1, 'retained draft', done)
    expect(h.saveTranslationReview).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledWith(false)
    expect(h.translationDraft.edits.value.get(draftKey('001.jpg', 1))?.text).toBe('retained draft')
  })

  it('awaits the actual Project reload callback before completing a save', async () => {
    const h = harness()
    const reload = deferred<void>()
    h.reloadChapterTranslation.mockReturnValueOnce(reload.promise)
    const done = vi.fn()
    const pending = h.onTranslationEditText(1, 'text', done)
    await vi.waitFor(() => expect(h.reloadChapterTranslation).toHaveBeenCalled())
    expect(done).not.toHaveBeenCalled()
    expect(h.saveTranslationReview).not.toHaveBeenCalled()
    reload.resolve()
    await pending
    expect(done).toHaveBeenCalledWith(true)
  })
})

describe('Project review response fencing', () => {
  it('ignores A response after B loads and preserves B notice', async () => {
    const h = harness()
    const old = deferred<TranslationReviewListResult>()
    h.listTranslationReviews.mockReturnValueOnce(old.promise)
    const pending = h.reloadTranslationReviews()
    await h.navigate('B')
    h.listTranslationReviews.mockResolvedValueOnce({ ok: true, records: [review('B')] })
    await h.reloadTranslationReviews()
    h.translationFileNotice.value = 'B notice'
    old.resolve({ ok: false, records: [], message: 'A read failed' })
    await pending
    expect(h.translationReviews.value).toEqual([review('B')])
    expect(h.translationFileNotice.value).toBe('B notice')
  })

  it('ignores an older same-chapter response and a response after translation mode is disabled', async () => {
    const h = harness()
    const first = deferred<TranslationReviewListResult>()
    h.listTranslationReviews.mockReturnValueOnce(first.promise)
    const pending = h.reloadTranslationReviews()
    h.listTranslationReviews.mockResolvedValueOnce({ ok: true, records: [review('A', { reason: 'new' })] })
    await h.reloadTranslationReviews()
    first.resolve({ ok: true, message: '', records: [review('A', { reason: 'old' })] })
    await pending
    expect(h.translationReviews.value[0].reason).toBe('new')

    const disabled = deferred<TranslationReviewListResult>()
    h.listTranslationReviews.mockReturnValueOnce(disabled.promise)
    const pendingDisabled = h.reloadTranslationReviews()
    h.translationEnabled.value = false
    await h.reloadTranslationReviews()
    disabled.resolve({ ok: true, message: '', records: [review('A')] })
    await pendingDisabled
    expect(h.translationReviews.value).toEqual([])
  })
})

describe('Project delete transaction integration', () => {
  it('failed delete keeps all drafts and undo snapshots on their original indices', async () => {
    const h = harness()
    h.translationDraft.setText('001.jpg', 3, 'for original label 3')
    h.translationDraft.setText('001.jpg', 2, 'for original label 2')
    const remove = deferred<ChapterTranslationDeleteSaveResult>()
    bridge.remove.mockReturnValueOnce(remove.promise)
    const pending = h.onTranslationDeleteEntry(1)
    await vi.waitFor(() => expect(bridge.remove).toHaveBeenCalledTimes(1))
    expect(h.translationDraft.edits.value.get(draftKey('001.jpg', 3))?.text).toBe('for original label 3')
    remove.resolve({ ok: false, kind: 'conflict', message: 'delete failed' })
    await pending
    expect(h.translationDraft.edits.value.get(draftKey('001.jpg', 3))?.text).toBe('for original label 3')
    expect(h.translationDraft.undo()).toBe(true)
    expect(h.translationDraft.edits.value.get(draftKey('001.jpg', 3))?.text).toBe('for original label 3')
    await h.translationDraft.save({ force: true })
    expect(bridge.save).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'A/translation.txt', edits: [expect.objectContaining({ labelIndex: 3, text: 'for original label 3' })]
    }))
  })

  it('successful delete remaps surviving drafts only after IPC succeeds', async () => {
    const h = harness()
    h.translationDraft.setText('001.jpg', 3, 'for original label 3')
    const remove = deferred<ChapterTranslationDeleteSaveResult>()
    bridge.remove.mockReturnValueOnce(remove.promise)
    const pending = h.onTranslationDeleteEntry(1)
    await vi.waitFor(() => expect(bridge.remove).toHaveBeenCalledTimes(1))
    expect(h.translationDraft.edits.value.has(draftKey('001.jpg', 3))).toBe(true)
    remove.resolve(deleted)
    await pending
    expect(h.translationDraft.edits.value.get(draftKey('001.jpg', 2))?.text).toBe('for original label 3')
    expect(h.translationDraft.edits.value.has(draftKey('001.jpg', 3))).toBe(false)
    expect(h.translationDraft.canUndoSaved.value).toBe(true)
  })

  it('retains text typed during a failed delete and keeps its editor open', async () => {
    const h = harness()
    const remove = deferred<ChapterTranslationDeleteSaveResult>()
    bridge.remove.mockReturnValueOnce(remove.promise)
    const pending = h.onTranslationDeleteEntry(1)
    await vi.waitFor(() => expect(bridge.remove).toHaveBeenCalledTimes(1))
    const done = vi.fn()
    await h.onTranslationEditText(3, 'typed while deleting', done)
    expect(done).toHaveBeenCalledWith(false)
    expect(bridge.save).not.toHaveBeenCalled()
    remove.resolve({ ok: false, kind: 'io', message: 'disk unavailable' })
    await pending
    expect(h.translationDraft.edits.value.get(draftKey('001.jpg', 3))?.text).toBe('typed while deleting')
    await h.translationDraft.save()
    expect(bridge.save).toHaveBeenCalledWith(expect.objectContaining({
      edits: [expect.objectContaining({ labelIndex: 3, text: 'typed while deleting' })]
    }))
  })

  it('does not delete between text commit and durable review recording', async () => {
    const h = harness()
    const reviewWrite = deferred<{ ok: true }>()
    h.saveTranslationReview.mockReturnValueOnce(reviewWrite.promise)
    const pending = h.onTranslationEditText(3, 'review in progress')
    await vi.waitFor(() => expect(h.saveTranslationReview).toHaveBeenCalledTimes(1))
    await h.onTranslationDeleteEntry(1)
    expect(bridge.remove).not.toHaveBeenCalled()
    reviewWrite.resolve({ ok: true })
    await pending
    await h.onTranslationDeleteEntry(1)
    expect(bridge.remove).toHaveBeenCalledTimes(1)
  })

  it('late delete completion cannot reindex B drafts or overwrite B feedback', async () => {
    const h = harness()
    h.translationDraft.setText('001.jpg', 3, 'A label 3')
    const remove = deferred<ChapterTranslationDeleteSaveResult>()
    bridge.remove.mockReturnValueOnce(remove.promise)
    const pending = h.onTranslationDeleteEntry(1)
    await vi.waitFor(() => expect(bridge.remove).toHaveBeenCalledTimes(1))
    await h.navigate('B')
    h.translationDraft.setText('001.jpg', 3, 'B label 3')
    h.translationFileNotice.value = 'B notice'
    remove.resolve(deleted)
    await pending
    expect(h.translationDraft.edits.value.get(draftKey('001.jpg', 3))?.text).toBe('B label 3')
    expect(h.translationDraft.edits.value.has(draftKey('001.jpg', 2))).toBe(false)
    expect(h.translationFileNotice.value).toBe('B notice')
    expect(h.clearJustAdded).not.toHaveBeenCalled()
    expect(h.listTranslationReviews).not.toHaveBeenCalled()
  })
})
