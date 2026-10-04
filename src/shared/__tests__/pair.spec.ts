import { basename, extname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { basenameOf } from '../paths'
import { pairKeyOf } from '../pair'

/**
 * 配对键（2026-10-01 重构 P2）。
 *
 * 这一组要证明的是：`pairKeyOf()` 与**收编之前那两套写法**在**所有可达输入**上逐字一致。
 * 所以下面每次都把"旧写法"当场算一遍（扫描器那份直接用 node 的 `basename`/`extname`，
 * 因为那正是它原来的实现；对照视图那份按它原来的 `lastIndexOf('.')` 写法复刻），而不是手抄期望值。
 *
 * ⚠️ 写这组测试的过程本身就有价值：第一版语料里带了 `'E:\\a\\b\\'`（尾分隔符），
 * 当场把断言打红 —— node 的 `basename()` 会剥掉尾分隔符（给 `b`），而朴素 `pop()` 给空串。
 * 于是 `pairKeyOf` 改用"取最后一段**非空**内容"，与 node 语义对齐。这类差异靠读代码是看不出来的。
 */

/** 旧写法 A：扫描器 `getStemLookupKey()`（= node 的 basename + extname）。 */
const oldScannerKey = (p: string): string =>
  basename(p, extname(p)).normalize('NFC').toLocaleLowerCase()

/** 旧写法 B：对照视图 `stemKey()`（它原来的 `basename` 已是 P1 的共享实现 —— 朴素 pop 语义）。 */
const oldViewerKey = (p: string): string => {
  const name = basenameOf(p)
  const dot = name.lastIndexOf('.')
  return (dot >= 0 ? name.slice(0, dot) : name).normalize('NFC').toLocaleLowerCase()
}

/** 真实世界里会出现的输入：中文目录、大小写扩展名、多重点、混合分隔符、无扩展名、组合字符。 */
const REACHABLE = [
  'E:\\示例素材\\搬砖\\无\\第5话\\output\\000.psd',
  'E:\\漫画\\ch5\\001.JPG',
  '/home/u/ch5/002.jpeg',
  'mixed\\slash/003.png',
  'a.b.c.psd',
  'D:\\x\\第12話\\012.webp',
  'noextension',
  '',
  'café.psd', // NFC 形式
  'cafe\u0301.psd', // NFD 形式 —— 必须与上一行得到同一个键（NFC 存在的理由）
  'ＡＢＣ.psd'
]

describe('pairKeyOf —— 与两侧旧写法在可达输入上逐字一致', () => {
  it.each(REACHABLE)('输入 %j：扫描器那套', (p) => {
    expect(pairKeyOf(p)).toBe(oldScannerKey(p))
  })

  it.each(REACHABLE)('输入 %j：对照视图那套', (p) => {
    expect(pairKeyOf(p)).toBe(oldViewerKey(p))
  })

  it('因此两侧对同一张图得到同一个键（这正是"一本账"的意义）', () => {
    for (const p of REACHABLE) {
      expect(oldScannerKey(p)).toBe(oldViewerKey(p))
      expect(pairKeyOf(p)).toBe(oldScannerKey(p))
    }
  })

  it('组合/分解字符（NFC vs NFD）必须塌成同一个键', () => {
    expect(pairKeyOf('café.psd')).toBe(pairKeyOf('cafe\u0301.psd'))
  })

  it('大小写不敏感（Windows 上同一个文件的大小写变体）', () => {
    expect(pairKeyOf('D:\\Manga\\Page.PSD')).toBe(pairKeyOf('d:\\manga\\page.psd'))
  })

  it('多重点只砍最后一个（`a.b.c.psd` → `a.b.c`）', () => {
    expect(pairKeyOf('a.b.c.psd')).toBe('a.b.c')
  })
})

/**
 * 两处**已知差异**：都是"两侧旧写法本来就不同"的地方，本函数统一按**扫描器**语义（= node 语义）。
 * 它们在实践中**不可达** —— 两侧都只对"扩展名在白名单里"的**文件路径**求键：
 *   · `.hidden` 的 `extname` 是空串，进不了图片白名单；
 *   · 目录路径（尾分隔符）不是文件，扫描器与对照视图拿到的都是文件路径。
 * 写在这里是为了：将来谁看到差异能一眼知道"这是已知的、有理由的"，而不是当 bug 去"修"。
 */
describe('已知差异（不可达，按扫描器语义统一）', () => {
  it('① 整段名字就是隐藏文件：旧对照视图写法给空串，本函数给原名字', () => {
    expect(oldViewerKey('.hidden')).toBe('')
    expect(oldScannerKey('.hidden')).toBe('.hidden')
    expect(pairKeyOf('.hidden')).toBe('.hidden')
  })

  it('② 尾分隔符路径：旧对照视图写法给空串，本函数与 node `basename` 一致给最后一段', () => {
    expect(oldViewerKey('E:\\a\\b\\')).toBe('')
    expect(oldScannerKey('E:\\a\\b\\')).toBe('b')
    expect(pairKeyOf('E:\\a\\b\\')).toBe('b')
  })

  it('不可达性的机械证据：这两种输入都进不了图片/PSD 白名单', () => {
    const WHITELIST = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.jfif', '.psd']
    expect(extname('.hidden')).toBe('')
    expect(WHITELIST).not.toContain(extname('.hidden'))
    // 目录路径的 basename 同样拿不到白名单里的扩展名
    expect(WHITELIST).not.toContain(extname('E:\\a\\b\\'))
  })
})
