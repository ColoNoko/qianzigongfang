// @vitest-environment node
/**
 * token 对比度**真源锁**（2026-10-07）。
 *
 * 背景：§15「紫雾 · 樱花」把每条 token 的用途和对比度都算得很细，但那些数字是
 * **手算写进注释的** —— 全仓没有任何一处计算对比度（`grep -rln 'luminance' src` 为空）。
 * 手算的规范只能覆盖作者当时想到的那几对，于是出了一件真事：
 * `MarkHistoryDialog` 的两枚徽章写成 `bg-warning-soft text-warning-fg`，
 * 把"压实心色块的字"压到"淡彩底"上 —— **日 1.07:1 / 夜 1.12:1，两个主题都读不出字**，
 * 而 §15 恰好没算这一对，所以它一直没被发现。
 *
 * 这个文件把那几对（以及本案新立的 `-on-soft` 家族）变成**可执行**的契约。
 *
 * 三把锁：
 *   ① 家族锁：每个 `--*-on-soft` 都要有配对的 `--*-soft`，且对其 ≥4.5:1（昼夜各算）；
 *   ② 负向锁：源码里**不许**再出现"`bg-X-soft` 与 `text-X-fg` 同处一个类名字符串"
 *      （这正是上面那件真事的形状 —— 它比任何单点断言都更能防复发）；
 *   ③ 回归锁：把 §15 里已经达标的那些对钉住（正文 / 三级文字 / 主色 / 完成色 / 小控件外框），
 *      谁把 token 调浅了都得先过这里。
 *
 * ⚠️ 本文件**故意不含**下面这几对，因为它们今天就是红的（属已知缺口，另立项修，
 * 不要为了让本文件变绿而改它们，也不要把它们悄悄加进来当"已达标"）：
 *   · `--hover-surface` 对 `--bg-raised`：日 **1.10** < §15.5 自定的 1.15
 *   · `--done` **当文字**用：日 **4.06** < 4.5（§15.2 注释写的是"做填充和文字都达标"，
 *     对文字这一半并不成立；它做填充/图形是达标的，本文件按 3:1 断言）
 *   · `--warning` / `--success` **当文字**用：日 **2.43 / 2.27**
 *   · `bg-warning text-warning-fg`：日 **2.36**
 *   · `bg-X-soft text-X`（不是 `-fg`）：日 warning **2.19**
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER = resolve(__dirname, '..')
const SRC = resolve(__dirname, '../../..')
const TOKENS = readFileSync(resolve(RENDERER, 'styles/tokens.css'), 'utf8')

/** 按选择器精确取一个主题块（到该块自己的收尾 `}` 为止）。 */
function themeBlock(selector: string): string {
  const start = TOKENS.indexOf(`${selector} {`)
  expect(start, `tokens.css 里找不到 ${selector} 的定义`).toBeGreaterThan(-1)
  const end = TOKENS.indexOf('\n}', start)
  return TOKENS.slice(start, end === -1 ? undefined : end)
}

/** 一个主题块里声明的全部 token 名 -> 值。 */
function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim()
  }
  return out
}

const DAY = declarations(themeBlock(':root'))
const NIGHT = declarations(themeBlock("[data-theme='dark']"))

type Rgb = [number, number, number]

/** `hsl(h s% l%)` -> sRGB。三个分量都允许带小数（如 96.5）。 */
function hsl(value: string): Rgb | null {
  const match = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(value)
  if (!match) return null
  const h = Number(match[1]) / 360
  const s = Number(match[2]) / 100
  const l = Number(match[3]) / 100
  const f = (n: number): number => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
  }
  return [f(0), f(8), f(4)]
}

/** 递归解析 `var(--x)` 引用链（`--card-bg: var(--bg-raised)` 这类别名很多）。 */
function resolveToken(name: string, table: Record<string, string>, depth = 0): Rgb | null {
  if (depth > 8) return null
  const raw = table[name]
  if (!raw) return null
  const direct = hsl(raw)
  if (direct) return direct
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(raw)
  if (alias) return resolveToken(alias[1], table, depth + 1)
  return null
}

/** WCAG 相对亮度 —— 先做 sRGB 线性化，再按 0.2126/0.7152/0.0722 加权。 */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 对比度 `(L1+0.05)/(L2+0.05)`。 */
function contrast(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 在某个主题里算一对 token 的对比度（任一侧解析不出来就直接失败，不给"静默跳过"的机会）。 */
function ratioOf(table: Record<string, string>, fg: string, bg: string): number {
  const a = resolveToken(fg, table)
  const b = resolveToken(bg, table)
  expect(a, `解析不出 ${fg}`).not.toBeNull()
  expect(b, `解析不出 ${bg}`).not.toBeNull()
  return contrast(a as Rgb, b as Rgb)
}

const THEMES: Array<[string, Record<string, string>]> = [
  ['日间', DAY],
  ['夜间', NIGHT]
]

/** 递归收集渲染层全部 .vue（负向锁要扫全量，不能只扫我记得的那几个文件）。 */
function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'visual') continue
      out.push(...vueFiles(full))
    } else if (entry.endsWith('.vue')) {
      out.push(full)
    }
  }
  return out
}

describe('① 家族锁：`-on-soft` 是"压淡彩底的字"，与 `-fg` 各管一件事', () => {
  it('日间两个 token 在（取值不许飘）', () => {
    expect(TOKENS).toContain('--warning-on-soft: hsl(38 85% 26%);')
    expect(TOKENS).toContain('--info-on-soft: hsl(210 80% 30%);')
  })

  it('夜间两个 token 也在', () => {
    expect(TOKENS).toContain('--warning-on-soft: hsl(38 85% 75%);')
    expect(TOKENS).toContain('--info-on-soft: hsl(210 80% 78%);')
  })

  it('每个 `-on-soft` 都压得住它自己那块 `-soft`（≥4.5:1，昼夜各算）', () => {
    for (const [theme, table] of THEMES) {
      const names = Object.keys(table).filter((name) => name.endsWith('-on-soft'))
      expect(names.length, `${theme} 里一个 -on-soft 都没有，家族锁形同虚设`).toBeGreaterThan(0)
      for (const name of names) {
        const soft = `${name.slice(0, -'-on-soft'.length)}-soft`
        expect(table[soft], `${theme}：${name} 没有配对的 ${soft}`).toBeDefined()
        const ratio = ratioOf(table, name, soft)
        expect(
          ratio,
          `${theme}：${name} 对 ${soft} 只有 ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('反例：`-fg` 压在 `-soft` 上就是本案那个 bug —— 必须仍然远低于 4.5（说明两族确实不可互换）', () => {
    // 这条锁的是"我们理解对了病因"。如果哪天 `--warning-fg` 被改成也能压淡彩底，
    // 那说明有人把两个 token 合并了 —— 那正是 §15.1「一个 token 只干一件事」要拦的事。
    for (const [theme, table] of THEMES) {
      const ratio = ratioOf(table, '--warning-fg', '--warning-soft')
      expect(ratio, `${theme}：--warning-fg 压在 --warning-soft 上的比值变了`).toBeLessThan(2)
    }
  })
})

describe('② 负向锁：源码里不许再出现"淡彩底 + 实心字"这种组合', () => {
  it('没有任何类名字符串同时含 `bg-X-soft` 与 `text-X-fg`', () => {
    const offenders: string[] = []
    for (const file of vueFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      text.split('\n').forEach((line, index) => {
        // 只看"引号里的类名串"，避免把同一行里两个元素的类名串到一起误判。
        for (const quoted of line.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
          const value = quoted[1] ?? quoted[2] ?? quoted[3] ?? ''
          for (const soft of value.matchAll(/\bbg-([a-z]+)-soft\b/g)) {
            if (new RegExp(`\\btext-${soft[1]}-fg\\b`).test(value)) {
              offenders.push(
                `${'src/' + relative(SRC, file).split(sep).join('/')}:${index + 1}  ${value.trim()}`
              )
            }
          }
        }
      })
    }
    expect(offenders, `淡彩底配实心字（字会消失）：\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('③ 回归锁：§15 已达标的那几对，钉住', () => {
  it('正文 / 二级 / 三级文字对面板 ≥4.5:1（WCAG AA 正文门槛）', () => {
    for (const [theme, table] of THEMES) {
      for (const name of ['--fg', '--fg-muted', '--fg-subtle']) {
        const ratio = ratioOf(table, name, '--bg-raised')
        expect(ratio, `${theme}：${name} 对面板只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          4.5
        )
      }
    }
  })

  it('主色对面板 ≥4.5:1（夜间那档只有 4.53，是本组里余量最小的一条）', () => {
    for (const [theme, table] of THEMES) {
      const ratio = ratioOf(table, '--primary', '--bg-raised')
      expect(ratio, `${theme}：--primary 对面板只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        4.5
      )
    }
  })

  it('完成色对面板 ≥3:1（图形门槛；它当文字用的那个缺口见文件头注释）', () => {
    for (const [theme, table] of THEMES) {
      const ratio = ratioOf(table, '--done', '--bg-raised')
      expect(ratio, `${theme}：--done 对面板只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    }
  })

  it('小控件外框（`--chip-border`）对面板与行悬停底都 ≥3:1 —— 这是它存在的全部理由', () => {
    for (const [theme, table] of THEMES) {
      for (const bg of ['--bg-raised', '--hover-surface']) {
        const ratio = ratioOf(table, '--chip-border', bg)
        expect(
          ratio,
          `${theme}：--chip-border 对 ${bg} 只有 ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('持久选中必须比悬停"深一档"（≥1.10:1）—— §15.2 的夜间解耦就锁在这', () => {
    for (const [theme, table] of THEMES) {
      const ratio = ratioOf(table, '--select-surface', '--hover-surface')
      expect(ratio, `${theme}：选中对悬停只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(1.1)
    }
  })

  it('面板与画布始终可分（≥1.09:1）', () => {
    // ⚠️ 门槛取 1.09 而不是 1.10：§15.2 写的是"日间 96 ↔ 100 = **1.10:1**"，
    // 那是**两位小数的取整**；按 WCAG 公式实算是 **1.0976**（本锁第一次运行就是在这里红的，
    // 这正是"手算写进注释"与"可执行契约"的差别）。夜间是 1.16:1。
    // 门槛只用来拦"把画布和面板调成同一个值"这类真回归，不再复述那个取整后的数字。
    for (const [theme, table] of THEMES) {
      const ratio = ratioOf(table, '--bg-raised', '--bg')
      expect(ratio, `${theme}：面板对画布只有 ${ratio.toFixed(4)}:1`).toBeGreaterThanOrEqual(1.09)
    }
  })
})
