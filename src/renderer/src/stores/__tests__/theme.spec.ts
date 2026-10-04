// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  DEFAULT_THEME_COLORS,
  bootstrapTheme,
  normalizeThemeColors,
  useThemeStore,
  type ThemeMode
} from '../theme'

const STORAGE_KEY = 'qianzi-gongfang-theme'
const COLOR_STORAGE_KEY = 'qianzi-gongfang-theme-colors'

/**
 * Stub `window.matchMedia` with a mutable `matches` flag. Returns a
 * `setMatches` helper that flips `matches` AND dispatches a `change`
 * event to every registered listener — mirroring how the browser fires
 * the event when the OS appearance toggles.
 */
function setMatchMedia(matches: boolean): { setMatches: (m: boolean) => void } {
  const listeners: Array<(ev: { matches: boolean }) => void> = []
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_: 'change', cb: (ev: { matches: boolean }) => void) => {
      listeners.push(cb)
    },
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn()
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  // Expose for tests that want to fire the listener manually.
  ;(window as unknown as { __themeListeners: typeof listeners }).__themeListeners = listeners
  return {
    setMatches: (m: boolean) => {
      mql.matches = m
      for (const cb of listeners) cb({ matches: m })
    }
  }
}

/** Minimal typed IPC bridge mock for storeGet/storeSet. */
function setupComicType(
  stored: unknown = null,
  storedColors: unknown = null
): { storeGet: ReturnType<typeof vi.fn>; storeSet: ReturnType<typeof vi.fn> } {
  const storeGet = vi.fn((key: string) =>
    Promise.resolve(key === 'theme.colors' ? storedColors : stored)
  )
  const storeSet = vi.fn().mockResolvedValue(undefined)
  window.comicType = { storeGet, storeSet } as unknown as typeof window.comicType
  return { storeGet, storeSet }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-mode')
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  // Tear down any system-preference listener + clear the IPC bridge so
  // tests are isolated.
  const store = useThemeStore()
  store.unwatchSystemPreference()
  delete (window as unknown as { comicType?: unknown }).comicType
  delete (window as unknown as { matchMedia?: unknown }).matchMedia
})

function setupBootTheme(bootTheme: unknown): void {
  window.comicType = { bootTheme } as unknown as typeof window.comicType
}

describe('bootstrapTheme', () => {
  it('applies the snapshot the main process passed, before Vue mounts', () => {
    setupBootTheme({ mode: 'dark', colors: { hue: 200, saturation: 80, neutralSaturation: 10 } })

    const result = bootstrapTheme()

    expect(result).toEqual({
      source: 'boot-args',
      mode: 'dark',
      resolved: 'dark',
      colors: { hue: 200, saturation: 80, neutralSaturation: 10 }
    })
    const root = document.documentElement
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.themeMode).toBe('dark')
    expect(root.style.getPropertyValue('--bg')).toBe('hsl(200 10% 12%)')
  })

  it('resolves system mode through the OS preference', () => {
    setMatchMedia(true)
    setupBootTheme({ mode: 'system', colors: null })

    expect(bootstrapTheme()?.resolved).toBe('dark')
    expect(document.documentElement.dataset.themeMode).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('falls back to localStorage when the boot arguments are missing', () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify({ hue: 32, saturation: 82, neutralSaturation: 9 }))

    const result = bootstrapTheme()

    expect(result?.source).toBe('local-storage')
    expect(result?.mode).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('hsl(32 82% 68%)')
  })

  it('ignores a malformed boot mode and uses localStorage instead', () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    setupBootTheme({ mode: 'midnight', colors: null })

    expect(bootstrapTheme()?.source).toBe('local-storage')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('borrows the localStorage colors when the boot arguments carried none', () => {
    localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify({ hue: 145, saturation: 68, neutralSaturation: 10 }))
    setupBootTheme({ mode: 'light', colors: null })

    expect(bootstrapTheme()?.colors).toEqual({ hue: 145, saturation: 68, neutralSaturation: 10 })
  })

  it('leaves the document alone when nothing was ever persisted', () => {
    delete (window as unknown as { comicType?: unknown }).comicType

    expect(bootstrapTheme()).toBeNull()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('')
  })
})

describe('useThemeStore', () => {
  it("setTheme('dark') writes 'dark' to document.documentElement.dataset.theme", () => {
    const store = useThemeStore()
    store.setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(store.theme).toBe<ThemeMode>('dark')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
    // 这条同时锁住"出厂配色 = 紫雾 262/58/8"：store 没有自定义颜色时用的就是
    // DEFAULT_THEME_COLORS，改默认值必须来这里同步。
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('hsl(262 58% 68%)')
    // 夜间材质层：悬停 / 选中 / 媒体底各用各的 token。
    // 旧版夜间三者同色（primary-soft = primary-soft-strong = 18%），在面板上
    // 只有 1.06:1 —— "划过"和"选中"完全分不出来。
    expect(document.documentElement.style.getPropertyValue('--primary-soft')).toBe(
      'hsl(262 45% 26%)'
    )
    expect(document.documentElement.style.getPropertyValue('--primary-soft-strong')).toBe(
      'hsl(262 45% 31%)'
    )
    expect(document.documentElement.style.getPropertyValue('--hover-surface')).toBe(
      'hsl(262 12% 22%)'
    )
    // 缩略图占位底必须是中性色，不能是强调色——否则每张卡片都是一个色块。
    expect(document.documentElement.style.getPropertyValue('--media-bg')).toBe(
      'hsl(262 8% 14%)'
    )
    // 完成色固定樱花粉，不随色相滑杆旋转。
    expect(document.documentElement.style.getPropertyValue('--done')).toBe('hsl(342 60% 66%)')
  })

  it("setTheme('system') with OS=dark resolves to 'dark' and applies it", () => {
    setMatchMedia(true)
    const store = useThemeStore()
    store.setTheme('system')
    expect(store.resolvedTheme).toBe<'dark' | 'light'>('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('falls back to light when matchMedia is unavailable (no crash)', () => {
    // Strip matchMedia entirely to simulate a stripped-down test env.
    Object.assign(window, { matchMedia: undefined })
    const store = useThemeStore()
    store.setTheme('system')
    expect(store.resolvedTheme).toBe<'dark' | 'light'>('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('updates dataset.theme when the OS preference changes while theme=system', () => {
    const { setMatches } = setMatchMedia(true)
    const store = useThemeStore()
    store.setTheme('system')
    expect(document.documentElement.dataset.theme).toBe('dark')

    // Simulate the user switching macOS appearance dark -> light.
    setMatches(false)
    expect(document.documentElement.dataset.theme).toBe('light')

    // And back to dark.
    setMatches(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it("initTheme loads theme from window.comicType.storeGet('theme')", async () => {
    setupComicType('dark')
    const store = useThemeStore()
    await store.initTheme()
    expect(store.theme).toBe<ThemeMode>('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('initTheme falls back to localStorage when storeGet returns nothing', async () => {
    setupComicType(null)
    localStorage.setItem(STORAGE_KEY, 'system')
    setMatchMedia(false)
    const store = useThemeStore()
    await store.initTheme()
    expect(store.theme).toBe<ThemeMode>('system')
    expect(store.resolvedTheme).toBe<'dark' | 'light'>('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it("setTheme persists to the IPC store via storeSet('theme', mode)", () => {
    const { storeSet } = setupComicType()
    const store = useThemeStore()
    store.setTheme('dark')
    expect(storeSet).toHaveBeenCalledWith('theme', 'dark')
  })

  it('applies and persists custom color settings immediately', () => {
    const { storeSet } = setupComicType()
    const store = useThemeStore()
    store.setColorSettings({ hue: 145, saturation: 68, neutralSaturation: 10 })

    expect(store.hue).toBe(145)
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('hsl(145 68% 52%)')
    // 日间是"灰画布(96) + 白面板(100)"：层级靠这一步产生（旧值画布=100 时整屏一片白）。
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('hsl(145 10% 96%)')
    expect(document.documentElement.style.getPropertyValue('--bg-raised')).toBe(
      'hsl(145 10% 100%)'
    )
    // 选中态比悬停深一档，两者不再共用同一个值。
    expect(document.documentElement.style.getPropertyValue('--primary-soft')).toBe(
      'hsl(145 55% 93%)'
    )
    expect(document.documentElement.style.getPropertyValue('--primary-soft-strong')).toBe(
      'hsl(145 55% 91.5%)'
    )
    // 悬停走独立的中性 token：它跟着中性色相走，不再等于强调色淡底。
    expect(document.documentElement.style.getPropertyValue('--hover-surface')).toBe(
      'hsl(145 30% 96.5%)'
    )
    expect(storeSet).toHaveBeenCalledWith('theme.colors', {
      hue: 145,
      saturation: 68,
      neutralSaturation: 10
    })
    expect(JSON.parse(localStorage.getItem(COLOR_STORAGE_KEY) ?? '{}')).toEqual({
      hue: 145,
      saturation: 68,
      neutralSaturation: 10
    })
  })

  it('loads saved color settings from the SQLite-backed IPC store', async () => {
    setupComicType('dark', { hue: 32, sat: 82, neutralSat: 9 })
    const store = useThemeStore()
    await store.initTheme()

    expect(store.theme).toBe('dark')
    expect(store.colorSettings).toEqual({ hue: 32, saturation: 82, neutralSaturation: 9 })
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('hsl(32 82% 68%)')
  })

  /**
   * 2026-10-01 P3：把"谁是权威"钉死 —— **DB（SQLite）是户口本，localStorage 只是首帧缓存**。
   *
   * 为什么值得单独一条：缓存与权威**同时有值且不一致**是唯一能暴露"谁赢"的场景。
   * 现有用例只覆盖了"DB 有值"和"DB 没值回落 localStorage"两种，没覆盖"两边都有"。
   */
  it('DB 与 localStorage 同时有值且不一致时，以 DB 为准（缓存不许反客为主）', async () => {
    setupComicType('light') // 权威：DB 说是亮色
    localStorage.setItem(STORAGE_KEY, 'dark') // 缓存：还留着上次写的过期镜像
    const store = useThemeStore()
    await store.initTheme()

    expect(store.theme).toBe<ThemeMode>('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('颜色同理：DB 有值时不被 localStorage 的旧镜像覆盖', async () => {
    setupComicType(null, { hue: 222, saturation: 70, neutralSaturation: 12 }) // 权威
    localStorage.setItem(
      COLOR_STORAGE_KEY,
      JSON.stringify({ hue: 145, saturation: 68, neutralSaturation: 10 }) // 过期镜像
    )
    const store = useThemeStore()
    await store.initTheme()

    expect(store.colorSettings).toEqual({ hue: 222, saturation: 70, neutralSaturation: 12 })
  })

  it('normalizes invalid and out-of-range persisted color values', () => {
    expect(
      normalizeThemeColors({ hue: -20, saturation: 140, neutralSaturation: 'not-a-number' })
    ).toEqual({
      hue: 0,
      saturation: 100,
      neutralSaturation: DEFAULT_THEME_COLORS.neutralSaturation
    })
  })

  it('does not crash when comicType bridge is missing', () => {
    // No setupComicType call — window.comicType is undefined.
    const store = useThemeStore()
    expect(() => store.setTheme('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
