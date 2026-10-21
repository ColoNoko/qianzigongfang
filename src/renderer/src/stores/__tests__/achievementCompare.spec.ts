// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ChildMarkStatistics } from '@shared/ipc-api'
import { ACHIEVEMENT_PROFILE_STORAGE_KEY } from '@shared/achievement-profile'
import { useAchievementsStore } from '../achievements'
import { useAchievementCompareStore } from '../achievementCompare'

function emptyCompletedTimestamps(): ChildMarkStatistics['completedTimestamps'] {
  return { typeset: [], translated: [], proofread: [], supervised: [] }
}

function makeStore(): ReturnType<typeof useAchievementCompareStore> {
  setActivePinia(createPinia())
  return useAchievementCompareStore()
}

function validModes(): Record<string, unknown> {
  return {
    typeset: { total: 1, monthly: [{ month: '2026-09', count: 1, projectCount: 0 }] },
    translated: { total: 0, monthly: [] },
    proofread: { total: 0, monthly: [] },
    supervised: { total: 0, monthly: [] }
  }
}

function exportText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 'qianzi-achievements',
    schemaVersion: 1,
    appVersion: '9.9.9',
    exportedAt: '2026-10-05T00:00:00.000Z',
    profile: { nickname: '对手', duty: 'proofread' },
    modes: validModes(),
    ...overrides
  })
}

describe('achievementCompare store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('load：合法列表进 store，坏条目被共享层清洗掉', async () => {
    const store = makeStore()
    window.comicType = {
      storeGet: vi.fn().mockResolvedValue([
        { id: 'a', name: '阿花', importedAt: 1, duty: 'typeset', modes: validModes() },
        { id: 'bad', modes: null }
      ]),
      storeSet: vi.fn().mockResolvedValue(undefined)
    } as unknown as typeof window.comicType

    await store.load()

    expect(store.profiles.map((p) => p.id)).toEqual(['a'])
    expect(store.loaded).toBe(true)
  })

  it('importFromFile：成功导入并落库，档案里没有 folderPath', async () => {
    const store = makeStore()
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      achievementImportFile: vi.fn().mockResolvedValue({
        canceled: false,
        path: 'D:/对手.json',
        text: exportText()
      }),
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet
    } as unknown as typeof window.comicType

    const result = await store.importFromFile()

    expect(result.status).toBe('imported')
    if (result.status !== 'imported') return
    expect(result.profile.name).toBe('对手')
    expect(result.profile.duty).toBe('proofread')
    expect(JSON.stringify(result.profile)).not.toContain('folderPath')
    expect(storeSet.mock.calls[0][0]).toBe(ACHIEVEMENT_PROFILE_STORAGE_KEY)
  })

  /**
   * 回归锁（2026-10-05 现场：一导入就弹「页面加载失败 / An object could not be cloned.」）。
   *
   * 根因是把 Pinia 的**响应式数组**直接塞进了 `storeSet`。这里锁两件事：
   *   ① 载荷能过结构化克隆（响应式代理过不了 → 这条会红）；
   *   ② 载荷不是 store 里那个响应式数组本身（摊平过了）。
   */
  it('落库载荷必须是普通对象：能过结构化克隆，且不是响应式数组本身', async () => {
    const store = makeStore()
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      achievementImportFile: vi.fn().mockResolvedValue({
        canceled: false,
        path: 'D:/对手.json',
        text: exportText()
      }),
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet
    } as unknown as typeof window.comicType

    await store.importFromFile()

    const payload = storeSet.mock.calls[0][1]
    expect(() => structuredClone(payload), '载荷过不了结构化克隆（又是响应式代理）').not.toThrow()
    expect(payload).not.toBe(store.profiles)
    // 摊平后仍然是同样的内容
    expect(payload).toEqual([expect.objectContaining({ name: '对手', duty: 'proofread' })])
  })

  it('重命名 / 删除也要摊平后再落库（同一条锁，别只修导入这一条路）', async () => {
    const store = makeStore()
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet
    } as unknown as typeof window.comicType

    await store.load()
    store.profiles.push({
      id: 'a',
      name: '阿花',
      importedAt: 1,
      duty: null,
      modes: JSON.parse(JSON.stringify(validModes())) as never
    })

    expect(await store.renameProfile('a', '新名字')).toBe(true)
    const renamePayload = storeSet.mock.calls[0][1]
    expect(() => structuredClone(renamePayload)).not.toThrow()
    expect(renamePayload).not.toBe(store.profiles)

    expect(await store.removeProfile('a')).toBe(true)
    const removePayload = storeSet.mock.calls[1][1]
    expect(() => structuredClone(removePayload)).not.toThrow()
  })

  it('load：读取失败不抛错、当成空列表（页面不该被一条坏数据打死）', async () => {
    const store = makeStore()
    window.comicType = {
      storeGet: vi.fn().mockRejectedValue(new Error('库炸了')),
      storeSet: vi.fn().mockResolvedValue(undefined)
    } as unknown as typeof window.comicType

    await expect(store.load()).resolves.toBeUndefined()
    expect(store.profiles).toEqual([])
    expect(store.loaded).toBe(true)
  })

  it('importFromFile：不是 JSON → 报错不落库', async () => {
    const store = makeStore()
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      achievementImportFile: vi.fn().mockResolvedValue({ canceled: false, text: '{ 不是 json' }),
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet
    } as unknown as typeof window.comicType

    const result = await store.importFromFile()

    expect(result).toEqual({ status: 'error', message: '文件不是有效的 JSON' })
    expect(storeSet).not.toHaveBeenCalled()
    expect(store.profiles).toHaveLength(0)
  })

  it('importFromFile：格式不对 → 报错不落库', async () => {
    const store = makeStore()
    window.comicType = {
      achievementImportFile: vi.fn().mockResolvedValue({
        canceled: false,
        text: exportText({ format: '别的格式' })
      }),
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet: vi.fn().mockResolvedValue(undefined)
    } as unknown as typeof window.comicType

    const result = await store.importFromFile()

    expect(result).toEqual({ status: 'error', message: '这不是汉化工坊的成就数据文件' })
  })

  it('importFromFile：用户取消 → canceled', async () => {
    const store = makeStore()
    window.comicType = {
      achievementImportFile: vi.fn().mockResolvedValue({ canceled: true }),
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet: vi.fn().mockResolvedValue(undefined)
    } as unknown as typeof window.comicType

    const result = await store.importFromFile()
    expect(result).toEqual({ status: 'canceled' })
  })

  it('exportMine：用标记记录组装脱敏档案并交给主进程，且记住自己的职责', async () => {
    const store = makeStore()
    const achievements = useAchievementsStore()
    achievements.statistics = [
      {
        childId: 'c1',
        folderPath: '/私密路径/某作品',
        fileCount: 1,
        completedTimestamps: {
          ...emptyCompletedTimestamps(),
          typeset: [new Date('2026-09-01T12:00:00+08:00').getTime()]
        }
      }
    ]

    const exportFile = vi.fn().mockResolvedValue({ saved: true, path: 'D:/导出.json' })
    window.comicType = {
      achievementExportFile: exportFile,
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet: vi.fn().mockResolvedValue(undefined)
    } as unknown as typeof window.comicType

    const result = await store.exportMine('小明', 'typeset')

    expect(result).toEqual({ status: 'saved', path: 'D:/导出.json' })
    expect(store.selfDuty).toBe('typeset')
    const payload = exportFile.mock.calls[0][0] as Record<string, unknown>
    expect(JSON.stringify(payload)).not.toContain('/私密路径')
    expect(JSON.stringify(payload)).not.toContain('folderPath')
    const modes = payload.modes as Record<string, { total: number }>
    expect(modes.typeset.total).toBe(1)
  })

  /**
   * 「从对方的数据库文件导入」（2026-10-05 用户拍板 A 方案）：
   * 对方是老版本 / 0.4.0 分支、没有导出功能时，拷一个 .sqlite 过来就行。
   */
  it('importFromDatabase：只读对方的库 → 变成一份脱敏档案（名字取文件名）', async () => {
    const store = makeStore()
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      achievementImportDatabase: vi.fn().mockResolvedValue({
        canceled: false,
        path: 'D:\\备份\\逗比.sqlite',
        statistics: [
          {
            childId: 'x',
            folderPath: 'D:\\秘密\\某作品',
            fileCount: 2,
            completedTimestamps: {
              ...emptyCompletedTimestamps(),
              translated: [
                new Date('2026-09-01T12:00:00+08:00').getTime(),
                new Date('2026-09-02T12:00:00+08:00').getTime()
              ]
            }
          }
        ]
      }),
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet
    } as unknown as typeof window.comicType

    const result = await store.importFromDatabase()

    expect(result.status).toBe('imported')
    if (result.status !== 'imported') return
    expect(result.profile.name).toBe('逗比')
    expect(result.profile.modes.translated.total).toBe(2)
    // 只变成数字：对方的路径绝不进本地档案
    expect(JSON.stringify(result.profile)).not.toContain('秘密')
    expect(() => structuredClone(storeSet.mock.calls[0][1])).not.toThrow()
  })

  it('importFromDatabase：库里没有任何标记 → 明确报错，不落一份全 0 的档案', async () => {
    const store = makeStore()
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      achievementImportDatabase: vi.fn().mockResolvedValue({
        canceled: false,
        path: 'D:\\备份\\空的.sqlite',
        statistics: []
      }),
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet
    } as unknown as typeof window.comicType

    const result = await store.importFromDatabase()

    expect(result).toEqual({
      status: 'error',
      message: '这份库里没有任何标记记录（他是不是还没开始做？）'
    })
    expect(store.profiles).toHaveLength(0)
    expect(storeSet).not.toHaveBeenCalled()
  })

  it('importFromDatabase：不是数据库 → 把主进程的报错原样带出来', async () => {
    const store = makeStore()
    window.comicType = {
      achievementImportDatabase: vi.fn().mockResolvedValue({
        canceled: false,
        path: 'D:\\备份\\照片.jpg',
        error: '这不是汉化工坊的数据库（找不到标记记录表）'
      }),
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet: vi.fn().mockResolvedValue(undefined)
    } as unknown as typeof window.comicType

    expect(await store.importFromDatabase()).toEqual({
      status: 'error',
      message: '这不是汉化工坊的数据库（找不到标记记录表）'
    })
  })

  it('importFromDatabase：用户取消 → canceled', async () => {
    const store = makeStore()
    window.comicType = {
      achievementImportDatabase: vi.fn().mockResolvedValue({ canceled: true }),
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet: vi.fn().mockResolvedValue(undefined)
    } as unknown as typeof window.comicType

    expect(await store.importFromDatabase()).toEqual({ status: 'canceled' })
  })
})
