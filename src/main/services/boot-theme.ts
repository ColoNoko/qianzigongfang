/**
 * First-paint theme hand-off.
 *
 * The renderer needs the persisted theme *synchronously* — waiting for an async
 * `storeGet` after mount means a dark-mode user sees the light default flash on
 * every launch. The main process reads the value it already has in the store
 * and appends it to the renderer's argv (`webPreferences.additionalArguments`),
 * where the preload can read it before Vue exists.
 *
 * Parsing lives here, free of Electron imports, so the accepted shapes can be
 * unit-tested. The rules mirror the renderer's `parseThemeMode` /
 * `normalizeThemeColors`: a bare mode string or the legacy `{ mode, colors }`
 * wrapper both count.
 */
import type { BootThemeColorSettings, BootThemeMode } from '../../shared/ipc-api'
import { BOOT_THEME_COLORS_FLAG, BOOT_THEME_MODE_FLAG } from '../../shared/boot-theme-args'

// Re-exported so callers (and the unit tests) have one obvious import site for
// the main-process side of the hand-off.
export { BOOT_THEME_COLORS_FLAG, BOOT_THEME_MODE_FLAG }

const VALID_MODES: readonly BootThemeMode[] = ['light', 'dark', 'system'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMode(value: unknown): value is BootThemeMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value)
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Accepts `"dark"` or the legacy `{ mode: "dark" }` / `{ theme: "dark" }`. */
export function parseStoredThemeMode(value: unknown): BootThemeMode | null {
  if (isMode(value)) return value
  if (!isRecord(value)) return null
  const nested = value.mode ?? value.theme
  return isMode(nested) ? nested : null
}

/** Accepts `{ hue, saturation, neutralSaturation }` including the legacy aliases. */
export function parseStoredThemeColors(value: unknown): BootThemeColorSettings | null {
  if (!isRecord(value)) return null
  const hue = boundedInteger(value.hue, 0, 360)
  const saturation = boundedInteger(value.saturation ?? value.sat, 0, 100)
  const neutralSaturation = boundedInteger(value.neutralSaturation ?? value.neutralSat, 0, 30)
  if (hue === null || saturation === null || neutralSaturation === null) return null
  return { hue, saturation, neutralSaturation }
}

/**
 * Build the argv entries for the renderer.
 *
 * Returns an empty array when no valid mode is stored (first launch) or when
 * the store could not be read — the renderer then keeps its own defaults.
 * Values are ASCII only, so they survive Windows argv round-tripping.
 */
export function buildBootThemeArguments(modeValue: unknown, colorValue?: unknown): string[] {
  const mode = parseStoredThemeMode(modeValue)
  if (!mode) return []

  const nested = isRecord(modeValue) ? (modeValue.colors ?? modeValue) : null
  const colors = parseStoredThemeColors(colorValue) ?? parseStoredThemeColors(nested)

  const args = [`${BOOT_THEME_MODE_FLAG}${mode}`]
  if (colors) {
    args.push(
      `${BOOT_THEME_COLORS_FLAG}${colors.hue},${colors.saturation},${colors.neutralSaturation}`
    )
  }
  return args
}
