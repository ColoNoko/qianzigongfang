import { describe, expect, it } from 'vitest'
import type { ChildMarkStatistics } from '../ipc-api'
import {
  ACHIEVEMENT_FORMAT,
  ACHIEVEMENT_SCHEMA_VERSION,
  aggregateModePayload,
  aggregateModesPayload,
  buildExportPayload,
  normalizeDuty,
  normalizeNickname,
  normalizeStoredProfiles,
  parseAchievementPayload,
  profileNameFromFilePath,
  toStoredProfiles
} from '../achievement-profile'

function emptyCompletedTimestamps(): ChildMarkStatistics['completedTimestamps'] {
  return { typeset: [], translated: [], proofread: [], supervised: [] }
}

function child(partial: Partial<ChildMarkStatistics> & { childId: string }): ChildMarkStatistics {
  return {
    folderPath: `/c/${partial.childId}`,
    fileCount: 0,
    completedTimestamps: emptyCompletedTimestamps(),
    ...partial
  }
}

function at(iso: string): number {
  return new Date(`${iso}T12:00:00+08:00`).getTime()
}

function makeStatistics(): ChildMarkStatistics[] {
  return [
    child({
      childId: 'c1',
      fileCount: 2,
      completedTimestamps: {
        ...emptyCompletedTimestamps(),
        typeset: [at('2026-09-01'), at('2026-09-02')],
        translated: [at('2026-09-03')]
      }
    }),
    child({
      childId: 'c2',
      fileCount: 1,
      completedTimestamps: { ...emptyCompletedTimestamps(), typeset: [at('2026-08-10')] }
    })
  ]
}

describe('achievement-profile 导出', () => {
  it('聚合只包含纯数字：没有 folderPath / 项目名', () => {
    const payload = buildExportPayload(
      makeStatistics(),
      '小明',
      'translated',
      // 故意用一个不可能被当成"当前版本"的假版本号
      '9.9.9',
      at('2026-10-05')
    )

    const json = JSON.stringify(payload)
    expect(json).not.toContain('/c/')
    expect(json).not.toContain('folderPath')

    expect(payload.format).toBe(ACHIEVEMENT_FORMAT)
    expect(payload.schemaVersion).toBe(ACHIEVEMENT_SCHEMA_VERSION)
    expect(payload.profile.nickname).toBe('小明')
    expect(payload.profile.duty).toBe('translated')
    expect(payload.modes.typeset.total).toBe(3)
    expect(payload.modes.translated.total).toBe(1)
    expect(payload.modes.proofread.total).toBe(0)
    expect(payload.modes.typeset.monthly).toEqual([
      { month: '2026-08', count: 1, projectCount: 1 },
      { month: '2026-09', count: 2, projectCount: 1 }
    ])
  })

  it('四个模式各自独立聚合，互不串门', () => {
    const modes = aggregateModesPayload(makeStatistics())
    expect(modes.typeset.total).toBe(3)
    expect(modes.translated.total).toBe(1)
    expect(modes.proofread.total).toBe(0)
    expect(modes.supervised.total).toBe(0)
    expect(aggregateModePayload(makeStatistics(), 'proofread').monthly).toEqual([])
  })

  it('昵称去空白、超长截断、空值回落"未署名"', () => {
    expect(normalizeNickname('  阿花  ')).toBe('阿花')
    expect(normalizeNickname('')).toBe('未署名')
    expect(normalizeNickname(null)).toBe('未署名')
    expect(normalizeNickname('x'.repeat(100)).length).toBe(40)
  })

  it('主职责只认四个已知模式', () => {
    expect(normalizeDuty('typeset')).toBe('typeset')
    expect(normalizeDuty('translated')).toBe('translated')
    expect(normalizeDuty('garbage')).toBeNull()
    expect(normalizeDuty(undefined)).toBeNull()
  })
})

describe('achievement-profile 导入解析', () => {
  function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      format: ACHIEVEMENT_FORMAT,
      schemaVersion: ACHIEVEMENT_SCHEMA_VERSION,
      appVersion: '9.9.9',
      exportedAt: '2026-10-05T00:00:00.000Z',
      profile: { nickname: '对手', duty: 'proofread' },
      modes: {
        typeset: { total: 2, monthly: [{ month: '2026-09', count: 2, projectCount: 1 }] },
        translated: { total: 0, monthly: [] },
        proofread: { total: 1, monthly: [{ month: '2026-08', count: 1, projectCount: 1 }] },
        supervised: { total: 0, monthly: [] }
      },
      ...overrides
    }
  }

  it('合法文件 → 解析成功，未知字段被忽略（向前兼容）', () => {
    const result = parseAchievementPayload(payload({ futureField: { hello: 1 } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.profile.name).toBe('对手')
    expect(result.profile.duty).toBe('proofread')
    expect(result.profile.modes.typeset.total).toBe(2)
  })

  it('format 不对 → 拒绝', () => {
    const result = parseAchievementPayload({ ...payload(), format: '别的格式' })
    expect(result).toEqual({ ok: false, error: '这不是汉化工坊的成就数据文件' })
  })

  it('schemaVersion 主版本不兼容 → 拒绝并报版本', () => {
    const result = parseAchievementPayload(payload({ schemaVersion: 2 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('数据版本不兼容')
    expect(result.error).toContain('v2')
  })

  it('缺某个模式 → 拒绝并点名', () => {
    const raw = payload() as Record<string, unknown>
    const modes = { ...(raw.modes as Record<string, unknown>) }
    delete modes.translated
    const result = parseAchievementPayload({ ...raw, modes })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('翻译')
  })

  it('坏数字被容忍为 0，坏月份被跳过', () => {
    const raw = payload({
      modes: {
        typeset: {
          total: 5,
          monthly: [
            { month: '2026-09', count: 2, projectCount: 1 },
            { month: 'not-a-month', count: 99, projectCount: 99 },
            { month: '2026-10', count: -3, projectCount: -1 }
          ]
        },
        translated: { total: 0, monthly: [] },
        proofread: { total: 0, monthly: [] },
        supervised: { total: 0, monthly: [] }
      }
    })
    const result = parseAchievementPayload(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.profile.modes.typeset.monthly).toEqual([
      { month: '2026-09', count: 2, projectCount: 1 },
      { month: '2026-10', count: 0, projectCount: 0 }
    ])
    // total 从 monthly 重算，不信任文件里的 5
    expect(result.profile.modes.typeset.total).toBe(2)
  })

  it('非对象 / 数组 → 拒绝', () => {
    expect(parseAchievementPayload(null)).toEqual({
      ok: false,
      error: '文件内容不是有效的 JSON 对象'
    })
    expect(parseAchievementPayload([1, 2])).toEqual({
      ok: false,
      error: '文件内容不是有效的 JSON 对象'
    })
  })
})

describe('achievement-profile 本地档案清洗', () => {
  function storedProfile(
    id: string,
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      id,
      name: `档案${id}`,
      importedAt: 1,
      duty: 'typeset',
      modes: {
        typeset: { total: 1, monthly: [{ month: '2026-09', count: 1, projectCount: 0 }] },
        translated: { total: 0, monthly: [] },
        proofread: { total: 0, monthly: [] },
        supervised: { total: 0, monthly: [] }
      },
      ...overrides
    }
  }

  it('合法列表原样保留', () => {
    const profiles = normalizeStoredProfiles([storedProfile('a'), storedProfile('b')])
    expect(profiles.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('坏条目跳过，不拖垮整份列表', () => {
    const profiles = normalizeStoredProfiles([
      storedProfile('good'),
      { id: 'bad', modes: null },
      'garbage',
      storedProfile('good2', { id: '' })
    ])
    expect(profiles.map((p) => p.id)).toEqual(['good'])
  })

  it('非数组 → 空列表', () => {
    expect(normalizeStoredProfiles(null)).toEqual([])
    expect(normalizeStoredProfiles({ a: 1 })).toEqual([])
  })
})

/**
 * 写库前的摊平（2026-10-05：一导入就报 `An object could not be cloned.`）。
 *
 * 这里锁的是"产物必须是普通对象"：IPC 的结构化克隆过不了响应式代理，
 * 所以只要有人把 `toStoredProfiles` 改成直接返回原数组，前两条就会红。
 */
describe('achievement-profile 写库前摊平', () => {
  function profile(): ReturnType<typeof normalizeStoredProfiles>[number] {
    return {
      id: 'a',
      name: '阿花',
      importedAt: 1,
      duty: 'typeset',
      modes: {
        typeset: { total: 1, monthly: [{ month: '2026-09', count: 1, projectCount: 0 }] },
        translated: { total: 0, monthly: [] },
        proofread: { total: 0, monthly: [] },
        supervised: { total: 0, monthly: [] }
      }
    }
  }

  it('产物能过结构化克隆，且不是原来的数组本身', () => {
    const source = [profile()]
    const plain = toStoredProfiles(source)

    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain).not.toBe(source)
    expect(plain[0]).not.toBe(source[0])
    expect(plain[0].modes.typeset.monthly[0]).not.toBe(source[0].modes.typeset.monthly[0])
    expect(plain).toEqual(source)
  })

  it('只保留白名单字段：多余的键不会写进库', () => {
    const messy = [{ ...profile(), secret: '不该进库' }]
    const plain = toStoredProfiles(messy)

    expect(JSON.stringify(plain)).not.toContain('secret')
    expect(Object.keys(plain[0]).sort()).toEqual(['duty', 'id', 'importedAt', 'modes', 'name'])
  })
})

/** 从对方的数据库文件导入时，档案名取文件名（用户可以把文件改名成对方的名字）。 */
describe('achievement-profile 从文件路径取名', () => {
  it('取文件名去掉扩展名，Windows / POSIX 路径都认', () => {
    expect(profileNameFromFilePath('D:\\备份\\逗比.sqlite')).toBe('逗比')
    expect(profileNameFromFilePath('/home/a/洛.sqlite3')).toBe('洛')
    expect(profileNameFromFilePath('qianzi-gongfang.db')).toBe('qianzi-gongfang')
    expect(profileNameFromFilePath('D:\\x\\对手.json')).toBe('对手')
  })

  it('取不出名字时回落到"未署名"，不返回空字符串', () => {
    expect(profileNameFromFilePath('')).toBe('未署名')
    expect(profileNameFromFilePath('D:\\备份\\')).toBe('未署名')
  })
})
