/**
 * The argv contract between the main process and the preload bridge.
 *
 * The main process appends the persisted theme to the renderer's command line
 * (`webPreferences.additionalArguments`) so the preload can hand it over
 * synchronously; this module owns the flag names so both sides cannot drift
 * apart, and the parser so the accepted shapes are testable without Electron.
 */
import type { BootThemeMode, BootThemeSnapshot } from './ipc-api'

export const BOOT_THEME_MODE_FLAG = '--qianzi-theme-mode='
export const BOOT_THEME_COLORS_FLAG = '--qianzi-theme-colors='

const VALID_MODES: readonly BootThemeMode[] = ['light', 'dark', 'system'] as const

/**
 * Read the snapshot out of an argv array (typically `process.argv`).
 *
 * Returns null when the mode is missing or malformed — the renderer then falls
 * back to localStorage. A valid mode with unusable colors keeps the mode and
 * reports `colors: null` rather than discarding the whole snapshot.
 */
export function parseBootThemeArguments(argv: readonly string[]): BootThemeSnapshot | null {
  const mode = argv
    .find((arg) => arg.startsWith(BOOT_THEME_MODE_FLAG))
    ?.slice(BOOT_THEME_MODE_FLAG.length)
  if (!VALID_MODES.includes(mode as BootThemeMode)) return null

  const rawColors = argv
    .find((arg) => arg.startsWith(BOOT_THEME_COLORS_FLAG))
    ?.slice(BOOT_THEME_COLORS_FLAG.length)
  const parts = (rawColors ?? '').split(',').map((part) => Number(part))
  const colors =
    parts.length === 3 && parts.every((value) => Number.isFinite(value))
      ? { hue: parts[0], saturation: parts[1], neutralSaturation: parts[2] }
      : null

  return { mode: mode as BootThemeMode, colors }
}
