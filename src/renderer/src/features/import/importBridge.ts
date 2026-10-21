/**
 * 「译文导入」页的 IPC 适配层（P7，2026-10-05）。
 *
 * 为什么要有这个文件：分层规矩（§13 第 20 条）是
 * **`views/` 与 `components/` 只画 + emit，不调 IPC** —— 而 `views/Import.vue` 里
 * 原本有 **19 处** `window.comicType.*` 直接调用，是全项目最大的一处越界。
 * 搬到这里之后：视图只管"什么时候要什么"，**怎么要**收在这一处。
 *
 * 这一层刻意做成**薄直通**：每个函数就是"同样的参数交给同一条通道"，
 * 不做参数组装、不做默认值、不做重试 —— 这样它在行为上**不可能是新的 bug 源**，
 * 搬迁的正确性也就能一眼核对（调用点 1:1 对得上）。
 *
 * 三条刻意保持的语义（改了就是改行为，别顺手"优化"）：
 *
 * 1. **可选通道一律"守卫 + 中性返回"**：`storeGet` / `storeSet` / `fontList` /
 *    `getPathForFile` 这四条在原代码里是**先 `typeof ... !== 'function'` 再调**，
 *    防的是"后台还是旧版本"（这条真机踩过一次：界面热更新、后台没更新）。
 *    所以把守卫一起搬进来 —— 拿不到就返回 `undefined` / `null`，**绝不抛**，
 *    调用方按"没读到"处理。
 * 2. **其余通道不加守卫**：原代码就是直接调、失败由视图那层 `try/catch` 变成一句人话
 *    toast。这里也直接调 —— 加守卫反而会把"后台缺通道"伪装成"什么都没发生"。
 * 3. **一律在调用时读 `window.comicType`**，不在模块加载时抓快照：
 *    测试是在 `beforeEach` 里替换整个对象的，抓快照会让它们全部失联。
 */
import type { SystemFontInfo } from '@shared/ipc-api'
import { LABELPLUS_IMPORT_SETTINGS_KEY } from '@shared/labelplus-import'
import type {
  LabelPlusFileSelection,
  LabelPlusGenerateRequest,
  LabelPlusGenerateResult,
  LabelPlusMatchPreview,
  LabelPlusMatchRequest,
  LabelPlusPreviewGenerateRequest,
  LabelPlusPreviewOpenRequest,
  LabelPlusPreviewOpenResult
} from '@shared/labelplus-import'
import type {
  LabelPlusJobReport,
  LabelPlusManifestJobRequest,
  LabelPlusManifestJobResult,
  LabelPlusPhotoshopRunResult
} from '@shared/labelplus-manifest'

// ── 偏好读写（可选通道：后台是旧版本时静默降级）──────────────────────────

/** 读上次的导入页偏好。拿不到（旧后台 / 没数据库）时返回 `undefined`。 */
export async function readPersistedImportSettings(): Promise<unknown> {
  if (typeof window.comicType?.storeGet !== 'function') return undefined
  return window.comicType.storeGet(LABELPLUS_IMPORT_SETTINGS_KEY)
}

/** 写偏好。写失败**不许打断导入流程**，所以这里吞掉异常（与原实现一致）。 */
export async function writePersistedImportSettings(payload: unknown): Promise<void> {
  if (typeof window.comicType?.storeSet !== 'function') return
  try {
    await window.comicType.storeSet(LABELPLUS_IMPORT_SETTINGS_KEY, payload)
  } catch {
    // A failed preference write must not interrupt an import operation.
  }
}

/** 系统字体清单。非 Windows / 旧后台时返回 `null`（调用方保持既有字体选择）。 */
export async function listImportFonts(): Promise<SystemFontInfo[] | null> {
  if (typeof window.comicType?.fontList !== 'function') return null
  try {
    const result = await window.comicType.fontList()
    return result.fonts
  } catch {
    // Non-Windows environments may not expose a system font inventory.
    return null
  }
}

/** 拖进来的文件的本地路径。`getPathForFile` 不可用时返回 `null`（调用方回落到旧字段）。 */
export function pathForDroppedFile(file: File): string | null {
  try {
    if (typeof window.comicType?.getPathForFile === 'function') {
      return window.comicType.getPathForFile(file)
    }
  } catch {
    // Older Electron builds may still expose the legacy File.path property.
  }
  return null
}

// ── 选文件 / 选目录（取消 ⇒ null）───────────────────────────────────────

/** 从磁盘路径解析 LabelPlus 文本（拖入那条路走它）。 */
export function prepareLabelPlusInputFromPath(inputPath: string): Promise<LabelPlusFileSelection> {
  return window.comicType.prepareLabelPlusInput(inputPath)
}

/** 打开"选择 LabelPlus 文本"对话框。 */
export function pickLabelPlusFileFromDisk(): Promise<LabelPlusFileSelection | null> {
  return window.comicType.pickLabelPlusFile()
}

/** 打开"选择目录"对话框。 */
export function pickDirectoryInteractive(): Promise<string | null> {
  return window.comicType.pickDirectory()
}

// ── 匹配预览与预览窗 ────────────────────────────────────────────────────

export function previewLabelPlusMatch(
  request: LabelPlusMatchRequest
): Promise<LabelPlusMatchPreview> {
  return window.comicType.previewLabelPlusImport(request)
}

/** 打开独立的预览窗口。 */
export function openLabelPlusPreviewWindow(
  request: LabelPlusPreviewOpenRequest
): Promise<LabelPlusPreviewOpenResult> {
  return window.comicType.openLabelPlusPreview(request)
}

// ── 出图 ────────────────────────────────────────────────────────────────

/** 「生成预览」：出一份到主进程挑的临时目录，供对照用。 */
export function generateLabelPlusPreviewPsd(
  request: LabelPlusPreviewGenerateRequest
): Promise<LabelPlusGenerateResult> {
  return window.comicType.generateLabelPlusPreviewPsd(request)
}

/** 「生成 PSD」：正式出图。 */
export function generateLabelPlusPsd(
  request: LabelPlusGenerateRequest
): Promise<LabelPlusGenerateResult> {
  return window.comicType.generateLabelPlusPsd(request)
}

// ── 交给 Photoshop 那条链 ───────────────────────────────────────────────

/** 只写清单（"我自己在 PS 里跑一遍"用的那条路）。 */
export function exportLabelPlusManifest(
  request: LabelPlusManifestJobRequest
): Promise<LabelPlusManifestJobResult> {
  return window.comicType.exportLabelPlusManifest(request)
}

/** 写清单 + 启动 Photoshop。 */
export function runLabelPlusInPhotoshop(
  request: LabelPlusManifestJobRequest,
  photoshopPath: string
): Promise<LabelPlusPhotoshopRunResult> {
  return window.comicType.runLabelPlusInPhotoshop(request, photoshopPath)
}

/** 读 runner 写回来的回执（出图进度靠轮询它）。 */
export function readLabelPlusJobReport(reportPath: string): Promise<LabelPlusJobReport | null> {
  return window.comicType.readLabelPlusJobReport(reportPath)
}
