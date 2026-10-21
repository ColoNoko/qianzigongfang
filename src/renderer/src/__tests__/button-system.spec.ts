// @vitest-environment node
/**
 * 按钮统一体系（`.ui-button` / `.ui-button-sm`）的**真源锁**（2026-10-05）。
 *
 * 为什么直接读样式文件：迁移之后，"按钮多高、字多大"不再写在每个模板里，
 * 而是由 `styles/index.css` 的两个类决定。于是**这一处就是唯一真源** ——
 * 谁把它改成 34px、或者塞进第三档高度，这里要立刻红。
 *
 * 同时锁那条**可访问性**规则：隐藏的原生复选框，焦点环必须画在它旁边那个可见的开关上
 * （以前画在 `sr-only` 的输入本体上，键盘用户完全看不到焦点在哪）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8')
const SRC = resolve(__dirname, '../../..')

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

/** 取出某个类名的规则块（到第一个 `}` 为止）。 */
function blockOf(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `styles/index.css 里找不到 ${selector} 的定义`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('按钮统一体系：两档高度（唯一真源 = styles/index.css）', () => {
  it('常规档 = 36px / 14px，紧凑档 = 32px / 12px', () => {
    const base = blockOf('.ui-button')
    expect(base).toContain('height: 36px')
    expect(base).toContain('font-size: 14px')

    const small = blockOf('.ui-button-sm')
    expect(small).toContain('height: 32px')
    expect(small).toContain('font-size: 12px')
  })

  it('高度只在这两个类里定：不许出现第三档（比如 34px / 40px）', () => {
    // 按规则块解析，而不是一条大正则：后者会跨规则块乱匹配（写错过一次）。
    const heightOf = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector, body]) => ({
        selector: selector.trim().replace(/\s+/g, ' '),
        body
      }))
      .filter((rule) => rule.selector.includes('.ui-button'))
      .map((rule) => /height:\s*(\d+)px/.exec(rule.body)?.[1])
      .filter((value): value is string => Boolean(value))

    expect(heightOf.sort()).toEqual(['32', '36'])
  })

  it('隐藏复选框的焦点环画在可见开关上（键盘可达性）', () => {
    expect(css).toContain('input.sr-only:focus-visible + span')
  })
})

/**
 * 三级按钮语言的**第一级**（「主 = 实心 accent」）—— 2026-10-07 才收成类。
 *
 * 收口前，它是一串 5 个类名在 30 多处复制粘贴：
 *   bg-accent text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active
 * 于是"主按钮换个悬停色"要改 30+ 处、必漏几处 —— 漏掉的那几处就是肉眼看到的"不统一"。
 *
 * 三条锁：
 *   ① 取值锁：四个状态全部走 token，本类里**不许出现任何字面色**；
 *   ② 等价锁：`transition-*` 三行必须与 Tailwind `transition-colors` 的编译产物逐字一致
 *      （迁移是"逐类等价"而不是重新设计，这三行就是证据）；
 *   ③ 负向锁：源码里不许再有"自己拼主按钮"，且这个类必须真的被引用。
 */
describe('主按钮：`bg-accent…` 那串咒语只许在 styles/index.css 里出现一次', () => {
  const PRIMARY_TOKENS = {
    'background-color: var(--accent);': '常态底',
    'color: var(--text-on-accent);': '常态字',
    'background-color: var(--primary-hover);': '悬停底',
    'background-color: var(--primary-active);': '按下底'
  }

  it('四个状态的取值全部来自 token，一个都不许写字面色', () => {
    const body = css.slice(css.indexOf('.ui-button-primary'))
    const segment = body.slice(0, body.indexOf('.ui-button:disabled'))
    for (const [declaration, role] of Object.entries(PRIMARY_TOKENS)) {
      expect(segment, `主按钮缺了「${role}」：${declaration}`).toContain(declaration)
    }
    expect(segment).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(segment).not.toMatch(/\brgba?\(/)
    expect(segment).not.toMatch(/\bhsl\(/)
  })

  it('过渡三行与 Tailwind `transition-colors` 的编译产物一字不差（等价迁移的证据）', () => {
    const body = css.slice(css.indexOf('.ui-button-primary'))
    const segment = body.slice(0, body.indexOf('.ui-button:disabled'))
    expect(segment).toContain(
      'transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;'
    )
    expect(segment).toContain('transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);')
    expect(segment).toContain('transition-duration: 150ms;')
  })

  it('源码里再没有"自己拼的主按钮"（bg-accent + hover:bg-primary-hover 同串出现）', () => {
    const offenders: string[] = []
    for (const file of vueFiles(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const quoted of line.matchAll(/'([^'<>{}]*)'|"([^"<>{}]*)"|`([^`<>{}]*)`/g)) {
            const value = quoted[1] ?? quoted[2] ?? quoted[3] ?? ''
            const tokens = value.split(/\s+/)
            if (tokens.includes('bg-accent') && tokens.includes('hover:bg-primary-hover')) {
              offenders.push(`${'src/' + relative(SRC, file).split(sep).join('/')}:${index + 1}  ${value.trim()}`)
            }
          }
        })
    }
    expect(offenders, `还在自己拼主按钮：\n${offenders.join('\n')}`).toEqual([])
  })

  it('这个类必须真的被引用（防止类被删而站点还在指着它）', () => {
    const uses = vueFiles(SRC).reduce((sum, file) => {
      return sum + (readFileSync(file, 'utf8').match(/\bui-button-primary\b/g)?.length ?? 0)
    }, 0)
    // 迁移时是 35 处；门槛取 30，留一点正常增删的余量，但"类被删光"必须红。
    expect(uses).toBeGreaterThanOrEqual(30)
  })
})
