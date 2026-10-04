// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DATABASE_ROOT = resolve(__dirname, '../../../../.omo/fixtures/database-test')
let activeDatabaseRoot = DATABASE_ROOT

vi.mock('electron', () => ({
  app: { getPath: () => activeDatabaseRoot }
}))

import {
  closeDatabase,
  databasePath,
  getStoredProjectMemory,
  getStoredValue,
  importLegacyJsonFiles,
  setStoredProjectMemoryStatuses,
  setStoredValue,
  setStoredValueSync
} from '../database'

describe('SQLite application database', () => {
  beforeAll(async () => {
    await rm(DATABASE_ROOT, { recursive: true, force: true })
    await mkdir(resolve(DATABASE_ROOT, 'config'), { recursive: true })
    await writeFile(
      resolve(DATABASE_ROOT, 'qianzi-gongfang.json'),
      JSON.stringify({ projects: [{ id: 'parent-1', title: '龙珠', children: [] }] }),
      'utf8'
    )
    await writeFile(
      resolve(DATABASE_ROOT, 'config', 'memory.json'),
      JSON.stringify({
        projects: {
          'child-1': {
            childId: 'child-1',
            folderPath: 'C:\\漫画\\龙珠',
            updatedAt: 10,
            files: {
              page: {
                path: 'C:\\漫画\\龙珠\\1.psd',
                status: 'done',
                mtimeMs: 5,
                updatedAt: 10
              }
            }
          }
        }
      }),
      'utf8'
    )
  })

  afterAll(async () => {
    await closeDatabase()
    await rm(DATABASE_ROOT, { recursive: true, force: true })
  })

  it('migrates legacy project and memory JSON into SQLite once', async () => {
    expect(await getStoredValue('projects')).toEqual([
      { id: 'parent-1', title: '龙珠', children: [] }
    ])
    const memory = await getStoredProjectMemory('child-1')
    expect(memory?.folderPath).toBe('C:\\漫画\\龙珠')
    expect(memory?.files.page.status).toBe('done')
  })

  it('stores configuration values as typed JSON', async () => {
    await setStoredValue('ui.thumbSize', '大')
    expect(await getStoredValue('ui.thumbSize')).toBe('大')
  })

  it('automatically recognizes and safely merges manually selected legacy JSON files', async () => {
    await setStoredValue('projects', [
      {
        id: 'current-parent',
        title: '龙珠',
        children: [
          {
            id: 'current-child',
            folderPath: 'C:\\漫画\\龙珠\\001',
            chapterNumber: '自定义一',
            projectTitle: '当前标题'
          }
        ]
      }
    ])
    await setStoredValue('psdStatusOverrides', {
      'C:\\漫画\\龙珠\\001\\current.psd': 'done'
    })
    const mainPath = resolve(DATABASE_ROOT, 'manual-main.json')
    const memoryPath = resolve(DATABASE_ROOT, 'manual-memory.json')
    const fontPath = resolve(DATABASE_ROOT, 'manual-font.json')
    await writeFile(
      mainPath,
      JSON.stringify({
        projects: [
          {
            id: 'old-parent',
            title: '龙珠',
            children: [
              {
                id: 'old-duplicate',
                folderPath: 'c:/漫画/龙珠/001',
                chapterNumber: '1',
                projectTitle: '不应覆盖'
              },
              {
                id: 'old-new',
                folderPath: 'C:\\漫画\\龙珠\\002',
                chapterNumber: '2',
                projectTitle: '新增项目'
              }
            ]
          }
        ],
        recentProjectIds: ['old-new'],
        psdStatusOverrides: {
          'C:\\漫画\\龙珠\\001\\current.psd': 'pending',
          'C:\\漫画\\龙珠\\002\\old.psd': 'pending'
        }
      }),
      'utf8'
    )
    await writeFile(
      memoryPath,
      JSON.stringify({
        projects: {
          'old-duplicate': {
            childId: 'old-duplicate',
            folderPath: 'C:\\漫画\\龙珠\\001',
            updatedAt: 10,
            files: {
              imported: {
                path: 'C:\\漫画\\龙珠\\001\\imported.psd',
                status: 'done',
                mtimeMs: 5,
                updatedAt: 10
              }
            }
          }
        }
      }),
      'utf8'
    )
    await writeFile(
      fontPath,
      JSON.stringify({
        version: 1,
        installed: { 'font-1': { id: 'font-1', family: 'Test Font' } }
      }),
      'utf8'
    )

    // Memory deliberately comes first: content recognition must not depend
    // on the order returned by the native multi-file picker.
    const result = await importLegacyJsonFiles([memoryPath, mainPath, fontPath])
    const projects = (await getStoredValue('projects')) as Array<{
      children: Array<{ id: string; chapterNumber: string; projectTitle: string }>
    }>

    expect(result.projectsAdded).toBe(1)
    expect(result.fontRecordsImported).toBe(1)
    expect(projects[0].children).toHaveLength(2)
    expect(projects[0].children[0]).toMatchObject({
      id: 'current-child',
      chapterNumber: '自定义一',
      projectTitle: '当前标题'
    })
    expect(projects[0].children[1].id).toBe('old-new')
    expect((await getStoredProjectMemory('current-child'))?.files.imported.status).toBe('done')
    expect(await getStoredProjectMemory('old-duplicate')).toBeNull()
    expect(await getStoredValue('psdStatusOverrides')).toEqual({
      'C:\\漫画\\龙珠\\001\\current.psd': 'done',
      'C:\\漫画\\龙珠\\002\\old.psd': 'pending'
    })
  })

  it('imports an application SQLite database and remaps memory to an existing project path', async () => {
    const sourcePath = resolve(DATABASE_ROOT, 'old-project.sqlite')
    const source = new DatabaseSync(sourcePath)
    source.exec(`
      CREATE TABLE key_value_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE project_memory (
        child_id TEXT PRIMARY KEY,
        folder_path TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE project_memory_files (
        child_id TEXT NOT NULL,
        path_key TEXT NOT NULL,
        path TEXT NOT NULL,
        status TEXT NOT NULL,
        mtime_ms REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (child_id, path_key)
      );
    `)
    source
      .prepare('INSERT INTO key_value_store (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(
        'projects',
        JSON.stringify([
          {
            id: 'current-parent',
            title: '迁移前旧名称',
            children: [
              {
                id: 'source-duplicate',
                folderPath: 'c:/漫画/龙珠/001',
                chapterNumber: '1',
                projectTitle: '不应覆盖'
              },
              {
                id: 'source-new',
                folderPath: 'C:\\漫画\\龙珠\\003',
                chapterNumber: '3',
                projectTitle: '第三集'
              }
            ]
          }
        ]),
        1
      )
    source
      .prepare('INSERT INTO key_value_store (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run('ui.childSortOrder', JSON.stringify('descending'), 1)
    const insertProject = source.prepare(
      'INSERT INTO project_memory (child_id, folder_path, updated_at) VALUES (?, ?, ?)'
    )
    insertProject.run('source-duplicate', 'C:\\漫画\\龙珠\\001', 10)
    insertProject.run('source-new', 'C:\\漫画\\龙珠\\003', 10)
    const insertFile = source.prepare(`
      INSERT INTO project_memory_files
        (child_id, path_key, path, status, mtime_ms, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    insertFile.run('source-duplicate', 'page-1', 'C:\\漫画\\龙珠\\001\\1.psd', 'done', 5, 10)
    insertFile.run('source-new', 'page-3', 'C:\\漫画\\龙珠\\003\\3.psd', 'pending', 5, 10)
    source.close()

    await setStoredValue('ui.childSortOrder', 'ascending')
    const result = await importLegacyJsonFiles([sourcePath])
    const projects = (await getStoredValue('projects')) as Array<{
      children: Array<{
        id: string
        parentTitle: string
        chapterNumber: string
        projectTitle: string
      }>
    }>

    expect(result.importedFiles).toBe(1)
    expect(result.projectsAdded).toBe(1)
    expect(await getStoredValue('ui.childSortOrder')).toBe('ascending')
    expect(projects[0].children[0]).toMatchObject({
      id: 'current-child',
      chapterNumber: '自定义一',
      projectTitle: '当前标题'
    })
    expect(projects[0].children.find((child) => child.id === 'source-new')).toMatchObject({
      parentTitle: '龙珠',
      chapterNumber: '3',
      projectTitle: '第三集'
    })
    expect((await getStoredProjectMemory('current-child'))?.files['page-1'].status).toBe('done')
    expect((await getStoredProjectMemory('source-new'))?.files['page-3'].status).toBe('pending')
  })

  /**
   * 2026-09-26 的现场：批量标记只改「校对」，却把 15 话 / 153 个文件的「监修」
   * 一起写成了 false。载荷里的 `modes` 是**补丁**（只带本次真正要改的模式），
   * 主进程必须与库里已有的值合并 —— 这条锁住那个合并。
   */
  it('memory statuses 按「补丁」合并：只改一个模式时不得动其它模式', async () => {
    const childId = 'patch-merge-child'
    const file = {
      pathKey: 'page',
      path: 'D:\\漫画\\补丁\\01.psd',
      mtimeMs: 1
    }
    await setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\补丁', [
      {
        ...file,
        status: 'pending',
        modes: { typeset: true, translated: false, proofread: true, supervised: true },
        modeTimestamps: { typeset: 100, proofread: 111, supervised: 222 }
      }
    ])

    // 补丁里**只**有 proofread —— 其余模式必须原样留着
    await setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\补丁', [
      {
        ...file,
        status: 'pending',
        modes: { proofread: false },
        modeTimestamps: { proofread: 0 }
      }
    ])

    const memory = await getStoredProjectMemory(childId)
    expect(memory?.files.page.modes).toEqual({
      typeset: true,
      translated: false,
      proofread: false,
      supervised: true
    })
    expect(memory?.files.page.modeTimestamps).toEqual({ typeset: 100, supervised: 222 })
  })

  it('完全没带 modes 的旧式写入，仍按 legacy status 推 typeset', async () => {
    const childId = 'legacy-status-child'
    await setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\旧式', [
      { pathKey: 'page', path: 'D:\\漫画\\旧式\\01.psd', status: 'done', mtimeMs: 1 }
    ])

    const memory = await getStoredProjectMemory(childId)
    expect(memory?.files.page.status).toBe('done')
    expect(memory?.files.page.modes?.typeset).toBe(true)
  })

  /**
   * 契约只有两种解读，这条把第二种钉死：**带了 modes 就是补丁**，哪怕是空对象。
   * `{}` = "什么都不改"，**不是**"用 status 推 typeset"。
   */
  it('空补丁 `modes: {}` 不改任何模式（包括 typeset）', async () => {
    const childId = 'empty-patch-child'
    await setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\空补丁', [
      {
        pathKey: 'page',
        path: 'D:\\漫画\\空补丁\\01.psd',
        status: 'pending',
        mtimeMs: 1,
        modes: { translated: true },
        modeTimestamps: { translated: 500 }
      }
    ])

    // 带空补丁 + status:'done' —— typeset 必须**保持原样**（不被 status 推成 true）
    await setStoredProjectMemoryStatuses(childId, 'D:\\漫画\\空补丁', [
      { pathKey: 'page', path: 'D:\\漫画\\空补丁\\01.psd', status: 'done', mtimeMs: 1, modes: {} }
    ])

    const memory = await getStoredProjectMemory(childId)
    expect(memory?.files.page.modes).toEqual({
      typeset: false,
      translated: true,
      proofread: false,
      supervised: false
    })
    expect(memory?.files.page.modeTimestamps).toEqual({ translated: 500 })
  })

  it('rejects the active or an incompatible SQLite database without changing current data', async () => {
    const incompatiblePath = resolve(DATABASE_ROOT, 'incompatible.sqlite')
    await writeFile(incompatiblePath, 'not a sqlite database', 'utf8')
    const projectsBefore = await getStoredValue('projects')

    const result = await importLegacyJsonFiles([databasePath(), incompatiblePath])

    expect(result.importedFiles).toBe(0)
    expect(result.skippedFiles).toBe(2)
    expect(result.warnings.some((warning) => warning.includes('当前正在使用'))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('不是兼容'))).toBe(true)
    expect(await getStoredValue('projects')).toEqual(projectsBefore)
  })

  it('allows retrying database initialization after a transient open failure', async () => {
    await closeDatabase()
    const blockedPath = resolve(DATABASE_ROOT, 'blocked-path')
    await writeFile(blockedPath, 'not a directory', 'utf8')
    activeDatabaseRoot = blockedPath

    await expect(getStoredValue('retry-check')).rejects.toBeTruthy()

    activeDatabaseRoot = DATABASE_ROOT
    await expect(getStoredValue('retry-check')).resolves.toBeUndefined()
  })
})

/**
 * `setStoredValueSync` —— **关闭期那条同步写**（2026-10-01 P4 第一步补的锁）。
 *
 * 为什么现在补：P4 把连接层搬到 `db/connection.ts` 时，这个函数是**唯一**必须改写的代码
 * （它原来直接用模块级 `databaseInstance`，搬完改用 `getDatabaseSync()`）。
 * 按老规矩做变异验证 —— 让 `getDatabaseSync()` 永远返回 null，结果**一条都没红**：
 * 说明这条路径当时**完全没有测试**。补上这两条，那条变异就会打红它们。
 */
describe('setStoredValueSync（关闭期不能 await 的那条同步写）', () => {
  it('库已打开时返回 true，而且真的写进去了', async () => {
    await getStoredValue('warm-up') // 触发懒打开
    expect(setStoredValueSync('ui.syncProbe', { ok: 1 })).toBe(true)
    expect(await getStoredValue('ui.syncProbe')).toEqual({ ok: 1 })
  })

  it('没有连接时返回 false，不抛（关闭期写失败只是"没写成"，不该炸）', async () => {
    await closeDatabase()
    expect(setStoredValueSync('ui.syncProbe', { ok: 2 })).toBe(false)
  })
})
