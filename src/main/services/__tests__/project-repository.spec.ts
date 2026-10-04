// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * 项目清单（`key_value_store['projects']`）坏掉时，**不许把它当空树写回**
 * （2026-09-30 审查 high）。
 *
 * 现场逻辑：`readProjectTree()` 解析失败时 `return []`，而 `updateProjectTree()`
 * 在 mutator 之后**无条件** `writeProjectTree(...)`。于是只要那格 JSON 坏过一次
 * （SQLite 行损坏、旧格式、外部写入非数组），**下一次任何更新**（扫描/标记后必然
 * 会跑的 `saveChildProgress`、重命名、删除、排序）就会把 `[]` 落库 ——
 * 侧栏所有父级与章节一起消失，原始内容不留档、全程无提示。
 *
 * 这里锁：解析失败 → 拒绝写入 + 原值原样保留 + 另存一份 `projects.corrupt.<ts>`
 * 取证；同时**空数组仍然是合法的**（"真的没有项目"不能被误判成"读不出来"）。
 */
const ROOT = resolve(__dirname, '../../../../.omo/fixtures/project-repository-test')

vi.mock('electron', () => ({
  app: { getPath: () => ROOT }
}))

import { closeDatabase, getDatabase, getStoredValue } from '../database'
import {
  getProjectTree,
  saveChildProgress,
  setParentDuties,
  updateProjectTree
} from '../project-repository'
import type { ParentProject } from '@shared/types'

const CORRUPT = '{ 这不是合法 JSON'

async function writeRawProjects(raw: string): Promise<void> {
  const database = await getDatabase()
  database
    .prepare(
      `INSERT INTO key_value_store (key, value_json, updated_at) VALUES ('projects', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(raw, Date.now())
}

async function readRawProjects(): Promise<string | undefined> {
  const database = await getDatabase()
  const row = database
    .prepare(`SELECT value_json FROM key_value_store WHERE key = 'projects'`)
    .get() as { value_json?: string } | undefined
  return row?.value_json
}

async function corruptBackupKeys(): Promise<string[]> {
  const database = await getDatabase()
  return (
    database
      .prepare(`SELECT key FROM key_value_store WHERE key LIKE 'projects.corrupt.%'`)
      .all() as Array<{ key: string }>
  ).map((row) => row.key)
}

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true })
  await mkdir(ROOT, { recursive: true })
})

afterAll(async () => {
  await closeDatabase()
  await rm(ROOT, { recursive: true, force: true })
})

describe('项目清单损坏时拒绝写回', () => {
  it('解析失败 → updateProjectTree 拒绝、原值原样保留、另存一份取证', async () => {
    await writeRawProjects(CORRUPT)

    await expect(updateProjectTree((projects) => projects.length)).rejects.toThrow()
    // 真实触发点：扫描/标记之后必然跑的这条
    await expect(saveChildProgress([{ childId: 'c1', lastMtimeMs: 1 }])).rejects.toThrow()

    // 关键：库里那格没有被写成 '[]'
    expect(await readRawProjects()).toBe(CORRUPT)
    // 而且留了取证
    expect(await corruptBackupKeys()).not.toHaveLength(0)
  })

  it('空数组是合法的：不写空树 ≠ 不许真的清空', async () => {
    await writeRawProjects('[]')

    await updateProjectTree((projects) => {
      projects.push({
        id: 'p1',
        title: '新父级',
        lastMtimeMs: 0,
        children: []
      } as ParentProject)
    })

    expect((await getProjectTree()).map((parent) => parent.id)).toEqual(['p1'])
    expect(await getStoredValue('projects')).toBeTruthy()
  })
})

/**
 * 父级"职责"（2026-10-03）。
 *
 * 职责是漫画（父级）上的 1~2 个模式，写进项目清单那一格。规则与
 * `shared/duties.ts` 共用一份，但**主进程是公开边界，必须自己再洗一遍**：
 * 渲染层洗过不代表这里可以信任（同 renameParent 的口径）。
 */
describe('父级职责：写入前必须洗一遍', () => {
  async function seedParent(id: string): Promise<void> {
    await writeRawProjects(
      JSON.stringify([
        { id, title: '鹅妈妈', lastMtimeMs: 0, children: [] }
      ])
    )
  }

  async function dutiesOf(id: string): Promise<unknown> {
    return (await getProjectTree()).find((parent) => parent.id === id)?.duties
  }

  it('存 1 个 / 2 个都能读回来，且按规范顺序（嵌 → 翻 → 校 → 监）', async () => {
    await seedParent('p-duties')
    await setParentDuties('p-duties', ['supervised'])
    expect(await dutiesOf('p-duties')).toEqual(['supervised'])

    await setParentDuties('p-duties', ['supervised', 'proofread'])
    expect(await dutiesOf('p-duties')).toEqual(['proofread', 'supervised'])
  })

  it('超两个 / 重复 / 垃圾值：洗掉，不报错也不写进库', async () => {
    await seedParent('p-clean')
    await setParentDuties('p-clean', [
      'typeset',
      'translated',
      'proofread'
    ] as unknown as import('@shared/types').WorkMode[])
    expect(await dutiesOf('p-clean')).toEqual(['typeset', 'translated'])

    await setParentDuties('p-clean', ['校对'] as unknown as import('@shared/types').WorkMode[])
    // 垃圾值洗成"空职责" = 没声明过 ⇒ 字段被删掉，读回来是 undefined（不是空数组）
    expect(await dutiesOf('p-clean')).toBeUndefined()
  })

  it('空数组 = 清空：字段直接删掉，不留一个空数组在库里', async () => {
    await seedParent('p-clear')
    await setParentDuties('p-clear', ['typeset'])
    expect(await dutiesOf('p-clear')).toEqual(['typeset'])

    await setParentDuties('p-clear', [])
    const raw = await readRawProjects()
    expect(raw).not.toContain('duties')
  })

  it('父级不存在 → 抛错（不许静默"什么都没改还报成功"），且什么都不动', async () => {
    await seedParent('p-only')
    const before = await readRawProjects()
    await expect(setParentDuties('p-missing', ['typeset'])).rejects.toThrow('父级不存在')
    expect(await readRawProjects()).toEqual(before)
  })
})
