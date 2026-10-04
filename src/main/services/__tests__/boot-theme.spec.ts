// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseBootThemeArguments } from '@shared/boot-theme-args'
import {
  BOOT_THEME_COLORS_FLAG,
  BOOT_THEME_MODE_FLAG,
  buildBootThemeArguments,
  parseStoredThemeColors,
  parseStoredThemeMode
} from '../boot-theme'

describe('parseStoredThemeMode', () => {
  it('accepts the plain stored string', () => {
    expect(parseStoredThemeMode('dark')).toBe('dark')
    expect(parseStoredThemeMode('system')).toBe('system')
  })

  it('accepts the legacy wrapper object', () => {
    expect(parseStoredThemeMode({ mode: 'light' })).toBe('light')
    expect(parseStoredThemeMode({ theme: 'dark' })).toBe('dark')
  })

  it('rejects anything else', () => {
    expect(parseStoredThemeMode('midnight')).toBeNull()
    expect(parseStoredThemeMode(null)).toBeNull()
    expect(parseStoredThemeMode({ mode: 1 })).toBeNull()
  })
})

describe('parseStoredThemeColors', () => {
  it('reads the canonical triple, clamping out-of-range values', () => {
    expect(parseStoredThemeColors({ hue: 400, saturation: 82, neutralSaturation: 9 })).toEqual({
      hue: 360,
      saturation: 82,
      neutralSaturation: 9
    })
  })

  it('reads the legacy aliases', () => {
    expect(parseStoredThemeColors({ hue: 32, sat: 82, neutralSat: 9 })).toEqual({
      hue: 32,
      saturation: 82,
      neutralSaturation: 9
    })
  })

  it('rejects incomplete or non-numeric input', () => {
    expect(parseStoredThemeColors(undefined)).toBeNull()
    expect(parseStoredThemeColors({ hue: 32 })).toBeNull()
    expect(parseStoredThemeColors({ hue: 'a', saturation: 1, neutralSaturation: 1 })).toBeNull()
  })
})

describe('buildBootThemeArguments', () => {
  it('emits the mode and colors as ASCII argv entries', () => {
    expect(
      buildBootThemeArguments('dark', { hue: 222, saturation: 70, neutralSaturation: 12 })
    ).toEqual([`${BOOT_THEME_MODE_FLAG}dark`, `${BOOT_THEME_COLORS_FLAG}222,70,12`])
  })

  it('reads colors nested in the legacy wrapper when the separate key is empty', () => {
    expect(
      buildBootThemeArguments({
        mode: 'dark',
        colors: { hue: 200, saturation: 60, neutralSaturation: 8 }
      })
    ).toEqual([`${BOOT_THEME_MODE_FLAG}dark`, `${BOOT_THEME_COLORS_FLAG}200,60,8`])
  })

  it('still reports the mode when the colors are unusable', () => {
    expect(buildBootThemeArguments('light', 'nonsense')).toEqual([`${BOOT_THEME_MODE_FLAG}light`])
  })

  it('emits nothing when no theme was ever persisted', () => {
    expect(buildBootThemeArguments(undefined, undefined)).toEqual([])
    expect(buildBootThemeArguments({}, {})).toEqual([])
  })

  it('produces arguments the preload parser reads back unchanged', () => {
    // The two halves of the hand-off live on different sides of the IPC
    // boundary, so pin the contract down end to end.
    const argv = ['electron.exe', ...buildBootThemeArguments('dark', { hue: 32, sat: 82, neutralSat: 9 })]
    expect(parseBootThemeArguments(argv)).toEqual({
      mode: 'dark',
      colors: { hue: 32, saturation: 82, neutralSaturation: 9 }
    })
  })
})
