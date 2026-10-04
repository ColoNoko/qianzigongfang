// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  BOOT_THEME_COLORS_FLAG,
  BOOT_THEME_MODE_FLAG,
  parseBootThemeArguments
} from '../boot-theme-args'

describe('parseBootThemeArguments', () => {
  it('reads the pair the main process appends', () => {
    expect(
      parseBootThemeArguments([
        'electron.exe',
        `${BOOT_THEME_MODE_FLAG}dark`,
        `${BOOT_THEME_COLORS_FLAG}222,70,12`
      ])
    ).toEqual({ mode: 'dark', colors: { hue: 222, saturation: 70, neutralSaturation: 12 } })
  })

  it('keeps the mode when the colors are unusable', () => {
    for (const argv of [
      ['x', `${BOOT_THEME_MODE_FLAG}light`],
      ['x', `${BOOT_THEME_MODE_FLAG}light`, `${BOOT_THEME_COLORS_FLAG}222,70`],
      ['x', `${BOOT_THEME_MODE_FLAG}light`, `${BOOT_THEME_COLORS_FLAG}a,b,c`]
    ]) {
      expect(parseBootThemeArguments(argv)).toEqual({ mode: 'light', colors: null })
    }
  })

  it.each([
    ['no arguments at all', []],
    ['an unrelated flag', ['electron.exe', '--enable-logging']],
    ['an unknown mode', ['x', `${BOOT_THEME_MODE_FLAG}midnight`]],
    ['a bare flag with no value', ['x', BOOT_THEME_MODE_FLAG]],
    ['a mode in the colors slot', ['x', `${BOOT_THEME_COLORS_FLAG}222,70,12`]]
  ])('returns null for %s', (_label, argv) => {
    expect(parseBootThemeArguments(argv)).toBeNull()
  })

  it('ignores unrelated arguments around the pair', () => {
    expect(
      parseBootThemeArguments([
        'electron.exe',
        '--enable-logging',
        `${BOOT_THEME_MODE_FLAG}system`,
        '--remote-debugging-port=0',
        `${BOOT_THEME_COLORS_FLAG}32,82,9`
      ])
    ).toEqual({ mode: 'system', colors: { hue: 32, saturation: 82, neutralSaturation: 9 } })
  })
})
