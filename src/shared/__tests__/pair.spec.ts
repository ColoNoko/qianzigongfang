import { expect, it } from 'vitest'
import { pairKeyOf } from '../pair'

it.each([
  ['C:/漫画/001.PSD', '001'],
  ['mixed\\slash/003.png', '003'],
  ['a.b.c.psd', 'a.b.c'],
  ['cafe\u0301.psd', 'café'],
  ['ＡＢＣ.psd', 'ａｂｃ'],
  ['noextension', 'noextension'],
  ['.hidden', '.hidden'],
  ['E:/a/b/', 'b'],
  ['', '']
])('配对键 %s → %s', (input, expected) => {
  expect(pairKeyOf(input)).toBe(expected)
})
