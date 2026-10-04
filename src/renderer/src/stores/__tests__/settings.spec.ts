// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  DEFAULT_PROJECT_LIST_WIDTH,
  MAX_PROJECT_LIST_WIDTH,
  MIN_PROJECT_LIST_WIDTH,
  normalizeGuideSeenVersion,
  normalizePlayIntervalMs,
  normalizeProjectListWidth,
  useSettingsStore
} from '../settings'
import type { ThumbSize } from '@renderer/components/ThumbGrid.vue'

const STORAGE_KEY = 'ui.thumbSize'
const SORT_STORAGE_KEY = 'ui.childSortOrder'
const LIST_WIDTH_STORAGE_KEY = 'ui.projectListWidth'
const PROGRESS_SORT_STORAGE_KEY = 'ui.progressSort'

function mockComicType(storeGet: ReturnType<typeof vi.fn>): void {
  window.comicType = {
    storeGet,
    storeSet: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.comicType
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useSettingsStore', () => {
  it("loadSettings with valid '大' → thumbSize = '大'", async () => {
    mockComicType(vi.fn().mockResolvedValue('大'))
    const store = useSettingsStore()
    await store.loadSettings()
    expect(store.thumbSize).toBe<ThumbSize>('大')
  })

  it("loadSettings with invalid '超大' → thumbSize defaults to '中'", async () => {
    mockComicType(vi.fn().mockResolvedValue('超大'))
    const store = useSettingsStore()
    await store.loadSettings()
    expect(store.thumbSize).toBe<ThumbSize>('中')
  })

  it("setThumbSize('小') → calls storeSet with 'ui.thumbSize' and '小'", () => {
    const storeGet = vi.fn().mockResolvedValue('中')
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      storeGet,
      storeSet
    } as unknown as typeof window.comicType

    const store = useSettingsStore()
    store.setThumbSize('小')

    expect(store.thumbSize).toBe<ThumbSize>('小')
    expect(storeSet).toHaveBeenCalledWith(STORAGE_KEY, '小')
  })

  it('loads and persists the child-project sort order', async () => {
    const storeGet = vi.fn((key: string) =>
      Promise.resolve(key === SORT_STORAGE_KEY ? 'descending' : '中')
    )
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = { storeGet, storeSet } as unknown as typeof window.comicType

    const store = useSettingsStore()
    await store.loadSettings()
    expect(store.childSortOrder).toBe('descending')

    store.setChildSortOrder('ascending')
    expect(store.childSortOrder).toBe('ascending')
    expect(storeSet).toHaveBeenCalledWith(SORT_STORAGE_KEY, 'ascending')
  })

  it('defaults an invalid child-project sort order to ascending', async () => {
    mockComicType(
      vi.fn((key: string) => Promise.resolve(key === STORAGE_KEY ? '大' : 'unsupported'))
    )
    const store = useSettingsStore()
    await store.loadSettings()

    expect(store.thumbSize).toBe<ThumbSize>('大')
    expect(store.childSortOrder).toBe('ascending')
  })

  it('loadSettings with null/undefined → defaults to 中', async () => {
    // Test both null and undefined in one case to cover both "missing key"
    // scenarios (electron-store returns undefined for unset keys).
    for (const val of [null, undefined]) {
      setActivePinia(createPinia())
      mockComicType(vi.fn().mockResolvedValue(val))
      const store = useSettingsStore()
      await store.loadSettings()
      expect(store.thumbSize).toBe<ThumbSize>('中')
    }
  })

  it('loads and persists the external translation tool path', async () => {
    const TOOL_KEY = 'tools.labelPlusFxPath'
    const storeGet = vi.fn((key: string) =>
      Promise.resolve(key === TOOL_KEY ? '  D:\\tools\\LabelPlusFX.exe  ' : undefined)
    )
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = { storeGet, storeSet } as unknown as typeof window.comicType

    const store = useSettingsStore()
    await store.loadSettings()
    // Stored values are trimmed so downstream comparisons are exact.
    expect(store.labelPlusFxPath).toBe('D:\\tools\\LabelPlusFX.exe')

    store.setLabelPlusFxPath('  D:\\other\\Tool.exe ')
    expect(store.labelPlusFxPath).toBe('D:\\other\\Tool.exe')
    expect(storeSet).toHaveBeenCalledWith(TOOL_KEY, 'D:\\other\\Tool.exe')
  })

  it('clearing the tool path persists an empty string', () => {
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = { storeGet: vi.fn(), storeSet } as unknown as typeof window.comicType

    const store = useSettingsStore()
    store.labelPlusFxPath = 'D:\\tools\\LabelPlusFX.exe'
    store.setLabelPlusFxPath('   ')

    expect(store.labelPlusFxPath).toBe('')
    expect(storeSet).toHaveBeenCalledWith('tools.labelPlusFxPath', '')
  })

  it('an unset tool path loads as an empty string rather than undefined', async () => {
    mockComicType(vi.fn().mockResolvedValue(undefined))
    const store = useSettingsStore()
    await store.loadSettings()
    expect(store.labelPlusFxPath).toBe('')
  })

  it('loads and persists the Photoshop path, import script and fallback flag', async () => {
    const storeGet = vi.fn((key: string) => {
      if (key === 'tools.photoshopPath') return Promise.resolve(' E:\\PS\\Photoshop.exe ')
      if (key === 'tools.typesetImportScript')
        return Promise.resolve('E:\\PS\\Presets\\Scripts\\译文 .jsx')
      if (key === 'tools.skipPsFallbackPrompt') return Promise.resolve(true)
      return Promise.resolve(undefined)
    })
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = { storeGet, storeSet } as unknown as typeof window.comicType

    const store = useSettingsStore()
    await store.loadSettings()
    expect(store.photoshopPath).toBe('E:\\PS\\Photoshop.exe')
    expect(store.typesetImportScript).toBe('E:\\PS\\Presets\\Scripts\\译文 .jsx')
    expect(store.skipPsFallbackPrompt).toBe(true)

    store.setPhotoshopPath('E:\\Other\\Photoshop.exe')
    store.setTypesetImportScript('   ')
    store.setSkipPsFallbackPrompt(false)

    expect(storeSet).toHaveBeenCalledWith('tools.photoshopPath', 'E:\\Other\\Photoshop.exe')
    expect(storeSet).toHaveBeenCalledWith('tools.typesetImportScript', '')
    expect(storeSet).toHaveBeenCalledWith('tools.skipPsFallbackPrompt', false)
  })

  it('loads and persists the project list width', async () => {
    const storeGet = vi.fn((key: string) =>
      Promise.resolve(key === LIST_WIDTH_STORAGE_KEY ? 47.5 : undefined)
    )
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = { storeGet, storeSet } as unknown as typeof window.comicType

    const store = useSettingsStore()
    expect(store.projectListWidth).toBe(DEFAULT_PROJECT_LIST_WIDTH)

    await store.loadSettings()
    // The persisted divider position survives a relaunch.
    expect(store.projectListWidth).toBe(47.5)

    store.setProjectListWidth(38.2)
    expect(store.projectListWidth).toBe(38.2)
    expect(storeSet).toHaveBeenCalledWith(LIST_WIDTH_STORAGE_KEY, 38.2)
  })

  it('does not rewrite the stored width when the divider reports its current value', () => {
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      storeGet: vi.fn(),
      storeSet
    } as unknown as typeof window.comicType

    const store = useSettingsStore()
    store.setProjectListWidth(DEFAULT_PROJECT_LIST_WIDTH)
    expect(storeSet).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing value', undefined, DEFAULT_PROJECT_LIST_WIDTH],
    ['an empty string', '', DEFAULT_PROJECT_LIST_WIDTH],
    ['a non-numeric string', 'wide', DEFAULT_PROJECT_LIST_WIDTH],
    ['NaN', Number.NaN, DEFAULT_PROJECT_LIST_WIDTH],
    ['a value below the band', 2, MIN_PROJECT_LIST_WIDTH],
    ['a value above the band', 500, MAX_PROJECT_LIST_WIDTH]
  ])('normalizes %s in the stored list width', (_label, value, expected) => {
    expect(normalizeProjectListWidth(value)).toBe(expected)
  })

  /**
   * 新手引导"看过哪一版"（`ui.guideSeenVersion`）。
   * 它决定**首次启动要不要自动弹引导**，所以"读不到"和"没看过"必须都归到 0
   * （宁可再弹一次，也不要永久吞掉引导）；而 `settingsLoaded` 是宿主等的那面旗子。
   */
  it('loads the guide version and raises settingsLoaded even before anything is stored', async () => {
    mockComicType(vi.fn().mockResolvedValue(undefined))
    const store = useSettingsStore()
    expect(store.settingsLoaded).toBe(false)

    await store.loadSettings()

    expect(store.guideSeenVersion).toBe(0)
    expect(store.settingsLoaded).toBe(true)
  })

  it('keeps a stored guide version and clears it back to 0 when the value is unusable', async () => {
    const store = useSettingsStore()

    mockComicType(
      vi.fn((key: string) => Promise.resolve(key === 'ui.guideSeenVersion' ? 3 : undefined))
    )
    await store.loadSettings()
    expect(store.guideSeenVersion).toBe(3)

    mockComicType(
      vi.fn((key: string) => Promise.resolve(key === 'ui.guideSeenVersion' ? '3' : undefined))
    )
    await store.loadSettings()
    expect(store.guideSeenVersion).toBe(0)
  })

  /**
   * 校验**故意从严**：只认正整数。
   * 手改过的库、旧版本写进去的字符串、负数、NaN 一律当"没看过" ——
   * 代价是再弹一次引导，比"永久吞掉引导"划算。
   * （表格里每条都得在，否则把校验放宽也测不出来。）
   */
  it.each([
    ['未看过', 0, 0],
    ['合法版本', 2, 2],
    ['带小数的版本', 1.9, 1],
    ['数值字符串', '3', 0],
    ['中文串', '看过', 0],
    ['负数', -1, 0],
    ['NaN', Number.NaN, 0],
    ['布尔', true, 0],
    ['缺失', undefined, 0]
  ])('normalizes %s in the guide version', (_label, value, expected) => {
    expect(normalizeGuideSeenVersion(value)).toBe(expected)
  })

  it('markGuideSeen writes ui.guideSeenVersion once, and never rewrites the same version', () => {
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      storeGet: vi.fn(),
      storeSet
    } as unknown as typeof window.comicType

    const store = useSettingsStore()
    store.markGuideSeen(1)
    expect(store.guideSeenVersion).toBe(1)
    expect(storeSet).toHaveBeenCalledWith('ui.guideSeenVersion', 1)

    // 同一版再看一遍（例如用户又点了一次「指引」）不该再写库
    storeSet.mockClear()
    store.markGuideSeen(1)
    expect(storeSet).not.toHaveBeenCalled()
  })

  it('falls back inside loadSettings when the bridge throws (and still raises settingsLoaded)', async () => {
    mockComicType(vi.fn().mockRejectedValue(new Error('bridge down')))
    const store = useSettingsStore()

    await store.loadSettings()

    expect(store.guideSeenVersion).toBe(0)
    expect(store.settingsLoaded).toBe(true)
  })
})

/**
 * 自动播放间隔（看图三件套 · 需求二）：`ui.playIntervalMs`。
 *
 * 只认有限数值、四舍五入到 100 毫秒、夹进 1~10 秒 —— 手改过库里的值也不至于
 * 变成 1 毫秒的连环翻页（那比"间隔不合适"危险得多）。
 */
describe('settings: ui.playIntervalMs', () => {
  const PLAY_KEY = 'ui.playIntervalMs'

  it('校验与回落：一张表格', async () => {
    const cases: Array<[unknown, number]> = [
      [1500, 1500],
      [2000, 2000],
      [3000, 3000],
      [2500, 2500],
      ['1500', 1500],
      [1234, 1200],
      [50, 1000],
      [999999, 10000],
      [Number.NaN, 2000],
      ['abc', 2000],
      [true, 2000],
      [null, 2000],
      [undefined, 2000],
      ['', 2000],
      ['   ', 2000]
    ]
    for (const [input, expected] of cases) {
      expect(normalizePlayIntervalMs(input), `input=${String(input)}`).toBe(expected)
    }
  })

  it('loadSettings 读的是 ui.playIntervalMs 这一格', async () => {
    const storeGet = vi.fn((key: string) => Promise.resolve(key === PLAY_KEY ? 1500 : []))
    mockComicType(storeGet)
    const store = useSettingsStore()
    await store.loadSettings()

    expect(storeGet).toHaveBeenCalledWith(PLAY_KEY)
    expect(store.playIntervalMs).toBe(1500)
  })

  it('存了脏值也不会变成连环翻页（只读安全版兜住下限）', async () => {
    mockComicType(vi.fn((key: string) => Promise.resolve(key === PLAY_KEY ? 1 : [])))
    const store = useSettingsStore()
    await store.loadSettings()

    expect(store.playIntervalMs).toBe(1000)
    store.playIntervalMs = 5
    expect(store.playIntervalMsValid).toBe(1000)
  })

  it('setPlayIntervalMs 会落库；值没变就不写（省一次 IPC）', () => {
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet
    } as unknown as typeof window.comicType

    const store = useSettingsStore()
    store.setPlayIntervalMs(1500)
    expect(store.playIntervalMs).toBe(1500)
    expect(storeSet).toHaveBeenCalledWith(PLAY_KEY, 1500)

    storeSet.mockClear()
    store.setPlayIntervalMs(1500)
    expect(storeSet).not.toHaveBeenCalled()
  })
})

/**
 * C3：`ui.advanceAfterMark`（标记后下一张）。
 *
 * 默认必须是**关** —— 它只是个加速器，不该改变"点一下只标这一张"的默认语义。
 */
describe('settings: ui.advanceAfterMark', () => {
  const KEY = 'ui.advanceAfterMark'

  it('没存过 → 默认关', async () => {
    mockComicType(vi.fn().mockResolvedValue(undefined))
    const store = useSettingsStore()
    await store.loadSettings()
    expect(store.advanceAfterMark).toBe(false)
  })

  it('存过 true 就读回来是开', async () => {
    mockComicType(vi.fn((key: string) => Promise.resolve(key === KEY ? true : undefined)))
    const store = useSettingsStore()
    await store.loadSettings()
    expect(store.advanceAfterMark).toBe(true)
  })

  it('setAdvanceAfterMark 落库（布尔原样，不做字符串化）', () => {
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet
    } as unknown as typeof window.comicType

    const store = useSettingsStore()
    store.setAdvanceAfterMark(true)
    expect(store.advanceAfterMark).toBe(true)
    expect(storeSet).toHaveBeenCalledWith(KEY, true)
  })
})

/**
 * 「进度」页的排序偏好（2026-10-03）—— 与 `ui.childSortOrder` 同一条路：
 * 一个字符串、落库、读回时校验、垃圾值回落到默认。
 */
describe('进度页排序偏好', () => {
  it('读得回来、写得到库', async () => {
    const storeGet = vi.fn((key: string) =>
      Promise.resolve(key === PROGRESS_SORT_STORAGE_KEY ? 'update:desc' : undefined)
    )
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = { storeGet, storeSet } as unknown as typeof window.comicType

    const store = useSettingsStore()
    await store.loadSettings()
    // 档位值 2026-10-04 随改名从 gap:* 换成 update:*（锁跟着新契约走，意图不变：存得住、读得回）
    expect(store.progressSort).toBe('update:desc')

    store.setProgressSort('completion:asc')
    expect(store.progressSort).toBe('completion:asc')
    expect(storeSet).toHaveBeenCalledWith(PROGRESS_SORT_STORAGE_KEY, 'completion:asc')
  })

  it('库里的垃圾值 / 缺省 → 回落到默认顺序；且非法值**不许写回库**', async () => {
    const storeGet = vi.fn((key: string) =>
      Promise.resolve(key === PROGRESS_SORT_STORAGE_KEY ? 'nonsense' : undefined)
    )
    const storeSet = vi.fn().mockResolvedValue(undefined)
    window.comicType = { storeGet, storeSet } as unknown as typeof window.comicType

    const store = useSettingsStore()
    await store.loadSettings()
    expect(store.progressSort).toBe('default:desc')

    store.setProgressSort('nonsense')
    expect(store.progressSort).toBe('default:desc')
    expect(storeSet).not.toHaveBeenCalled()
  })
})
