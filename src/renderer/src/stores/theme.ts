import { defineStore } from 'pinia'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeColorSettings {
  hue: number
  saturation: number
  neutralSaturation: number
}

/**
 * 「紫雾 · 樱花」is the shipped default: a soft violet primary over a violet-grey
 * neutral ramp. 262/58/8 replaces the old corporate blue (222/70/12).
 *
 * Anyone who already stored `theme.colors` keeps their own palette — the
 * Settings page lists this as the 「紫雾」preset so it is one click away, and
 * 「参考蓝 222」is still there to go back.
 */
export const DEFAULT_THEME_COLORS: Readonly<ThemeColorSettings> = Object.freeze({
  hue: 262,
  saturation: 58,
  neutralSaturation: 8
})

const MODE_STORAGE_KEY = 'qianzi-gongfang-theme'
const COLOR_STORAGE_KEY = 'qianzi-gongfang-theme-colors'
const MODE_IPC_KEY = 'theme'
const COLOR_IPC_KEY = 'theme.colors'
const VALID_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'] as const

const NEUTRAL_LIGHTNESS = {
  // `subtle` (tertiary text) must clear WCAG AA 4.5:1 on the surface it sits on:
  // dark 60% on raised(17) measures 4.77:1; light 45% on a white panel measures
  // 5.20:1. Mirror any change in styles/tokens.css.
  //
  // 夜间 11/15 只差 1.11:1，面板与画布糊在一起；改成 12/17 = 1.16:1。
  // sunken 从 7 抬到 9.5：7% 比画布还暗一截，看上去像"洞"。
  dark: { bg: 12, raised: 17, sunken: 9.5, fg: 94, muted: 68, subtle: 60, border: 27, strong: 38 },
  light: {
    // 日间是"灰画布 + 白面板"：层级来自 96 ↔ 100。旧值 100/97 只差 3% 亮度，
    // 画布↔卡片实测 1.07:1，功能区无法区分。
    // 描边从 88 抬到 90 并新增 --hairline(92)，是因为"面板/画布"的对比不能只靠
    // 一档描边硬撑。
    bg: 96,
    raised: 100,
    sunken: 93,
    fg: 14,
    muted: 42,
    subtle: 45,
    border: 90,
    strong: 76
  }
} as const

const SEMANTIC_COLORS = [
  ['danger', 4, 70],
  ['success', 145, 60],
  ['warning', 38, 85],
  ['info', 210, 80]
] as const

function isValidMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === ''))
  ) {
    return fallback
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

/** Normalize persisted or user-supplied color settings into safe slider values. */
export function normalizeThemeColors(value: unknown): ThemeColorSettings {
  const source = isRecord(value) ? value : {}
  return {
    hue: boundedInteger(source.hue, 0, 360, DEFAULT_THEME_COLORS.hue),
    saturation: boundedInteger(
      source.saturation ?? source.sat,
      0,
      100,
      DEFAULT_THEME_COLORS.saturation
    ),
    neutralSaturation: boundedInteger(
      source.neutralSaturation ?? source.neutralSat,
      0,
      30,
      DEFAULT_THEME_COLORS.neutralSaturation
    )
  }
}

function parseColorSettings(value: unknown): ThemeColorSettings | null {
  if (!isRecord(value)) return null
  return normalizeThemeColors(value)
}

/**
 * ── 缓存层（2026-10-01 P3：把"谁是权威"写在代码里）────────────────────────
 * 下面四个函数只碰 **localStorage**。它的身份是**首帧缓存**：Vue 挂载**之前**
 * `bootstrapTheme()` 就得立刻上色，而异步的 DB 那时还没回来，所以留一份镜像。
 *
 * **权威永远是 SQLite**（`window.comicType.storeGet` / `storeSet`）：
 *   · 读：`initTheme()` 里是 `ipc.mode ?? storedMode`、`ipc.colors ?? storedColors`
 *     —— **DB 有值就一定赢**（`theme.spec.ts` 有两条用例专门锁这个优先级）；
 *   · 写：`setTheme()` / 改配色都是**先落 DB**，再顺手刷新这份缓存。
 *
 * 结论：**这份缓存随时可以丢**（清缓存 / 换机器 / 无痕模式都不影响正确性），
 * 但**不许把它当权威用** —— 别在这儿补默认值、也别拿它判断"是否已初始化"。
 * 要新增跨启动保留的设置项 → 走 `stores/settings.ts` + `key_value_store`（见 §13 第 9 条）。
 */
function readStoredMode(): ThemeMode | null {
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY)
    return isValidMode(raw) ? raw : null
  } catch {
    return null
  }
}

function readStoredColors(): ThemeColorSettings | null {
  try {
    const raw = window.localStorage.getItem(COLOR_STORAGE_KEY)
    return raw ? parseColorSettings(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeStoredMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // localStorage may be unavailable; the SQLite-backed IPC store remains authoritative.
  }
}

function writeStoredColors(colors: ThemeColorSettings): void {
  try {
    window.localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(colors))
  } catch {
    // Keep the live theme working even if localStorage is unavailable.
  }
}

function parseThemeMode(value: unknown): ThemeMode | null {
  if (isValidMode(value)) return value
  if (!isRecord(value)) return null
  const nestedMode = value.mode ?? value.theme
  return isValidMode(nestedMode) ? nestedMode : null
}

async function readIPCThemeSnapshot(): Promise<{
  mode: ThemeMode | null
  colors: ThemeColorSettings | null
}> {
  try {
    if (typeof window === 'undefined' || typeof window.comicType?.storeGet !== 'function') {
      return { mode: null, colors: null }
    }
    const [modeValue, colorValue] = await Promise.all([
      window.comicType.storeGet(MODE_IPC_KEY),
      window.comicType.storeGet(COLOR_IPC_KEY)
    ])
    return {
      mode: parseThemeMode(modeValue),
      colors:
        parseColorSettings(colorValue) ??
        (isRecord(modeValue) ? parseColorSettings(modeValue.colors ?? modeValue) : null)
    }
  } catch {
    return { mode: null, colors: null }
  }
}

function writeIPCMode(mode: ThemeMode): void {
  try {
    if (typeof window === 'undefined' || typeof window.comicType?.storeSet !== 'function') return
    void Promise.resolve(window.comicType.storeSet(MODE_IPC_KEY, mode)).catch(() => undefined)
  } catch {
    // The preload bridge can be absent in isolated renderer tests.
  }
}

function writeIPCColors(colors: ThemeColorSettings): void {
  try {
    if (typeof window === 'undefined' || typeof window.comicType?.storeSet !== 'function') return
    void Promise.resolve(window.comicType.storeSet(COLOR_IPC_KEY, colors)).catch(() => undefined)
  } catch {
    // The preload bridge can be absent in isolated renderer tests.
  }
}

function readSystemPreference(): ResolvedTheme | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return null
  }
}

function hsl(hue: number, saturation: number, lightness: number, alpha?: number): string {
  return alpha === undefined
    ? `hsl(${hue} ${saturation}% ${lightness}%)`
    : `hsl(${hue} ${saturation}% ${lightness}% / ${alpha})`
}

/** Apply the design-token derivation from the root index.html to one element. */
export function applyThemeVariables(
  root: HTMLElement,
  theme: ResolvedTheme,
  settings: ThemeColorSettings
): void {
  const colors = normalizeThemeColors(settings)
  const dark = theme === 'dark'
  const neutral = dark ? NEUTRAL_LIGHTNESS.dark : NEUTRAL_LIGHTNESS.light
  // 夜间主色比旧值(62)再亮一档：紫罗兰在黑底上需要 68 才够，且这样才能和
  // 中性灰（同一色相）分开——旧版主色 62 在面板上只有 4.26:1，看着像"更蓝的灰"。
  const baseLightness = dark ? 68 : 52
  const set = (name: string, value: string): void => root.style.setProperty(name, value)

  set('--hue', String(colors.hue))
  set('--sat', `${colors.saturation}%`)
  set('--neutral-sat', `${colors.neutralSaturation}%`)
  set('--primary', hsl(colors.hue, colors.saturation, baseLightness))
  set('--primary-hover', hsl(colors.hue, colors.saturation, baseLightness + (dark ? 6 : -6)))
  set('--primary-active', hsl(colors.hue, colors.saturation, baseLightness + (dark ? 12 : -12)))
  set('--primary-fg', hsl(colors.hue, colors.saturation, dark ? 12 : 98))
  set('--primary-soft', dark ? hsl(colors.hue, 45, 26) : hsl(colors.hue, 55, 93))
  set('--primary-soft-hover', dark ? hsl(colors.hue, 45, 30) : hsl(colors.hue, 55, 89))
  // Persistent selection tint: one step deeper than hover in BOTH themes.
  // 夜间旧值两者同为 hsl(hue 30% 18%)，在面板上只有 1.06:1 —— "选中"和"划过"
  // 完全分不出来。现在夜间选中 45%/31%、悬停 12%/22%。
  set('--primary-soft-strong', dark ? hsl(colors.hue, 45, 31) : hsl(colors.hue, 55, 91.5))
  set('--primary-border', dark ? hsl(colors.hue, 40, 38) : hsl(colors.hue, 50, 80))

  set('--bg', hsl(colors.hue, colors.neutralSaturation, neutral.bg))
  set('--bg-raised', hsl(colors.hue, colors.neutralSaturation, neutral.raised))
  set('--bg-sunken', hsl(colors.hue, colors.neutralSaturation, neutral.sunken))
  set('--fg', hsl(colors.hue, colors.neutralSaturation, neutral.fg))
  set('--fg-muted', hsl(colors.hue, colors.neutralSaturation, neutral.muted))
  set('--fg-subtle', hsl(colors.hue, colors.neutralSaturation, neutral.subtle))
  set('--border', hsl(colors.hue, colors.neutralSaturation, neutral.border))
  set('--border-strong', hsl(colors.hue, colors.neutralSaturation, neutral.strong))
  // 职责胶囊的外框：3:1 档（--border-strong 只有 1.9~2.1:1，达不到"图形 ≥3:1"）。
  // ⚠️ 与 styles/tokens.css 里那两处**必须同步**（有锁盯着）：日 58%、夜 54%。
  set('--chip-border', hsl(colors.hue, colors.neutralSaturation, dark ? 54 : 58))

  // Material layer. One token per role — see the header comment in
  // styles/tokens.css. Before this, --primary-soft doubled as the hover tint,
  // the idle button background, the thumbnail placeholder and the footer band,
  // so the accent colour was doing the job of a surface colour.
  set(
    '--media-bg',
    dark
      ? hsl(colors.hue, colors.neutralSaturation, 14)
      : hsl(colors.hue, Math.max(0, colors.neutralSaturation - 2), 96.5)
  )
  set('--hover-surface', dark ? hsl(colors.hue, 12, 22) : hsl(colors.hue, 30, 96.5))
  set('--surface-pressed', dark ? hsl(colors.hue, 14, 24.5) : hsl(colors.hue, 34, 94.5))
  set('--select-surface', dark ? hsl(colors.hue, 45, 31) : hsl(colors.hue, 55, 91.5))
  set('--hairline', dark ? hsl(colors.hue, 12, 24) : hsl(colors.hue, 10, 92))
  // 完成色固定为樱花粉（342°），不随用户的色相滑杆旋转 —— 它承担的是
  // "这活干完了"的正反馈，需要和主色在色相上永久分开。
  set('--done', dark ? 'hsl(342 60% 66%)' : 'hsl(342 62% 57%)')
  set('--done-fg', dark ? 'hsl(342 60% 12%)' : 'hsl(342 62% 98%)')
  set('--done-soft', dark ? 'hsl(342 35% 22%)' : 'hsl(342 55% 95%)')

  for (const [name, semanticHue, semanticSaturation] of SEMANTIC_COLORS) {
    set(`--${name}`, hsl(semanticHue, semanticSaturation, dark ? 62 : 48))
    set(`--${name}-fg`, hsl(semanticHue, semanticSaturation, dark ? 12 : 98))
    set(`--${name}-soft`, dark ? hsl(semanticHue, 35, 17) : hsl(semanticHue, 65, 94))
  }

  // 日间材质 = 纸：阴影带主色相（hue 跟随用户设置），比中性灰影更有"纸感"。
  // 夜间材质 = 玻璃：纯黑柔和阴影 + 顶边一道高光，而不是旧版那种 rgb(0 0 0/.5)
  // 的纯黑洞——那叠在深灰面板上只会更脏。
  const ink = (alpha: number): string => hsl(colors.hue, 30, 20, alpha)
  set('--shadow-1', dark ? '0 1px 2px rgb(0 0 0 / 0.4)' : `0 1px 2px ${ink(0.05)}`)
  set('--shadow-2', dark ? '0 4px 14px rgb(0 0 0 / 0.45)' : `0 4px 12px ${ink(0.08)}`)
  set('--shadow-3', dark ? '0 12px 32px rgb(0 0 0 / 0.55)' : `0 12px 32px ${ink(0.12)}`)
  set(
    '--shadow-card',
    dark
      ? `0 1px 2px rgb(0 0 0 / 0.4), inset 0 1px 0 ${hsl(colors.hue, 40, 90, 0.05)}`
      : `0 1px 2px ${ink(0.05)}, 0 4px 12px ${ink(0.07)}`
  )
  set(
    '--shadow-card-hover',
    dark
      ? `0 6px 20px rgb(0 0 0 / 0.5), inset 0 1px 0 ${hsl(colors.hue, 40, 90, 0.07)}`
      : `0 2px 6px ${ink(0.07)}, 0 10px 24px ${ink(0.12)}`
  )
}

let systemUnwatch: null | (() => void) = null

/** Where the pre-paint theme came from; surfaced for the startup log. */
export type BootThemeSource = 'boot-args' | 'local-storage'

export interface BootThemeResult {
  source: BootThemeSource
  mode: ThemeMode
  resolved: ResolvedTheme
  colors: ThemeColorSettings
}

function readBootThemeSnapshot(): {
  source: BootThemeSource
  mode: ThemeMode
  colors: ThemeColorSettings
} | null {
  const boot = typeof window === 'undefined' ? null : window.comicType?.bootTheme
  if (boot && isValidMode(boot.mode)) {
    return {
      source: 'boot-args',
      mode: boot.mode,
      // A missing color argument means the store had nothing valid for us;
      // localStorage still mirrors whatever the user last picked in-app.
      colors:
        (boot.colors ? parseColorSettings(boot.colors) : null) ??
        readStoredColors() ?? { ...DEFAULT_THEME_COLORS }
    }
  }

  const storedMode = readStoredMode()
  if (!storedMode) return null
  return {
    source: 'local-storage',
    mode: storedMode,
    colors: readStoredColors() ?? { ...DEFAULT_THEME_COLORS }
  }
}

/**
 * Apply the persisted theme synchronously, before the first paint.
 *
 * Called from `main.ts` ahead of `createApp()`. Without it the document starts
 * on the light defaults baked into index.html and only turns dark once
 * `initTheme()` finishes its async IPC round-trip — a visible white flash on
 * every launch for dark-mode users.
 *
 * Sources, in order of authority:
 *   1. `window.comicType.bootTheme` — the store snapshot the main process
 *      appended to this renderer's argv when it created the window.
 *   2. localStorage — the last mode this renderer wrote.
 *
 * `initTheme()` still runs after mount and remains the single source of truth;
 * this only decides what the first frame looks like. Returns null when nothing
 * was persisted (first launch), leaving the document on its defaults.
 */
export function bootstrapTheme(): BootThemeResult | null {
  if (typeof document === 'undefined') return null
  const snapshot = readBootThemeSnapshot()
  if (!snapshot) return null

  const resolved: ResolvedTheme =
    snapshot.mode === 'system' ? (readSystemPreference() ?? 'light') : snapshot.mode
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.themeMode = snapshot.mode
  root.style.colorScheme = resolved
  applyThemeVariables(root, resolved, snapshot.colors)

  return { source: snapshot.source, mode: snapshot.mode, resolved, colors: snapshot.colors }
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    theme: 'light' as ThemeMode,
    hue: DEFAULT_THEME_COLORS.hue,
    saturation: DEFAULT_THEME_COLORS.saturation,
    neutralSaturation: DEFAULT_THEME_COLORS.neutralSaturation
  }),

  getters: {
    resolvedTheme(state): ResolvedTheme {
      if (state.theme !== 'system') return state.theme
      return readSystemPreference() ?? 'light'
    },

    colorSettings(state): ThemeColorSettings {
      return {
        hue: state.hue,
        saturation: state.saturation,
        neutralSaturation: state.neutralSaturation
      }
    },

    // Short aliases mirror the parameter names in the reference design token
    // JSON (`sat` and `neutralSat`) for callers that consume the token schema.
    sat(state): number {
      return state.saturation
    },

    neutralSat(state): number {
      return state.neutralSaturation
    }
  },

  actions: {
    setTheme(mode: ThemeMode): void {
      this.theme = isValidMode(mode) ? mode : 'light'
      writeStoredMode(this.theme)
      writeIPCMode(this.theme)
      this.applyTheme()
      if (this.theme === 'system') this.watchSystemPreference()
      else this.unwatchSystemPreference()
    },

    setColorSettings(value: Partial<ThemeColorSettings>): void {
      const requested = value ?? {}
      const colors = normalizeThemeColors({
        hue: requested.hue ?? this.hue,
        saturation: requested.saturation ?? this.saturation,
        neutralSaturation: requested.neutralSaturation ?? this.neutralSaturation
      })
      this.hue = colors.hue
      this.saturation = colors.saturation
      this.neutralSaturation = colors.neutralSaturation
      writeStoredColors(colors)
      writeIPCColors(colors)
      this.applyTheme()
    },

    setHue(hue: number): void {
      this.setColorSettings({ hue })
    },

    setSaturation(saturation: number): void {
      this.setColorSettings({ saturation })
    },

    setNeutralSaturation(neutralSaturation: number): void {
      this.setColorSettings({ neutralSaturation })
    },

    resetColorSettings(): void {
      this.setColorSettings({ ...DEFAULT_THEME_COLORS })
    },

    async initTheme(): Promise<void> {
      const storedMode = readStoredMode()
      const storedColors = readStoredColors()
      const ipc = await readIPCThemeSnapshot()
      const colors = ipc.colors ?? storedColors ?? { ...DEFAULT_THEME_COLORS }

      this.theme = ipc.mode ?? storedMode ?? 'light'
      this.hue = colors.hue
      this.saturation = colors.saturation
      this.neutralSaturation = colors.neutralSaturation
      this.applyTheme()
      if (this.theme === 'system') this.watchSystemPreference()
      else this.unwatchSystemPreference()
    },

    applyTheme(): void {
      if (typeof document === 'undefined') return
      const resolved: ResolvedTheme =
        this.theme === 'system' ? (readSystemPreference() ?? 'light') : this.theme
      const root = document.documentElement
      root.dataset.theme = resolved
      root.dataset.themeMode = this.theme
      root.style.colorScheme = resolved
      applyThemeVariables(root, resolved, this.colorSettings)
    },

    watchSystemPreference(): void {
      this.unwatchSystemPreference()
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      if (typeof mediaQuery.addEventListener !== 'function') return
      const handler = (): void => {
        if (this.theme === 'system') this.applyTheme()
      }
      mediaQuery.addEventListener('change', handler)
      systemUnwatch = () => mediaQuery.removeEventListener?.('change', handler)
    },

    unwatchSystemPreference(): void {
      systemUnwatch?.()
      systemUnwatch = null
    }
  }
})
