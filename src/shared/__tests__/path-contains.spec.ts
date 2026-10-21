// @vitest-environment node
/**
 * 「谁在谁里面」—— 全项目**唯一一处**路径包含规则（2026-10-05 收敛）。
 *
 * 为什么值得单独一个文件，而且必须拿 `path.win32` 做对照：
 *
 *   ① 这条规则 2026-10-04 咬过一次真事故 —— `path.relative()` 在**跨盘**时返回的是
 *      **绝对路径**（`E:\…`）而不是 `..\…`。只判 `''` / `'..'` / `'..\'` 的实现会把跨盘
 *      判成"在里面"，于是**所有 D 盘父级**的扫描根都被 E 盘那本「搬砖」连坐挡掉
 *      （实测把「鹅妈妈」连它 8 条真章节一起挡了）。
 *   ② 同一条毛病当时有**两处**实现：`isStrictlyInside` 修了、`isPathInside` 没修
 *      （影响 `isGroupingLevel`）。现在两处都走这里的同一份规则。
 *   ③ ⚠️ **对照必须用 `win32`**：主测试套件跑在 Linux 上，`node:path` 在那边是 **posix 语义**
 *      （反斜杠只是普通字符、根本没有盘符），拿它当"旧实现"对照等于没测。
 *      也正因为旧实现在 Linux 上"碰巧是对的"，`project-self-check.spec.ts` 里那条
 *      端到端跨盘锁在本机其实**咬不住** —— 规则改成平台无关的纯字符串实现之后，
 *      本文件的每一条锁在任何平台上都咬得住（含 Windows 真机）。
 *   ④ 反过来说：`shared/` **不许 import node 内置**（它要同时打进渲染层，见 §13 第 20 条），
 *      所以这里的规则是纯字符串实现 —— 这恰好也是它平台无关的原因。
 *
 * 语义（与旧实现逐条对齐，差分对照在下面）：
 *   · `isPathInside(容器, 候选)`        —— 候选在容器里，**等于容器**也算；
 *   · `isStrictlyInside(容器, 候选)`    —— 候选**严格**在容器里，等于容器**不算**；
 *   · 大小写不敏感、反斜杠与正斜杠等价、尾部分隔符忽略、`.` 与 `..` 段先折叠；
 *   · 不同的"卷"（盘符 / UNC 服务器共享）之间永远互不包含。
 */
import { describe, expect, it } from 'vitest'
import { win32 } from 'node:path'
import { isPathInside, isStrictlyInside, normalizePathKey } from '../paths'

/**
 * 旧实现（Windows 语义的 node:path 版）—— **只用于差分对照**，不是被测代码。
 * 这两个函数就是收敛前散在 `project-self-check.ts` 里的那两份。
 */
function legacyIsPathInside(container: string, candidate: string): boolean {
  const rel = win32.relative(win32.resolve(container), win32.resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${win32.sep}`))
}

function legacyIsStrictlyInside(container: string, candidate: string): boolean {
  const rel = win32.relative(win32.resolve(container), win32.resolve(candidate))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${win32.sep}`) && !win32.isAbsolute(rel)
}

describe('normalizePathKey —「路径当 key」的唯一一处归一化', () => {
  it('反斜杠→正斜杠、NFC、小写、剥尾斜杠（与收敛前两处逐字同义的实现一致）', () => {
    expect(normalizePathKey('D:\\漫画\\作品\\')).toBe('d:/漫画/作品')
    expect(normalizePathKey('D:\\漫画\\作品')).toBe('d:/漫画/作品')
    expect(normalizePathKey('D:/漫画/作品/')).toBe('d:/漫画/作品')
    // 盘根：剥掉尾斜杠之后就是卷本身（旧实现同此行为）
    expect(normalizePathKey('D:\\')).toBe('d:')
    // 组合字符（NFD）折成预组合（NFC）—— 与全站查找键同一套语义
    expect(normalizePathKey('D:\\漫画\\e\u0301')).toBe(normalizePathKey('D:\\漫画\\é'))
  })
})

describe('包含关系 — 同盘语料：新规则与旧实现逐条一致（差分对照）', () => {
  /** [容器, 候选] —— 全部是**同一个卷**，这一组两边必须给出同样的答案。 */
  const SAME_VOLUME_CORPUS: Array<[string, string]> = [
    ['D:\\漫画\\作品', 'D:\\漫画\\作品\\第1话'],
    ['D:\\漫画\\作品', 'D:\\漫画\\作品\\卷\\第1话'], // 多级
    ['D:\\漫画\\作品', 'D:\\漫画\\作品'], // 相等
    ['D:\\漫画\\作品', 'D:\\漫画\\作品5卷'], // ★字符串前缀相同但不是父子
    ['D:\\漫画\\作品5卷', 'D:\\漫画\\作品'], // 反向
    ['D:\\漫画\\作品', 'D:\\漫画\\他作品\\第1话'], // 兄弟
    ['D:\\漫画\\作品', 'D:\\漫画'], // 上级
    ['D:\\漫画\\作品\\', 'D:\\漫画\\作品\\子'], // 尾分隔符
    ['D:\\漫画\\作品', 'd:\\漫画\\作品\\子'], // 大小写
    ['D:\\漫画\\A\\..\\作品', 'D:\\漫画\\作品\\子'], // `..` 段
    ['D:\\漫画\\.\\作品', 'D:\\漫画\\作品\\子'], // `.` 段
    ['D:\\', 'D:\\作品'], // 盘根
    ['D:\\作品', 'D:\\'], // 盘根的反向
    ['\\\\srv\\share\\作品', '\\\\srv\\share\\作品\\子'], // UNC 内部
    ['\\\\srv\\share', '\\\\srv\\share\\作品\\子'], // UNC 共享根
    ['D:\\漫画\\作品', 'D:\\漫画\\作品\\子\\孙\\曾孙'] // 深
  ]

  it('isPathInside（等于容器也算）', () => {
    for (const [container, candidate] of SAME_VOLUME_CORPUS) {
      expect(
        isPathInside(container, candidate),
        `isPathInside(${container}, ${candidate}) 与旧实现不一致`
      ).toBe(legacyIsPathInside(container, candidate))
    }
  })

  it('isStrictlyInside（等于容器不算）', () => {
    for (const [container, candidate] of SAME_VOLUME_CORPUS) {
      expect(
        isStrictlyInside(container, candidate),
        `isStrictlyInside(${container}, ${candidate}) 与旧实现不一致`
      ).toBe(legacyIsStrictlyInside(container, candidate))
    }
  })

  it('"某作品" 不是 "某作品5卷" 的父目录 —— 分段比较，不是字符串前缀', () => {
    // 这条是"用 startsWith 实现包含关系"的经典坑：字符串上是前缀，路径上不是父子。
    expect(isPathInside('D:\\漫画\\某作品', 'D:\\漫画\\某作品5卷')).toBe(false)
    expect(isStrictlyInside('D:\\漫画\\某作品', 'D:\\漫画\\某作品5卷')).toBe(false)
    // 但真的父子必须是 true（否则上面的 false 就是靠"永远返回 false"骗来的）
    expect(isStrictlyInside('D:\\漫画\\某作品', 'D:\\漫画\\某作品\\第5卷')).toBe(true)
  })
})

/**
 * 这一组就是 2026-10-04 那次事故的**病灶本身**：旧实现把跨卷判成"在里面"。
 *
 * ⚠️ 每一行都写着"旧实现当时判什么" —— 别一刀切成"旧实现全错"：
 *   同一个 UNC **服务器**下的两个**不同共享**，`win32.relative()` 给的是 `..\..\other\…`，
 *   于是旧实现**碰巧是对的**（实测 `\\srv\share` → `\\srv\other\…` 得到 `..\..\other\…`）。
 *   真正踩空的是**卷不同**的那几类（盘符↔盘符、盘符↔UNC、服务器↔服务器）。
 *   把这条如实写下来，是为了以后有人看到"旧实现有时对"时不至于以为这里写错了。
 */
describe('包含关系 — 跨卷：旧实现把不同卷判成"在里面"（这就是要修的洞），新规则不', () => {
  const CROSS_VOLUME: Array<{
    container: string
    candidate: string
    label: string
    /** 旧实现（node:path 版）当时给出的答案 —— true 就是那个洞。 */
    legacyVerdict: boolean
  }> = [
    {
      container: 'D:\\漫画\\作品',
      candidate: 'Z:\\示例盘\\某作品B\\第1话',
      label: '盘符 → 盘符',
      legacyVerdict: true
    },
    {
      container: 'Z:\\示例盘\\某作品B',
      candidate: 'D:\\漫画\\作品\\第1话',
      label: '盘符 → 盘符（反向）',
      legacyVerdict: true
    },
    {
      container: 'D:\\漫画\\作品',
      candidate: '\\\\srv\\share\\作品\\子',
      label: '盘符 → UNC',
      legacyVerdict: true
    },
    {
      container: '\\\\srv\\share\\作品',
      candidate: 'D:\\漫画\\作品\\子',
      label: 'UNC → 盘符',
      legacyVerdict: true
    },
    {
      container: '\\\\srv\\share\\作品',
      candidate: '\\\\other\\share\\作品\\子',
      label: 'UNC 服务器 → 服务器',
      legacyVerdict: true
    },
    {
      container: '\\\\srv\\share\\作品',
      candidate: '\\\\srv\\other\\作品\\子',
      label: '同一服务器、不同共享（旧实现碰巧是对的）',
      legacyVerdict: false
    }
  ]

  for (const { container, candidate, label, legacyVerdict } of CROSS_VOLUME) {
    it(`${label}：不算"在里面"`, () => {
      // 先钉住"旧实现当时到底怎么答的"—— 变异/回归时这条会告诉你差在哪一类上。
      expect(legacyIsPathInside(container, candidate), '旧实现在这一行上的答案变了').toBe(
        legacyVerdict
      )
      // 新规则：不同卷永远互不包含（这一条对所有行都成立）。
      expect(isPathInside(container, candidate)).toBe(false)
      expect(isStrictlyInside(container, candidate)).toBe(false)
    })
  }

  it('2026-10-04 的真实形状：D 盘的根不会被 E 盘那本「搬砖」连坐', () => {
    expect(isStrictlyInside('D:\\漫画库\\某作品A', 'Z:\\示例盘\\某作品B\\第1话')).toBe(false)
    // 反向也不能"在里面"（否则 E 盘那本会被 D 盘的所有父级连坐）
    expect(isStrictlyInside('Z:\\示例盘\\某作品B', 'D:\\漫画库\\某作品A')).toBe(false)
  })

  it('同一父级的两个根跨盘时，另一盘根下面的候选不再被误判成容器层（isGroupingLevel 的形状）', () => {
    // `isGroupingLevel(candidate, roots)` 的判据是 `isPathInside(candidate, root)`：
    // 「候选是不是某个根本身、或某个根的祖先」。
    const candidateOnD = 'D:\\漫画库\\作品\\第2話'
    const rootOnE = 'Z:\\示例盘\\某作品B'
    expect(isPathInside(candidateOnD, rootOnE)).toBe(false) // ⇒ 不是容器层，候选保得住
    // 真正的容器层仍然必须被认出来（否则上面那条 false 就是靠"永远 false"骗来的）
    const container = 'D:\\漫画库\\作品'
    const rootInsideIt = 'D:\\漫画库\\作品\\无'
    expect(isPathInside(container, rootInsideIt)).toBe(true)
  })
})

/**
 * 已知差异 —— 写清楚，**别当成遗漏**（与 `pair.ts` 那份"已知差异"同一个规矩）。
 * 每一条都只在"库里的路径本来就不该长这样"的输入上出现。
 */
describe('包含关系 — 与旧实现的三处已知差异（都不可达或更安全）', () => {
  it('相对路径 / 盘符相对路径：不再拿去和当前工作目录拼接（一律按字面分段）', () => {
    // 旧实现会 `resolve()`，于是"相对路径"的含义取决于进程当时的工作目录 ——
    // 同一个库在两台机器上可能给出不同答案。本项目的调用点全部用绝对路径，
    // 所以这里选"按字面比较"：结果稳定，且不会因为 cwd 变化而变。
    expect(isPathInside('D:\\漫画\\作品', 'D:\\漫画\\作品\\子')).toBe(true)
    expect(isPathInside('D:作品', 'D:\\漫画\\作品\\子')).toBe(false)
  })

  it('空路径不再等于"当前目录"（一律判 false，更安全）', () => {
    expect(isPathInside('', 'D:\\漫画\\作品')).toBe(false)
    expect(isPathInside('D:\\漫画\\作品', '')).toBe(false)
    expect(isStrictlyInside('D:\\漫画\\作品', '')).toBe(false)
  })

  it('NFC 折叠：只差 Unicode 组合方式的路径视为同一个（与全站查找键同一套语义）', () => {
    // 旧实现（node）不做 Unicode 归一化，会判成两个目录；本规则跟着查找键走。
    // 只有"用 NFD 组合方式命名的文件夹"会碰到这一条。
    expect(isStrictlyInside('D:\\漫画\\é', 'D:\\漫画\\e\u0301\\第1话')).toBe(true)
  })
})
