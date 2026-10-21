import { expect, it } from 'vitest'
import { resolveFont, fontReference } from '../resolve'
import type { SystemFontInfo } from '../../ipc-api'
const regular = {
  id: 'collection',
  family: 'Fixture',
  style: 'Regular',
  postScriptName: 'Fixture-Regular',
  filePath: 'fixture.ttc',
  faceIndex: 0
} as SystemFontInfo
const italic = {
  ...regular,
  id: 'collection:1',
  style: 'Italic',
  postScriptName: 'Fixture-Italic',
  faceIndex: 1
}
it('restores a saved TTC face by real PostScript name before an older file-only ID', () => {
  expect(resolveFont({ ...fontReference(italic), id: regular.id }, [regular, italic])).toEqual({
    status: 'exact',
    font: italic
  })
})
it('does not fabricate a PostScript name and distinguishes substitution from exact matches', () => {
  expect(() => fontReference({ ...regular, postScriptName: '' })).toThrow('PostScript')
  expect(
    resolveFont({ ...fontReference(regular), postScriptName: 'MissingFont' }, [regular]).status
  ).toBe('substitute')
  expect(
    resolveFont(
      {
        ...fontReference(regular),
        family: 'Missing',
        id: 'unknown',
        postScriptName: 'MissingFont'
      },
      [regular]
    ).status
  ).toBe('missing')
})
