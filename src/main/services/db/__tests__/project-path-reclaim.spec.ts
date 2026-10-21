// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { normalizePathKey } from '@shared/paths'
import { normalizeReviewFolder } from '@shared/translation-review'
import type { ParentProject } from '@shared/types'
import { createSchema } from '../schema'

let db: DatabaseSync
vi.mock('../connection', () => ({ getDatabase: async () => db }))

import { getProjectTree, reclaimChildPath, saveProjectTree } from '../../project-repository'
import { getStoredProjectMemory, setStoredProjectMemoryStatuses } from '../project-memory-store'
import { collectMarkStatisticsFrom } from '../mark-stats-store'
import { getMarkAuditOperation, undoMarkOperation } from '../mark-audit-store'
import { listTranslationReviews, saveTranslationReview } from '../translation-review-store'
import { getStatisticsTime, setStatisticsTime, undoStatisticsTime } from '../statistics-time-store'

const OLD = 'C:\\Book\\Old'
const NEXT = 'D:\\Moved\\New'
const modes = { typeset: true, translated: true, proofread: true, supervised: true }
const times = { typeset: 100, translated: 200, proofread: 300, supervised: 400 }

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  createSchema(db)
})
afterEach(() => db.close())

async function seed(folder = OLD, paths = [`${folder}\\Sub\\01.PSD`]): Promise<void> {
  const projects: ParentProject[] = [
    {
      id: 'p',
      title: 'Book',
      lastMtimeMs: 12,
      children: [
        {
          id: 'c',
          parentTitle: 'Book',
          folderPath: folder,
          chapterNumber: '1',
          projectTitle: 'Chapter',
          lastMtimeMs: 12,
          contentFingerprint: 'same-content'
        }
      ]
    }
  ]
  await saveProjectTree(projects)
  await setStoredProjectMemoryStatuses(
    'c',
    folder,
    paths.map((path) => ({
      path,
      pathKey: normalizePathKey(path),
      status: 'done',
      mtimeMs: 12,
      modes,
      modeTimestamps: times
    })),
    { opId: 'original-mark', kind: 'mark', source: 'card', mode: 'proofread' }
  )
}

async function review(folderPath: string, imageName = '01.jpg'): Promise<void> {
  await saveTranslationReview({
    folderPath,
    imageName,
    labelIndex: 1,
    page: 1,
    originalText: 'original',
    reviewedText: 'reviewed',
    reason: 'reason',
    at: 456
  })
}

function state(): unknown {
  return Object.fromEntries(
    [
      'key_value_store',
      'project_memory',
      'project_memory_files',
      'mark_audit',
      'statistics_time_rules',
      'statistics_time_pages',
      'statistics_time_audit',
      'translation_review'
    ].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])
  )
}

describe('reclaim preserves chapter-relative identities in one transaction', () => {
  it('hydrates all four modes at the new path, preserves dates/reviews, and avoids duplicate achievement counts', async () => {
    await seed()
    await review(OLD)
    await setStatisticsTime({
      childId: 'c',
      mode: 'proofread',
      source: 'manual',
      date: '2021-05-02'
    })
    const before = await getStoredProjectMemory('c')
    const originalFile = before!.files[normalizePathKey(`${OLD}/Sub/01.PSD`)]
    const originalStats = collectMarkStatisticsFrom(db)[0]
    const originalAudit = await getMarkAuditOperation('original-mark')
    const originalReviews = await listTranslationReviews(OLD)

    await reclaimChildPath('p', 'c', NEXT)

    const newPath = `${NEXT}\\Sub\\01.PSD`
    const newKey = normalizePathKey(newPath)
    const memory = await getStoredProjectMemory('c')
    // This is the exact absolute-key lookup used when the renderer hydrates a scanned page.
    expect(memory!.files[newKey]).toEqual({ ...originalFile, path: newPath })
    expect(Object.keys(memory!.files)).toEqual([newKey])
    expect(memory).toMatchObject({ folderPath: NEXT, updatedAt: before!.updatedAt })
    expect((await getProjectTree())[0].children[0]).toMatchObject({
      id: 'c',
      folderPath: NEXT,
      chapterNumber: '1',
      lastMtimeMs: 12,
      contentFingerprint: 'same-content'
    })
    expect(collectMarkStatisticsFrom(db)[0]).toEqual({ ...originalStats, folderPath: NEXT })
    expect(await getStatisticsTime({ childId: 'c', paths: [newPath] }, 'proofread')).toBe('manual')
    expect(await listTranslationReviews(OLD)).toEqual([])
    expect(await listTranslationReviews(NEXT)).toEqual(
      originalReviews.map((entry) => ({
        ...entry,
        folderPath: normalizeReviewFolder(NEXT)
      }))
    )
    expect(await getMarkAuditOperation('original-mark')).toEqual({
      ...originalAudit,
      children: [
        {
          ...originalAudit!.children[0],
          folderPath: NEXT,
          entries: originalAudit!.children[0].entries.map((entry) => ({
            ...entry,
            path: newPath,
            pathKey: newKey
          }))
        }
      ]
    })

    await setStoredProjectMemoryStatuses('c', NEXT, [
      {
        path: newPath,
        pathKey: newKey,
        status: 'done',
        mtimeMs: 12,
        modes: {}
      }
    ])
    expect(collectMarkStatisticsFrom(db)[0].fileCount).toBe(1)
    expect(collectMarkStatisticsFrom(db)[0].completedTimestamps).toEqual(
      originalStats.completedTimestamps
    )
  })

  it('undo of pre-rename marks and both statistics-history snapshots uses only the new identity', async () => {
    await seed()
    await setStatisticsTime({
      childId: 'c',
      mode: 'proofread',
      source: 'manual',
      date: '2021-05-02'
    })
    await reclaimChildPath('p', 'c', NEXT)
    const key = normalizePathKey(`${NEXT}/Sub/01.PSD`)
    const history = db.prepare('SELECT * FROM statistics_time_audit').get() as {
      id: number
      before_json: string
      after_json: string
    }
    for (const raw of [history.before_json, history.after_json]) {
      expect(
        JSON.parse(raw).pages.every((page: { path_key: string }) => page.path_key === key)
      ).toBe(true)
    }
    expect((await undoStatisticsTime(`statistics-time:${history.id}`)).revertedFiles).toBe(1)
    expect(collectMarkStatisticsFrom(db)[0].completedTimestamps.proofread).toEqual([300])
    expect((await undoMarkOperation('original-mark')).revertedFiles).toBe(1)
    const memory = await getStoredProjectMemory('c')
    expect(Object.keys(memory!.files)).toEqual([key])
    expect(memory!.folderPath).toBe(NEXT)
    expect(memory!.files[key].modes).toEqual({
      typeset: false,
      translated: false,
      proofread: false,
      supervised: false
    })
    expect(memory!.files[key].modeTimestamps).toEqual({})
    expect(collectMarkStatisticsFrom(db)[0].fileCount).toBe(1)
  })

  it('keeps neighboring-prefix files, another child and unrelated history unchanged', async () => {
    const neighbor = `${OLD}er/02.psd`
    await seed(OLD, [`${OLD}/01.psd`, neighbor])
    await setStoredProjectMemoryStatuses(
      'other',
      OLD,
      [
        {
          path: `${OLD}/01.psd`,
          pathKey: normalizePathKey(`${OLD}/01.psd`),
          status: 'done',
          mtimeMs: 1,
          modes,
          modeTimestamps: times
        }
      ],
      { opId: 'other-mark', kind: 'mark', source: 'card' }
    )
    await setStatisticsTime({
      childId: 'c',
      mode: 'proofread',
      source: 'manual',
      date: '2021-05-02'
    })
    await review(`${OLD}er`)
    const before = await getStoredProjectMemory('c')
    const other = await getStoredProjectMemory('other')
    const otherAudit = await getMarkAuditOperation('other-mark')
    const reviews = await listTranslationReviews(`${OLD}er`)
    await reclaimChildPath('p', 'c', NEXT)
    expect((await getStoredProjectMemory('c'))!.files[normalizePathKey(neighbor)]).toEqual(
      before!.files[normalizePathKey(neighbor)]
    )
    expect(await getStoredProjectMemory('other')).toEqual(other)
    expect(await getMarkAuditOperation('other-mark')).toEqual(otherAudit)
    expect(await listTranslationReviews(`${OLD}er`)).toEqual(reviews)
    const history = db.prepare('SELECT before_json FROM statistics_time_audit').get() as {
      before_json: string
    }
    expect(
      JSON.parse(history.before_json)
        .pages.filter((page: { child_id: string }) => page.child_id === 'other')
        .every((page: { path_key: string }) => page.path_key === normalizePathKey(`${OLD}/01.psd`))
    ).toBe(true)
  })

  it.each([
    [
      'C:/Book/Café',
      'c:\\book\\Cafe\u0301\\Sub\\01.PSD',
      'D:/Moved/New',
      'D:/Moved/New/Sub/01.PSD'
    ],
    [
      '\\\\Server\\Share\\Old\\',
      '//server/share/old/Sub/01.PSD',
      '\\\\Server\\Share\\New',
      '\\\\Server\\Share\\New\\Sub\\01.PSD'
    ],
    ['C:/Book/Old', 'c:\\book\\old\\01.PSD', 'c:/BOOK/OLD/', 'c:/BOOK/OLD/01.PSD']
  ])(
    'handles Unicode, Windows/UNC separators and case-only folder changes (%s)',
    async (old, path, next, expected) => {
      await seed(old, [path])
      await review(old)
      await reclaimChildPath('p', 'c', next)
      const memory = await getStoredProjectMemory('c')
      expect(memory!.files[normalizePathKey(expected)]).toMatchObject({
        path: expected,
        modes,
        modeTimestamps: times
      })
      expect(await listTranslationReviews(next)).toHaveLength(1)
    }
  )

  it('handles nested destinations without colliding with rows that are also moving', async () => {
    await seed('C:/old', ['C:/old/1.psd', 'C:/old/new/1.psd'])
    await reclaimChildPath('p', 'c', 'C:/old/new')
    expect(Object.keys((await getStoredProjectMemory('c'))!.files).sort()).toEqual([
      'c:/old/new/1.psd',
      'c:/old/new/new/1.psd'
    ])
    expect(collectMarkStatisticsFrom(db)[0].fileCount).toBe(2)
  })

  it.each([
    'file',
    'date',
    'review',
    'history',
    'broken-history',
    'broken-date-history',
    'mismatched-path'
  ])('rolls back every table on %s conflicts or unsafe history', async (conflict) => {
    await seed()
    await review(OLD)
    await setStatisticsTime({
      childId: 'c',
      mode: 'proofread',
      source: 'manual',
      date: '2021-05-02'
    })
    const destination = `${NEXT}/Sub/01.PSD`
    const key = normalizePathKey(destination)
    if (conflict === 'file') {
      await setStoredProjectMemoryStatuses('c', OLD, [
        {
          path: destination,
          pathKey: key,
          status: 'pending',
          mtimeMs: 99,
          modes: {}
        }
      ])
    } else if (conflict === 'date') {
      db.prepare('INSERT INTO statistics_time_pages VALUES (?, ?, ?, ?, ?, ?)').run(
        'c',
        key,
        'proofread',
        'manual',
        999,
        300
      )
    } else if (conflict === 'review') {
      await review(NEXT, 'unrelated.jpg')
    } else if (conflict === 'history') {
      const row = db.prepare('SELECT id, before_json FROM statistics_time_audit').get() as {
        id: number
        before_json: string
      }
      const snapshot = JSON.parse(row.before_json)
      snapshot.pages.push({ ...snapshot.pages[0], path_key: key })
      db.prepare('UPDATE statistics_time_audit SET before_json = ? WHERE id = ?').run(
        JSON.stringify(snapshot),
        row.id
      )
    } else if (conflict === 'broken-history') {
      db.prepare('UPDATE mark_audit SET entries_json = ?').run('{broken')
    } else if (conflict === 'broken-date-history') {
      db.prepare('UPDATE statistics_time_audit SET after_json = ?').run('{broken')
    } else {
      db.prepare('UPDATE project_memory_files SET path = ?').run('C:/unrelated/01.psd')
    }
    const before = state()
    await expect(reclaimChildPath('p', 'c', NEXT)).rejects.toThrow()
    expect(state()).toEqual(before)
    // A failed migration must release the transaction for the next operation too.
    await saveProjectTree(await getProjectTree())
  })

  it('rolls back migrated records if the final tree write fails', async () => {
    await seed()
    await review(OLD)
    await setStatisticsTime({
      childId: 'c',
      mode: 'proofread',
      source: 'manual',
      date: '2021-05-02'
    })
    const before = state()
    db.exec(`CREATE TRIGGER reject_tree_write BEFORE UPDATE ON key_value_store
      WHEN NEW.key = 'projects' BEGIN SELECT RAISE(ABORT, 'tree write failed'); END`)
    await expect(reclaimChildPath('p', 'c', NEXT)).rejects.toThrow('tree write failed')
    expect(state()).toEqual(before)
  })

  it('refuses traversal paths without rebinding unrelated files', async () => {
    await seed(OLD, [`${OLD}/../unrelated/01.psd`])
    const before = state()
    await expect(reclaimChildPath('p', 'c', NEXT)).rejects.toThrow('无效的相对目录')
    expect(state()).toEqual(before)
  })

  it('does not require a memory row for an unmarked chapter', async () => {
    await seed()
    db.exec('DELETE FROM mark_audit; DELETE FROM statistics_time_pages; DELETE FROM project_memory')
    await reclaimChildPath('p', 'c', NEXT)
    expect(await getStoredProjectMemory('c')).toBeNull()
    expect((await getProjectTree())[0].children[0].folderPath).toBe(NEXT)
  })
})
