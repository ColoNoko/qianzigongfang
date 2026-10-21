// @vitest-environment node
/**
 * 职责四色 · **真源锁**（2026-10-05）。
 *
 * 背景：侧栏 / 项目页的职责胶囊原来是一枚**灰底灰字**的标签，看不出"这本是哪道工序"；
 * 用户拿「进度」页时间线那套 [彩框 + 彩字] 当参照，要求把侧栏也做成那样。
 * 于是色值从时间线的 scoped 样式里**收成 token**（`styles/tokens.css` 的 `--role-*`），
 * 时间线与侧栏共用同一份 —— 这个文件锁的就是"**只有一份色**"这件事。
 *
 * 四把锁各管一段（都是"改坏了必须立刻红"的地方）：
 *   ① 内容锁：token 的**取值**（时间线一直在用的那 8 个值，昼夜各四个）不许被改；
 *   ② 反重复锁：`.duty-chip--tag` 里**不许出现十六进制**，只能引 token；
 *   ③ 接线锁：侧栏必须真的挂上 `--tag` + `data-mode`（否则色永远不生效）；
 *   ④ 负向锁：「进度」页那枚**不许**变成彩色 —— 那里的颜色已经在表达"当前模式"，
 *      再叠四色会把两个意思挤在一起。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER = resolve(__dirname, '..')
const TOKENS = readFileSync(resolve(RENDERER, 'styles/tokens.css'), 'utf8')
const INDEX_CSS = readFileSync(resolve(RENDERER, 'styles/index.css'), 'utf8')
const TREE = readFileSync(resolve(RENDERER, 'components/ProjectTree.vue'), 'utf8')
const DRAWER = readFileSync(
  resolve(RENDERER, 'features/progress/ProgressTimelineDrawer.vue'),
  'utf8'
)
const PROGRESS = readFileSync(resolve(RENDERER, 'views/Progress.vue'), 'utf8')

/** 时间线一直在用的那 8 个值 —— 逐字写死，防"顺手调个色"。 */
const DAY = {
  '--role-typeset': '#1d4ed8',
  '--role-translated': '#047857',
  // ⚠️ 2026-10-05 二改：从 #a16207 加深到 #854d0e —— 原值对"淡彩底"上的小字只有 4.32:1
  // （达不到 4.5），加深后 6.31:1。它是时间线与侧栏共用的 token，所以两处一起变深。
  '--role-proofread': '#854d0e',
  '--role-supervised': '#6d28d9'
}
const NIGHT = {
  '--role-typeset': '#93c5fd',
  '--role-translated': '#6ee7b7',
  '--role-proofread': '#fcd34d',
  '--role-supervised': '#c4b5fd'
}

/** 「标签」变体那一段 CSS（到它后面第一条注释为止）—— 好几条锁都要看它。 */
function tagSegment(): string {
  const start = INDEX_CSS.indexOf('.duty-chip--tag {')
  const end = INDEX_CSS.indexOf('/*', INDEX_CSS.indexOf("[data-mode='supervised']"))
  return INDEX_CSS.slice(start, end === -1 ? undefined : end)
}

/**
 * 按**选择器精确相等**取规则块。
 * ⚠️ 两个坑都真踩过：① `indexOf('.duty-chip--single {')` 会被 `.duty-chip--tag.duty-chip--single {`
 * 骗到（后者包含前者）；② 直接对原文跑 `/([^{}]+)\{/` 会把**前面的注释**当成选择器的一部分
 * （注释里没有花括号，`[^{}]+` 会一路吞过去）—— 所以先剥注释再匹配。
 */
function exactBlocks(selector: string): string[] {
  const stripped = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel]) => sel.trim().replace(/\s+/g, ' ') === selector)
    .map(([, , body]) => body)
}

/** 取出某个选择器的规则块（到第一个 `}` 为止）。 */
function blockOf(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`)
  expect(start, `找不到 ${selector} 的定义`).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('}', start))
}

/** 淡彩底（tonal）：昼夜各四个。2026-10-06 三改：日间亮度 95% → 91%（"不够明显"的反馈）。 */
const SOFT_DAY = {
  '--role-typeset-soft': 'hsl(221 85% 91%)',
  '--role-translated-soft': 'hsl(163 60% 91%)',
  '--role-proofread-soft': 'hsl(38 90% 91%)',
  '--role-supervised-soft': 'hsl(263 75% 91%)'
}
const SOFT_NIGHT = {
  '--role-typeset-soft': 'hsl(221 45% 22%)',
  '--role-translated-soft': 'hsl(163 35% 20%)',
  '--role-proofread-soft': 'hsl(38 45% 20%)',
  '--role-supervised-soft': 'hsl(263 45% 24%)'
}

describe('职责四色：token 是唯一真源', () => {
  it('日间四个 token 的取值就是时间线原来那四个（内容锁）', () => {
    for (const [name, value] of Object.entries(DAY)) {
      expect(TOKENS).toContain(`${name}: ${value};`)
    }
  })

  it('夜间四个 token 也在（同一组色换成夜间档）', () => {
    for (const [name, value] of Object.entries(NIGHT)) {
      expect(TOKENS).toContain(`${name}: ${value};`)
    }
  })

  it('时间线抽屉读 token，不再自己写十六进制（否则就是两套色）', () => {
    const style = DRAWER.slice(DRAWER.indexOf('<style'))
    expect(style).not.toMatch(/#[0-9a-fA-F]{6}/)
    expect(style).toContain('var(--role-typeset)')
    expect(style).toContain('var(--role-proofread)')
  })

  it('`.duty-chip--tag` 只引 token，四个 data-mode 都接上', () => {
    const body = tagSegment()
    expect(body).not.toMatch(/#[0-9a-fA-F]{6}/)
    for (const mode of ['typeset', 'translated', 'proofread', 'supervised']) {
      expect(body).toContain(`[data-mode='${mode}']`)
    }
    for (const name of Object.keys(DAY)) {
      expect(body).toContain(`var(${name})`)
    }
  })

  it('标签变体**没有外框**（这是"降噪"的核心：第一版的 1px 彩框被用户否掉了）', () => {
    const seg = tagSegment()
    expect(seg).not.toContain('inset 0 0 0 1px')
    expect(seg).not.toContain('border:')
  })

  it('标签变体用同色淡彩底：每段自带 --role-*-soft，容器底透明', () => {
    // 容器必须透明 —— 否则两段并排时会在边界处露出容器自己的底色
    expect(blockOf(INDEX_CSS, '.duty-chip--tag')).toContain('background: transparent')
    const seg = tagSegment()
    for (const name of Object.keys(SOFT_DAY)) {
      expect(seg).toContain(`var(${name})`)
    }
  })

  it('昼夜各四个淡彩底，取值不许飘', () => {
    for (const [name, value] of Object.entries(SOFT_DAY)) {
      expect(TOKENS).toContain(`${name}: ${value};`)
    }
    for (const [name, value] of Object.entries(SOFT_NIGHT)) {
      expect(TOKENS).toContain(`${name}: ${value};`)
    }
  })

  it('标签变体是**放大那一档**（20/40×20、12px/700），中性档仍是 15/30×18', () => {
    // 2026-10-06 三改：用户"不够明显、不美观" → 只把 --tag 放大（进度页那枚是切换控件，密度另算）。
    // ⚠️ 这条锁补的是对方只锁了**槽宽**（ProjectTree.spec 的 w-[40px]）而**没锁胶囊本身**的缺口 ——
    // 胶囊要是被改回 15px 而槽宽还留 40px，右边就会露出一截空隙。
    expect(exactBlocks('.duty-chip--tag').join('')).toContain('height: 20px')
    expect(exactBlocks('.duty-chip--tag.duty-chip--single').join('')).toContain('width: 20px')
    expect(exactBlocks('.duty-chip--tag.duty-chip--pair').join('')).toContain('width: 40px')
    const seg = tagSegment()
    expect(seg).toContain('font-size: 12px')
    expect(seg).toContain('font-weight: 700')
    // 中性档（「进度」页）不许被顺手放大 —— 那边 18px 高、15/30px 宽是有账的（截图工装里 progress 恒为 0 差异）
    expect(exactBlocks('.duty-chip').join('')).toContain('height: 18px')
    expect(exactBlocks('.duty-chip--single').join('')).toContain('width: 15px')
    expect(exactBlocks('.duty-chip--pair').join('')).toContain('width: 30px')
  })

  it('两段并排的分界缝还在（没有彩框之后，全靠它防「校监」粘成一个词）', () => {
    // tag 变体不许把 --seg--divide 那条中性缝压掉
    expect(INDEX_CSS).toContain('.duty-chip__seg--divide {')
    const tag = tagSegment()
    expect(tag).not.toContain('duty-chip__seg--divide')
  })
})

describe('接线：两处"真原语"都得带上色', () => {
  it('侧栏父级行的胶囊挂 --tag，且每段带 data-mode', () => {
    expect(TREE).toContain('duty-chip duty-chip--tag')
    expect(TREE).toContain(':data-mode="dutyMode"')
  })

})

describe('负向锁：「进度」页那枚**不许**变成彩色', () => {
  it('Progress.vue 的胶囊不带 --tag（那里颜色表达"当前模式"，不是"哪道工序"）', () => {
    const chipTags = PROGRESS.match(/class="duty-chip[^"]*"/g) ?? []
    expect(chipTags.length).toBeGreaterThan(0)
    for (const cls of chipTags) {
      expect(cls).not.toContain('duty-chip--tag')
    }
  })
})
