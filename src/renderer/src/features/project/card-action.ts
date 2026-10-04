import type { WorkMode } from '@shared/types'

/**
 * Card-action routing — decides what the thumbnail/compare "去X" button does.
 *
 * Pure by design: no store, no IPC, no Vue. The whole mode × PSD-state matrix
 * is therefore unit-testable without mounting a component, and the executor in
 * `external-tool.ts` is the only place that touches the outside world.
 */

/** Modes whose work happens in the external translation editor. */
const EXTERNAL_EDITOR_MODES: readonly WorkMode[] = ['translated', 'proofread'] as const

export const TOOL_NOT_CONFIGURED_MESSAGE = '尚未配置翻译工具，请先在「设置 → 外部工具」里指定可执行文件路径'
export const PHOTOSHOP_NOT_CONFIGURED_MESSAGE =
  '尚未配置 Photoshop 程序，请先在「设置 → 外部工具」里指定其路径'
export const IMPORT_TOOL_LAUNCH_FAILED_MESSAGE = '启动 Photoshop 失败'
export const OPEN_FILE_FAILED_MESSAGE = '打开文件失败'

export interface CardActionConfig {
  translationToolPath: string
  photoshopPath: string
  importScriptPath: string
  skipPsFallbackPrompt: boolean
}

export type CardAction =
  /** Open the pair's PSD through its OS association. */
  | { kind: 'open-psd' }
  /** Run the 译文导入 script inside Photoshop. */
  | { kind: 'run-import-script'; photoshopPath: string; scriptPath: string }
  /** Launch Photoshop with nothing loaded. */
  | { kind: 'open-photoshop'; photoshopPath: string }
  /** Launch the configured translation/proofreading editor. */
  | { kind: 'launch-tool'; toolPath: string }
  /** Ask the user once, then fall back to Photoshop. */
  | { kind: 'ask-ps-fallback' }
  /** Nothing can be launched — report this message instead. */
  | { kind: 'blocked'; message: string }

/**
 * 嵌字 needs the 译文导入 script to create the PSDs for a chapter that has none;
 * 监修 only needs Photoshop at hand. Both watch the PSD in Photoshop once it
 * exists. 翻译/校对 always go to the external editor.
 */
export function resolveCardAction(
  mode: WorkMode,
  hasPsd: boolean,
  config: CardActionConfig
): CardAction {
  if (EXTERNAL_EDITOR_MODES.includes(mode)) {
    return config.translationToolPath
      ? { kind: 'launch-tool', toolPath: config.translationToolPath }
      : { kind: 'blocked', message: TOOL_NOT_CONFIGURED_MESSAGE }
  }

  if (hasPsd) {
    return { kind: 'open-psd' }
  }

  if (mode === 'supervised') {
    return config.photoshopPath
      ? { kind: 'open-photoshop', photoshopPath: config.photoshopPath }
      : { kind: 'blocked', message: PHOTOSHOP_NOT_CONFIGURED_MESSAGE }
  }

  // typeset without a PSD: run the import script when both halves are known.
  if (config.importScriptPath && config.photoshopPath) {
    return {
      kind: 'run-import-script',
      photoshopPath: config.photoshopPath,
      scriptPath: config.importScriptPath
    }
  }

  if (config.skipPsFallbackPrompt) {
    return config.photoshopPath
      ? { kind: 'open-photoshop', photoshopPath: config.photoshopPath }
      : { kind: 'blocked', message: PHOTOSHOP_NOT_CONFIGURED_MESSAGE }
  }

  return { kind: 'ask-ps-fallback' }
}

/**
 * Photoshop ships its scripts at `<PS root>\Presets\Scripts\*.jsx`, so the
 * executable can be derived from a chosen script path. Used to pre-fill the
 * Photoshop field when the user picks the import tool; the result still has to
 * be verified against the filesystem before it is trusted.
 */
export function derivePhotoshopPath(scriptPath: string): string | null {
  const trimmed = scriptPath.trim()
  if (!trimmed) return null

  const parts = trimmed.split(/[\\/]/).filter((part) => part.length > 0)
  if (parts.length < 4) return null

  const presets = parts[parts.length - 3]
  const scripts = parts[parts.length - 2]
  if (presets.toLowerCase() !== 'presets' || scripts.toLowerCase() !== 'scripts') return null

  const rootParts = parts.slice(0, parts.length - 3)
  if (rootParts.length === 0) return null

  // Preserve the original separator style (Windows paths reach us with '\').
  const separator = trimmed.includes('\\') ? '\\' : '/'
  return `${rootParts.join(separator)}${separator}Photoshop.exe`
}
