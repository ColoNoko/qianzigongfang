import { describe, expect, it } from 'vitest'
import {
  compareChapterNumbers,
  compareChapterNumbersByOrder,
  extractChapterNumber,
  formatChapterNumber,
  isValidChapterNumber,
  sanitizeChapterInput
} from '../chapter'

describe('chapter number helpers', () => {
  it('extracts and normalizes the final number from common folder names', () => {
    expect(extractChapterNumber('七龙珠003')).toBe('3')
    expect(extractChapterNumber('第001.50話')).toBe('1.5')
    expect(extractChapterNumber('作品名')).toBe('')
  })

  it('keeps Chinese, digits and a single decimal point for manual input', () => {
    expect(sanitizeChapterInput('第03..5話')).toBe('第03.5話')
    expect(isValidChapterNumber('3.5')).toBe(true)
    expect(isValidChapterNumber('番外篇')).toBe(true)
    expect(isValidChapterNumber('3.')).toBe(false)
  })

  it('formats normalized and legacy values consistently', () => {
    expect(formatChapterNumber('003')).toBe('第3集')
    expect(formatChapterNumber('第3話')).toBe('第3集')
  })

  it('sorts Chinese/custom chapter labels after numeric chapters', () => {
    const chapters = ['番外篇', '10', '2', '后日谈']
    expect(chapters.sort(compareChapterNumbers)).toEqual(['2', '10', '番外篇', '后日谈'])
  })

  it('reverses numeric chapters without moving custom labels before them', () => {
    const chapters = ['番外篇', '10', '2', '后日谈']
    expect(
      chapters.sort((left, right) => compareChapterNumbersByOrder(left, right, 'descending'))
    ).toEqual(['10', '2', '后日谈', '番外篇'])
  })
})
