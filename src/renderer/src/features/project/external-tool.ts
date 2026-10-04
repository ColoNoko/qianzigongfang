import { useSettingsStore } from '@renderer/stores/settings'
import type { WorkMode } from '@shared/types'
import {
  IMPORT_TOOL_LAUNCH_FAILED_MESSAGE,
  OPEN_FILE_FAILED_MESSAGE,
  PHOTOSHOP_NOT_CONFIGURED_MESSAGE,
  resolveCardAction
} from './card-action'

/**
 * Executor for the card action.
 *
 * `card-action.ts` decides *what* should happen; this module is the only place
 * that reads settings, talks to the main process and reports back. Callers get
 * a toast payload (or nothing) so the same behaviour serves the thumbnail cards
 * and the compare viewer without duplication.
 */

const OPEN_ERROR_MESSAGES: Record<string, string> = {
  E_NOT_FOUND: '文件不存在',
  E_NO_DEFAULT_APP: '没有默认应用打开该文件',
  E_OPEN_FAILED: OPEN_FILE_FAILED_MESSAGE
}

/**
 * 打开文件失败时给用户看的那句话（2026-10-01 第一批 A4）。
 *
 * 三条规则：
 *   ① 认得的原因（文件不存在）→ 直接给中文话术；
 *   ② **认不得的原因（`E_OPEN_FAILED`）→ 把系统原话附在后面**
 *      —— 以前这里只有笼统的「打开文件失败」，系统的解释被吞掉了，
 *      所以"点了没反应 / 打不开"时谁都看不出原因；
 *   ③ 系统原话为空就只说话术。
 *
 * ⚠️ `E_NO_DEFAULT_APP` 那条映射目前**打不到**：真机实测证明 Windows 上"没有默认应用"
 * 会弹「打开方式」并返回成功，不会给我们错误码（见 services/open-path-failure.ts 顶部的实测表）。
 * 文案留着不删，是因为它仍是这个错误码的**唯一**用户可见定义；要不要真按注册表去判定是另一个决策。
 */
export function openPathFailureText(result: { code: string; message?: string }): string {
  const base = OPEN_ERROR_MESSAGES[result.code] ?? OPEN_FILE_FAILED_MESSAGE
  if (result.code !== 'E_OPEN_FAILED') return base
  const raw = (result.message ?? '').trim()
  return raw && raw !== base ? `${base}：${raw}` : base
}

export type CardActionToast = { type: 'warning' | 'error'; message: string }

export interface CardActionOutcome {
  toast?: CardActionToast
}

export interface CardActionRequest {
  mode: WorkMode
  /** False when the entry has no PSD (a chapter of images only). */
  hasPsd: boolean
  /** Opened when the action resolves to opening the file itself. */
  openPath: string
}

export async function performCardAction(request: CardActionRequest): Promise<CardActionOutcome> {
  const settings = useSettingsStore()
  const action = resolveCardAction(request.mode, request.hasPsd, {
    translationToolPath: settings.labelPlusFxPath.trim(),
    photoshopPath: settings.photoshopPath.trim(),
    importScriptPath: settings.typesetImportScript.trim(),
    skipPsFallbackPrompt: settings.skipPsFallbackPrompt
  })

  switch (action.kind) {
    case 'blocked':
      return { toast: { type: 'warning', message: action.message } }

    case 'open-psd': {
      const result = await window.comicType.openPath(request.openPath)
      if (result.ok) return {}
      return { toast: { type: 'error', message: openPathFailureText(result) } }
    }

    case 'run-import-script': {
      const result = await window.comicType.launchTool(action.photoshopPath, [action.scriptPath])
      if (result.ok) return {}
      return {
        toast: { type: 'error', message: result.message || IMPORT_TOOL_LAUNCH_FAILED_MESSAGE }
      }
    }

    case 'open-photoshop': {
      const result = await window.comicType.launchTool(action.photoshopPath)
      if (result.ok) return {}
      return {
        toast: { type: 'error', message: result.message || IMPORT_TOOL_LAUNCH_FAILED_MESSAGE }
      }
    }

    case 'launch-tool': {
      const result = await window.comicType.launchTool(action.toolPath)
      if (result.ok) return {}
      return { toast: { type: 'error', message: result.message || '启动外部工具失败' } }
    }

    case 'ask-ps-fallback': {
      const decision = await window.comicType.confirmPsFallback()
      // The checkbox suppresses the dialog next time; honour it whatever the
      // user pressed, so the choice is not silently dropped on cancel.
      if (decision.skipNextTime) settings.setSkipPsFallbackPrompt(true)
      if (!decision.confirmed) return {}

      const photoshopPath = settings.photoshopPath.trim()
      if (!photoshopPath) {
        return { toast: { type: 'warning', message: PHOTOSHOP_NOT_CONFIGURED_MESSAGE } }
      }
      const result = await window.comicType.launchTool(photoshopPath)
      if (result.ok) return {}
      return {
        toast: { type: 'error', message: result.message || IMPORT_TOOL_LAUNCH_FAILED_MESSAGE }
      }
    }
  }
}

/** True when the entry has a PSD behind it (status 'none' means images only). */
export function pairHasPsd(psdStatus: string): boolean {
  return psdStatus !== 'none'
}
