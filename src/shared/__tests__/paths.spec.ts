import { describe, expect, it } from 'vitest'
import { basenameOf, lastPathSegment } from '../paths'

/**
 * 路径整形（2026-10-01 重构 P1）。
 *
 * 这一组的目的**不是**"定义新行为"，而是**证明与改前的写法逐字一致** ——
 * 所以下面每个用例都把"旧写法"当场算一遍再对比，而不是手抄期望值
 * （手抄的期望值一旦抄错，就等于把 bug 固化下来还看不出来）。
 */

/** 旧写法 A：11 处里大多数的那种。 */
const oldPlain = (path: string): string => path.split(/[\\/]/).pop() ?? path
/** 旧写法 B：带 `.filter(Boolean)` 的那种（空段会被跳过）。 */
const oldFiltered = (path: string, fallback: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? fallback

const SAMPLES = [
  'E:\\示例素材\\搬砖\\无\\第5话\\output\\000.psd',
  'E:/comics/ch5/output/000.psd',
  '/home/user/comics/000.psd',
  'mixed\\slashes/inside/000.psd',
  '000.psd',
  '',
  'E:\\漫画\\第5话\\',
  '/',
  '\\\\server\\share\\folder\\',
  '带 空格 和 中文 \\ 文件.psd'
]

describe('basenameOf —— 与旧写法 `.split(/[\\/]/).pop()` 逐字一致', () => {
  it.each(SAMPLES)('输入 %j', (path) => {
    expect(basenameOf(path)).toBe(path.split(/[\\/]/).pop())
  })

  it('旧代码里那些 `?? 整条路径` 的兜底其实是死代码（pop 永不返回 undefined）', () => {
    for (const path of SAMPLES) {
      expect(basenameOf(path)).toBe(oldPlain(path))
    }
  })

  it('尾部分隔符 → 空串（这是旧行为，别"顺手修"）', () => {
    expect(basenameOf('E:\\漫画\\第5话\\')).toBe('')
    expect(basenameOf('/')).toBe('')
  })
})

describe('lastPathSegment —— 与旧写法 `.filter(Boolean).pop() ?? fallback` 逐字一致', () => {
  it.each(SAMPLES)('输入 %j（fallback 为整条路径）', (path) => {
    expect(lastPathSegment(path, path)).toBe(oldFiltered(path, path))
  })

  it.each(SAMPLES)('输入 %j（fallback 为空串）', (path) => {
    expect(lastPathSegment(path)).toBe(oldFiltered(path, ''))
  })

  it('尾部分隔符会被跳过（这才是显示"名字"想要的行为）', () => {
    expect(lastPathSegment('E:\\漫画\\第5话\\')).toBe('第5话')
    expect(lastPathSegment('/home/user/comics/')).toBe('comics')
  })

  it('整条为空时给 fallback', () => {
    expect(lastPathSegment('', '兜底')).toBe('兜底')
    expect(lastPathSegment('\\', '兜底')).toBe('兜底')
    expect(lastPathSegment('')).toBe('')
  })
})
