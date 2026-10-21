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
  saveProjectChanges,
  saveProjectTree,
  reclaimChildPath,
  recordChildContentFingerprint,
  saveChildProgress,
  setParentDuties,
  setParentSourceRoots,
  setProjectSourceRoot,
  updateProjectTree
} from '../project-repository'
import type { ParentProject } from '@shared/types'

const CORRUPT = '{ 这不是合法 JSON'

it('merges an edit without losing concurrently added chapters, duties or newer progress', async () => {
  const before: ParentProject[] = [{id:'p',title:'book',lastMtimeMs:1,children:[{id:'c',parentTitle:'book',folderPath:'C:/book/1',chapterNumber:'1',projectTitle:'old',lastMtimeMs:1}]}]
  const latest = structuredClone(before)
  latest[0].duties = ['proofread']
  latest[0].children[0].lastMtimeMs = 99
  latest[0].children.push({...latest[0].children[0], id:'background', folderPath:'C:/book/2'})
  await writeRawProjects(JSON.stringify(latest))
  const after = structuredClone(before); after[0].children[0].projectTitle = 'edited'
  const merged = await saveProjectChanges(before, after)
  expect(merged[0].children.map(child=>child.id).sort()).toEqual(['background','c'])
  expect(merged[0].children.find(child=>child.id==='c')).toMatchObject({projectTitle:'edited',lastMtimeMs:99})
  expect(merged[0].duties).toEqual(['proofread'])
})

it('rejects a stale edit of a deleted chapter instead of resurrecting it', async () => {
  const before: ParentProject[] = [{id:'p',title:'book',lastMtimeMs:0,children:[{id:'c',parentTitle:'book',folderPath:'C:/book/1',chapterNumber:'1',projectTitle:'old',lastMtimeMs:0}]}]
  const after=structuredClone(before);after[0].children[0].projectTitle='edited'
  await writeRawProjects('[]')
  await expect(saveProjectChanges(before,after)).rejects.toThrow(/已被删除/)
  expect(await getProjectTree()).toEqual([])
})

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
  it('拒绝损坏的整树保存和编辑快照，保留原有项目', async () => {
    const original = '[{"id":"p","title":"书","children":[]}]'
    await writeRawProjects(original)
    await expect(saveProjectTree([null] as unknown as ParentProject[])).rejects.toThrow('格式损坏')
    await expect(saveProjectChanges([null] as unknown as ParentProject[], [])).rejects.toThrow('格式损坏')
    expect(await readRawProjects()).toBe(original)
  })
  it.each(['[null]', '[{"id":"p","title":"书","children":[null]}]', '[{"id":"p","title":"书","children":{}}]'])('拒绝损坏的嵌套条目并保留原值：%s', async (raw) => {
    await writeRawProjects(raw)
    await expect(getProjectTree()).rejects.toThrow('项目清单格式损坏')
    await expect(updateProjectTree(() => undefined)).rejects.toThrow()
    expect(await readRawProjects()).toBe(raw)
  })
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
    await writeRawProjects(JSON.stringify([{ id, title: '鹅妈妈', lastMtimeMs: 0, children: [] }]))
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
    // 无效选择规范化为显式空职责，不能在加载时重新推断。
    expect(await dutiesOf('p-clean')).toEqual([])
  })

  it('空数组 = 显式无职责：落库和重新打开数据库后都保留', async () => {
    await seedParent('p-clear')
    await setParentDuties('p-clear', ['typeset'])
    expect(await dutiesOf('p-clear')).toEqual(['typeset'])

    await setParentDuties('p-clear', [])
    const raw = await readRawProjects()
    expect(JSON.parse(raw!)[0].duties).toEqual([])
    await closeDatabase()
    expect(await dutiesOf('p-clear')).toEqual([])
  })

  it('父级不存在 → 抛错（不许静默"什么都没改还报成功"），且什么都不动', async () => {
    await seedParent('p-only')
    const before = await readRawProjects()
    await expect(setParentDuties('p-missing', ['typeset'])).rejects.toThrow('父级不存在')
    expect(await readRawProjects()).toEqual(before)
  })
})

/**
 * 父级"记住的扫描根"（`sourceRoots` + 旧字段 `sourceRoot`）—— 2026-10-05。
 *
 * 为什么这一组值得单独一片锁：**两个字段是同一件事的两本账**。
 * `sourceRoots` 是主字段（多根自检靠它），`sourceRoot` 是旧版单根字段（旧读取方只认它）。
 * 收敛前只有一条"写单个根"的通道，而且它**只改旧字段** ——
 * 于是自检弹窗那条「记住此目录并检测」在"检测到 0 个新章节 / 检测失败"这类
 * **提前退出**的路上会留下半截状态：新选的目录写进了旧字段，`sourceRoots` 里
 * 几个旧根还在，而读取时是 `[...sourceRoots, sourceRoot]` 拼起来 —— **旧根排在前、
 * 照样被扫**，用户以为已经换掉了（这是读代码时发现的，不是现场事故）。
 */
describe('父级"记住的扫描根"：两个字段必须一起写', () => {
  async function seedParent(id: string): Promise<void> {
    await writeRawProjects(JSON.stringify([{ id, title: '搬砖', lastMtimeMs: 0, children: [] }]))
  }

  async function rootsOf(id: string): Promise<{ sourceRoots?: string[]; sourceRoot?: string }> {
    const parent = (await getProjectTree()).find((item) => item.id === id)
    return { sourceRoots: parent?.sourceRoots, sourceRoot: parent?.sourceRoot }
  }

  it('写多个根：sourceRoots 落库、sourceRoot 同步成第一个（旧读取方跟着走）', async () => {
    await seedParent('p-roots')
    await setParentSourceRoots('p-roots', ['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有'])

    expect(await rootsOf('p-roots')).toEqual({
      sourceRoots: ['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有'],
      sourceRoot: 'D:\\漫画库\\作品\\无'
    })
  })

  it('只记住一个新目录时，旧的那些根必须被**替换**掉（不许新旧混在一本账里）', async () => {
    await seedParent('p-replace')
    await setParentSourceRoots('p-replace', ['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有'])
    await setParentSourceRoots('p-replace', ['E:\\搬砖\\有'])

    const roots = await rootsOf('p-replace')
    expect(roots.sourceRoots).toEqual(['E:\\搬砖\\有'])
    expect(roots.sourceRoot).toBe('E:\\搬砖\\有')
    // 旧根不许在任何一个字段里留下痕迹
    expect(JSON.stringify(roots)).not.toContain('作品')
  })

  it('旧的单根通道（自检弹窗的「记住此目录」）也写一对：不再留半截状态', async () => {
    await seedParent('p-legacy')
    await setParentSourceRoots('p-legacy', ['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有'])

    // 这条就是"检测到 0 个新章节"那条提前退出的路上会调的那一步。
    await setProjectSourceRoot('p-legacy', 'E:\\搬砖\\有')

    const roots = await rootsOf('p-legacy')
    expect(roots.sourceRoots, '旧根还留在主字段里 ⇒ 下次自动检测会继续扫旧根').toEqual([
      'E:\\搬砖\\有'
    ])
    expect(roots.sourceRoot).toBe('E:\\搬砖\\有')
  })

  it('传 null / 空数组 = 恢复自动推导：两个字段都删掉（不留空数组）', async () => {
    await seedParent('p-clear-roots')
    await setParentSourceRoots('p-clear-roots', ['D:\\漫画库\\作品\\无'])
    await setParentSourceRoots('p-clear-roots', null)

    const raw = await readRawProjects()
    expect(raw).not.toContain('sourceRoot')
    expect(await rootsOf('p-clear-roots')).toEqual({
      sourceRoots: undefined,
      sourceRoot: undefined
    })

    // 空数组与 null 同义（两条通道都可能传空数组上来）
    await setParentSourceRoots('p-clear-roots', ['D:\\漫画库\\作品\\无'])
    await setParentSourceRoots('p-clear-roots', [])
    expect(await readRawProjects()).not.toContain('sourceRoot')
  })

  it('垃圾值 / 空串 / 纯空白：洗掉；重复的按"路径当 key"去重且保留第一次的写法', async () => {
    await seedParent('p-clean-roots')
    await setParentSourceRoots('p-clean-roots', [
      '  D:\\漫画库\\作品\\无  ',
      'd:/漫画库/作品/无/', // 与上一条是同一个目录（大小写 + 尾斜杠）
      42 as unknown as string,
      '',
      '   ',
      'D:\\漫画库\\作品\\有'
    ])

    expect(await rootsOf('p-clean-roots')).toEqual({
      sourceRoots: ['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有'],
      sourceRoot: 'D:\\漫画库\\作品\\无'
    })
  })

  it('全部洗干净之后什么都没有 ⇒ 等于恢复自动推导（删字段，不写空数组）', async () => {
    await seedParent('p-all-junk')
    await setParentSourceRoots('p-all-junk', ['  ', 7 as unknown as string])
    expect(await readRawProjects()).not.toContain('sourceRoot')
  })

  it('父级不存在 → 抛错，库里一个字节都不动', async () => {
    await seedParent('p-exists')
    const before = await readRawProjects()
    await expect(setParentSourceRoots('p-missing', ['D:\\漫画库\\作品\\无'])).rejects.toThrow(
      '父级不存在'
    )
    expect(await readRawProjects()).toEqual(before)
  })
})

/**
 * 「认领」（2026-10-05，R2）—— 本地文件夹改名后的恢复通道。
 *
 * 为什么**不能**用"删旧建新"实现：`deleteChildren` 会连带 `removeStoredProjectMemory`，
 * 也就是把这一话盖过的章一起删掉。所以认领必须是"只换门牌"这一条独立通道。
 */
describe('认领：换门牌只动 folderPath', () => {
  async function seed(id: string): Promise<void> {
    await writeRawProjects(
      JSON.stringify([
        {
          id,
          title: '作品',
          lastMtimeMs: 0,
          children: [
            {
              id: 'c1',
              parentTitle: '作品',
              folderPath: 'D:\\漫画库\\旧名字',
              chapterNumber: '19',
              projectTitle: '旧名字',
              lastMtimeMs: 123
            },
            {
              id: 'c2',
              parentTitle: '作品',
              folderPath: 'D:\\漫画库\\另一话',
              chapterNumber: '20',
              projectTitle: '另一话',
              lastMtimeMs: 456
            }
          ]
        }
      ])
    )
  }

  it('只改 folderPath —— childId / 集数 / 标题 / 其它话逐字节不变', async () => {
    await seed('p-reclaim')
    const before = JSON.parse((await readRawProjects())!) as Array<{
      children: Array<Record<string, unknown>>
    }>

    await reclaimChildPath('p-reclaim', 'c1', 'D:\\漫画库\\新名字')

    const after = JSON.parse((await readRawProjects())!) as typeof before
    // 把新路径换回旧值，两份必须**逐字节相同** ⇒ 证明只动了这一个字段
    after[0].children[0].folderPath = before[0].children[0].folderPath
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))

    const child = (await getProjectTree())[0].children[0]
    expect(child.folderPath).toBe('D:\\漫画库\\新名字')
    expect(child.id).toBe('c1')
    expect(child.chapterNumber).toBe('19')
    expect(child.projectTitle).toBe('旧名字')
    expect(child.lastMtimeMs).toBe(123)
  })

  it('新路径已被别的话占用 ⇒ 抛错，一个字节都不动', async () => {
    await seed('p-taken')
    const before = await readRawProjects()

    await expect(reclaimChildPath('p-taken', 'c1', 'D:\\漫画库\\另一话')).rejects.toThrow(
      '已经登记在别的话上'
    )
    expect(await readRawProjects()).toEqual(before)
  })

  it('那一话不在这个父级里 / 父级不存在 / 路径为空 ⇒ 抛错，什么都不动', async () => {
    await seed('p-missing')
    const before = await readRawProjects()

    await expect(reclaimChildPath('p-missing', 'c-nope', 'D:\\漫画库\\新名字')).rejects.toThrow()
    await expect(reclaimChildPath('p-nope', 'c1', 'D:\\漫画库\\新名字')).rejects.toThrow(
      '父级不存在'
    )
    await expect(reclaimChildPath('p-missing', 'c1', '   ')).rejects.toThrow('是空的')
    expect(await readRawProjects()).toEqual(before)
  })
})

describe('记录内容指纹（R1，改名认领的比对基准）', () => {
  async function seed(id: string): Promise<void> {
    await writeRawProjects(
      JSON.stringify([
        {
          id,
          title: '作品',
          lastMtimeMs: 0,
          children: [
            {
              id: 'c1',
              parentTitle: '作品',
              folderPath: 'D:\\漫画库\\第1話',
              chapterNumber: '1',
              projectTitle: '第1話',
              lastMtimeMs: 0
            }
          ]
        }
      ])
    )
  }

  it('按路径找到那一话并记下指纹', async () => {
    await seed('p-fingerprint')
    await recordChildContentFingerprint('D:\\漫画库\\第1話', 'abc123')
    expect((await getProjectTree())[0].children[0].contentFingerprint).toBe('abc123')
  })

  it('指纹没变 ⇒ 一个字节都不写（省掉一次无谓的整树写回）', async () => {
    await seed('p-fingerprint-same')
    await recordChildContentFingerprint('D:\\漫画库\\第1話', 'abc123')
    const before = await readRawProjects()

    await recordChildContentFingerprint('D:\\漫画库\\第1話', 'abc123')

    expect(await readRawProjects()).toEqual(before)
  })

  it('路径对不上任何话 ⇒ 什么都不做（不新建、不改写）', async () => {
    await seed('p-fingerprint-miss')
    const before = await readRawProjects()

    await recordChildContentFingerprint('D:\\漫画库\\别的目录', 'abc123')

    expect(await readRawProjects()).toEqual(before)
  })
})

/**
 * 并发安全的章节保存（2026-10-05 从并行分支 T6 移植）。
 *
 * 主线以前「导入 / 编辑话」走 `saveProjectTree` 整树覆盖：渲染层快照改完整份写回，
 * 中间别的操作动了树就被旧快照抹掉。这两条锁的是它最要命的两个场景。
 */
describe('saveProjectChanges：只合并本次的章节改动', () => {
  it('编辑一条话时不丢后台并发加入的章节、职责与更新的进度', async () => {
    const before: ParentProject[] = [
      {
        id: 'p',
        title: 'book',
        lastMtimeMs: 1,
        children: [
          {
            id: 'c',
            parentTitle: 'book',
            folderPath: 'C:/book/1',
            chapterNumber: '1',
            projectTitle: 'old',
            lastMtimeMs: 1
          }
        ]
      }
    ]
    // 渲染层保存的同时，"别人"在库里加了职责、更新了进度、还后台导入了一话。
    const latest = structuredClone(before)
    latest[0].duties = ['proofread']
    latest[0].children[0].lastMtimeMs = 99
    latest[0].children.push({ ...latest[0].children[0], id: 'background', folderPath: 'C:/book/2' })
    await writeRawProjects(JSON.stringify(latest))

    const after = structuredClone(before)
    after[0].children[0].projectTitle = 'edited'
    const merged = await saveProjectChanges(before, after)

    // 后台加入的那一话还在；本次编辑生效；别人的进度与职责原样保留
    expect(merged[0].children.map((child) => child.id).sort()).toEqual(['background', 'c'])
    expect(merged[0].children.find((child) => child.id === 'c')).toMatchObject({
      projectTitle: 'edited',
      lastMtimeMs: 99
    })
    expect(merged[0].duties).toEqual(['proofread'])
  })

  it('旧快照去编辑一条已被删除的章节 ⇒ 拒绝，而不是把它复活', async () => {
    const before: ParentProject[] = [
      {
        id: 'p',
        title: 'book',
        lastMtimeMs: 0,
        children: [
          {
            id: 'c',
            parentTitle: 'book',
            folderPath: 'C:/book/1',
            chapterNumber: '1',
            projectTitle: 'old',
            lastMtimeMs: 0
          }
        ]
      }
    ]
    const after = structuredClone(before)
    after[0].children[0].projectTitle = 'edited'
    await writeRawProjects('[]')

    await expect(saveProjectChanges(before, after)).rejects.toThrow(/已被删除/)
    expect(await getProjectTree()).toEqual([])
  })
})

it('recovers bracket chapter numbers without replacing manual numbers', async () => {
  const children = ['02', '03'].map((n, i) => ({id:n, parentTitle:'book', folderPath:`C:/book/[${n}]`, chapterNumber:i ? '特别篇' : '', projectTitle:`[${n}]`, lastMtimeMs:0}))
  await writeRawProjects(JSON.stringify([{id:'p',title:'book',lastMtimeMs:0,children}]))
  expect((await getProjectTree())[0].children.map(c => c.chapterNumber)).toEqual(['2','特别篇'])
})
