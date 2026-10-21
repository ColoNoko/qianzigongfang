// @vitest-environment node
/**
 * 「另存为」文件名的清洗规则（**唯一一处**）。
 *
 * 为什么值得单独立一条锁：译文栏这一个功能里就有两处给"另存为"起默认名
 * （导出校对记录 / 另存一份译文），每处各写一遍就会分叉 ——
 * 而那种分叉只在"作品名里正好带 `?`"的时候才现形，用户看到的是"另存失败"。
 */
import { describe, expect, it } from 'vitest'
import { sanitizeFileNamePart } from '../file-name'

describe('文件名那一段怎么洗', () => {
  it('Windows 不许的字符换成下划线（`\\ / : * ? " < > |`）', () => {
    expect(sanitizeFileNamePart('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('连续空白压成一个、去首尾空白（不把 `\\n` 留在文件名里）', () => {
    expect(sanitizeFileNamePart('  作  品\n第 1 话  ')).toBe('作 品 第 1 话')
  })

  it('空 / null / undefined 都回空串（调用方自己决定兜底名）', () => {
    expect(sanitizeFileNamePart('')).toBe('')
    expect(sanitizeFileNamePart(null)).toBe('')
    expect(sanitizeFileNamePart(undefined)).toBe('')
    expect(sanitizeFileNamePart('   ')).toBe('')
  })

  it('中文与日文原样留着（不做"像不像文件名"的推断）', () => {
    expect(sanitizeFileNamePart('ドラゴンボール-第1話')).toBe('ドラゴンボール-第1話')
  })
})
