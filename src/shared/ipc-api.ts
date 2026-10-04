/**
 * Typed IPC API allowlist shared between main, preload, and renderer.
 *
 * Skeleton only — handlers are wired in task 2.2. The preload bridge
 * (src/preload/index.ts) will expose this surface on `window.api`
 * via contextBridge so the renderer never touches `ipcRenderer` directly.
 *
 * Contract rules:
 *   - All methods are async and return Promises (no sync IPC).
 *   - File ops take absolute paths only — the renderer is expected to
 *     resolve user-picked paths via pickDirectory() + path.join.
 *   - Errors are returned as data (OpenPathResult), not thrown, except
 *     for low-level fs failures which the renderer should treat as bugs.
 */

import type { UpdateManifest } from './update'
import type {
  ChildProgressUpdate,
  ChildProjectScan,
  ParentProject,
  WorkMode,
  WorkModeStatus
} from './types'
import type { MarkAuditContext, MarkAuditOperation } from './mark-audit'
import type {
  LabelPlusFileSelection,
  LabelPlusGenerateRequest,
  LabelPlusGenerateResult,
  LabelPlusPreviewGenerateRequest,
  LabelPlusMatchPreview,
  LabelPlusMatchRequest,
  LabelPlusPreviewOpenRequest,
  LabelPlusPreviewOpenResult,
  LabelPlusPreviewPage,
  LabelPlusPreviewSessionInfo
} from './labelplus-import'
import type {
  LabelPlusJobReport,
  LabelPlusManifestJobRequest,
  LabelPlusManifestJobResult,
  LabelPlusPhotoshopRunResult
} from './labelplus-manifest'

export interface DirEntry {
  name: string
  isDirectory: boolean
  absPath: string
}

export interface StatSnap {
  mtimeMs: number
  ctimeMs: number
  size: number
  isFile: boolean
  isDirectory: boolean
}

export type OpenPathResult =
  | { ok: true }
  | {
      ok: false
      /** `E_INVALID_URL`：外链没通过 `normalizeExternalUrl()` 的白名单（非 http/https、或压根不是网址）。 */
      code: 'E_NOT_FOUND' | 'E_NO_DEFAULT_APP' | 'E_OPEN_FAILED' | 'E_INVALID_URL'
      message: string
    }

/** Which flavour of external tool the native picker should offer. */
export type ToolFileKind = 'executable' | 'script'

/** Theme modes as persisted by the settings store (`theme` / `theme.colors`). */
export type BootThemeMode = 'light' | 'dark' | 'system'

export interface BootThemeColorSettings {
  hue: number
  saturation: number
  neutralSaturation: number
}

/**
 * Theme snapshot handed to the renderer at window creation.
 *
 * The main process already reads the store at startup (window geometry lives
 * in the same database), so it forwards the persisted theme through
 * `webPreferences.additionalArguments`. The preload exposes it synchronously,
 * which lets the renderer paint its first frame in the right theme instead of
 * flashing the light default while an async `storeGet` round-trips.
 */
export interface BootThemeSnapshot {
  mode: BootThemeMode
  /** null when the stored colors were missing or invalid. */
  colors: BootThemeColorSettings | null
}

/** Result of the native "no import tool configured" confirmation. */
export interface PsFallbackDecision {
  /** True when the user chose 依然打开ps. */
  confirmed: boolean
  /** True when the 下次不再提醒 checkbox was ticked. */
  skipNextTime: boolean
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error'
  scope: string
  message: string
  data?: unknown
}

export type FontSource = 'system' | 'user' | 'managed'
export type FontLanguage = 'chinese' | 'japanese' | 'korean' | 'latin' | 'symbol' | 'other'

export interface SystemFontInfo {
  id: string
  family: string
  style: string
  /** PostScript name used by PSD text engine data (for example ArialMT). */
  postScriptName: string
  displayName: string
  fileName: string
  filePath: string
  format: 'TTF' | 'OTF' | 'TTC'
  source: FontSource
  managed: boolean
  languages: FontLanguage[]
  installedAt?: number
}

export interface FontListResult {
  supported: boolean
  fonts: SystemFontInfo[]
  scannedAt: number
  message?: string
}

export interface FontInstallFailure {
  fileName: string
  message: string
}

export interface FontInstallResult {
  canceled: boolean
  installed: SystemFontInfo[]
  failed: FontInstallFailure[]
}

export interface FontActionResult {
  ok: boolean
  message: string
}

export interface FontBatchFailure {
  fontId: string
  message: string
}

export interface FontBatchActionResult {
  succeeded: string[]
  failed: FontBatchFailure[]
}

export type RememberedPsdStatus = 'done' | 'pending'

export interface ProjectMemoryFileStatus {
  path: string
  status: RememberedPsdStatus
  mtimeMs: number
  updatedAt: number
  /** 多模式标记；旧数据无此字段时由 status 推导 typeset。 */
  modes?: WorkModeStatus
  /** 各模式最近一次完成时间；无完成记录时为空。 */
  modeTimestamps?: Partial<Record<WorkMode, number>>
}

export interface ProjectMemory {
  childId: string
  folderPath: string
  updatedAt: number
  files: Record<string, ProjectMemoryFileStatus>
}

export interface ProjectMemoryStatusUpdate {
  pathKey: string
  path: string
  status: RememberedPsdStatus
  mtimeMs: number
  /** 本次要写入的多模式标记；缺省时仅按 status 更新 typeset。 */
  modes?: Partial<Record<WorkMode, boolean>>
  /** 本次要写入的模式完成时间；缺省时保留已有时间。 */
  modeTimestamps?: Partial<Record<WorkMode, number>>
}

/**
 * 一份数据库备份（主进程 `db-backup.ts` 产出）。
 * `rows` 是备份那一刻各表的行数 —— 台账与界面上"这份备份是什么时候、有多少东西"靠它。
 */
export interface DbBackupInfo {
  file: string
  path: string
  at: number
  bytes: number
  /** 'manual' | 'auto' | 'delivery' | 'before-restore' */
  reason: string
  sha256: string
  rows: Record<string, number>
}

/** 还原预览：只列"会变的行"，不猜、也不删东西。 */
export interface MarkRestorePreview {
  file: string
  at: number
  changingFiles: number
  missingInBackup: number
  missingInCurrent: number
  children: Array<{
    childId: string
    folderPath: string
    changingCount: number
    /** 前几行的可读变化（`012.psd  监修 ✗→✓`）。 */
    sample: string[]
  }>
}

/** 撤销 / 还原之后的回执。 */
export interface MarkWriteBackResult {
  revertedFiles: number
  childIds: string[]
  operation: MarkAuditOperation | null
  /** 仅"从备份还原"带回：**写回之前**自动留的那一份，万一还原选错了还能回去。 */
  safetyBackup?: DbBackupInfo
}

/**
 * 一话的**标记统计**（第十五轮：成就页的数据源）。
 *
 * 刻意不来自磁盘扫描：`psdStats` / `psdModeStats` 是"当前目录里有什么"的快照 ——
 * 为了让项目瘦身删掉几张图，历史成就就跟着缩水了。这份数据来自 `project_memory_files`
 * （按文件路径保存的标记记录 + 每个模式的完成时间戳），**删图不会掉**。
 */
export interface ChildMarkStatistics {
  childId: string
  folderPath: string
  /** 记录里的文件条数（"曾经标记过多少张"）。 */
  fileCount: number
  /**
   * 四个模式各自"已完成"的完成时间（升序）。
   * 老记录没有时间戳时回退到该行的 `updated_at` —— 宁可粗一点，也不要漏掉历史。
   */
  completedTimestamps: Record<WorkMode, number[]>
}

/** 应用内诊断快照（D2）：最常被问到的几个事实，一次凑齐。 */
export interface DiagnosticsSnapshot {
  appVersion: string
  electronVersion: string
  platform: string
  dataDirectory: string
  databasePath: string
  databaseBytes: number
  logPath: string
  logBytes: number
  backupCount: number
  newestBackupAt: number | null
  /** 有标记记录的话数。 */
  childCount: number
  /** 标记记录行数（每个文件一行）。 */
  recordCount: number
  /** 四个模式各自的"完成"条数。 */
  markCounts: Record<WorkMode, number>
}

/**
 * 「检查更新」的结果（2026-10-04）。三态：
 *   · `update-available`：远端确实更新（带清单：版本号 / 说明 / https 下载地址）；
 *   · `up-to-date`：相同或更低；
 *   · `failed`：断网/超时/500/垃圾清单 —— **不是错误，是"这次没查到"**，
 *     界面只淡淡说一句，不弹错、不阻断（检查更新失败不该影响用户干活）。
 */
export type UpdateCheckResult =
  | { status: 'update-available'; currentVersion: string; manifest: UpdateManifest }
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'failed'; currentVersion: string; reason: string }

export interface LegacyJsonImportResult {
  canceled: boolean
  importedFiles: number
  skippedFiles: number
  projectsAdded: number
  memoryProjectsImported: number
  fontRecordsImported: number
  importedSettings: number
  warnings: string[]
}

export interface SelfCheckCandidate {
  folderName: string
  folderPath: string
  chapterNumber: string
  projectTitle: string
  /** same-chapter = 同父级下已存在相同集数，但目录路径不同 */
  conflict: 'none' | 'same-chapter'
  existingChapterNumber?: string
}

export interface SelfCheckPreviewResult {
  /** false 表示无法自动确定父级根目录（或所有根都读不到），需要用户手动选择一次 */
  canDetect: boolean
  /** 兼容字段：等于 `sourceRoots[0]`（旧渲染层只认一个目录）。 */
  sourceRoot: string | null
  /** 实际扫描的根目录（去重后）。分散在多个中间目录时会有多个。 */
  sourceRoots: string[]
  /** 读不到的根（被删/被移动）；这些目录被跳过，不影响其它根。 */
  unreadableRoots?: string[]
  message?: string
  candidates: SelfCheckCandidate[]
  duplicatePaths: number
}

export interface SelfCheckImportItem {
  folderName: string
  folderPath: string
  chapterNumber: string
  projectTitle: string
  conflictAction?: 'skip' | 'second-version'
}

export interface SelfCheckImportRequest {
  parentId: string
  /** 主根（兼容旧调用点）；多根时等于 `sourceRoots[0]`。 */
  sourceRoot: string
  /** "记住此目录"时把这一批根全部记下；缺省按 `[sourceRoot]` 处理。 */
  sourceRoots?: string[]
  rememberSourceRoot: boolean
  items: SelfCheckImportItem[]
}

export interface SelfCheckImportResult {
  added: number
  skipped: number
  failed: number
}

export interface ComicTypeAPI {
  /**
   * Persisted theme, read from the process arguments the main process appends
   * at window creation. `null` when nothing was persisted yet (first launch)
   * or when those arguments are absent (for example in unit tests).
   */
  bootTheme?: BootThemeSnapshot | null
  getPathForFile(file: File): string
  pickDirectory(): Promise<string | null>
  pickLabelPlusFile(): Promise<LabelPlusFileSelection | null>
  prepareLabelPlusInput(inputPath: string): Promise<LabelPlusFileSelection>
  listDir(absPath: string): Promise<DirEntry[]>
  stat(absPath: string): Promise<StatSnap>
  readFileBuffer(absPath: string): Promise<ArrayBuffer>
  readFileDataURL(absPath: string): Promise<string>
  previewLabelPlusImport(request: LabelPlusMatchRequest): Promise<LabelPlusMatchPreview>
  generateLabelPlusPsd(request: LabelPlusGenerateRequest): Promise<LabelPlusGenerateResult>
  generateLabelPlusPreviewPsd(
    request: LabelPlusPreviewGenerateRequest
  ): Promise<LabelPlusGenerateResult>
  /**
   * 「工坊编排 / PS 执行」那条路：把当前设置写成一份**指令清单**（+ 三行引子脚本）
   * 落到 `<EXE 同级>/temp/labelplus-jobs/<jobId>/`，然后启动 Photoshop 去跑。
   * 真竖排文字层、按分组执行动作、存 PSD 全部由 PS 侧完成。
   */
  runLabelPlusInPhotoshop(
    request: LabelPlusManifestJobRequest,
    photoshopPath: string
  ): Promise<LabelPlusPhotoshopRunResult>
  /** 同上，但**不启动 PS** —— 给"我自己在 PS 里手动跑一遍"用。 */
  exportLabelPlusManifest(
    request: LabelPlusManifestJobRequest
  ): Promise<LabelPlusManifestJobResult>
  /** 读 PS 写回来的回执。文件还没出现 / 读到一半都返回 null（调用方当"进行中"）。 */
  readLabelPlusJobReport(reportPath: string): Promise<LabelPlusJobReport | null>
  openLabelPlusPreview(request: LabelPlusPreviewOpenRequest): Promise<LabelPlusPreviewOpenResult>
  getLabelPlusPreviewSession(sessionId: string): Promise<LabelPlusPreviewSessionInfo | null>
  getLabelPlusPreviewPage(sessionId: string, index: number): Promise<LabelPlusPreviewPage>
  closeCurrentWindow(): Promise<void>
  readPsdThumbnailCache(psdPath: string, mtimeMs: number): Promise<string | null>
  writePsdThumbnailCache(psdPath: string, mtimeMs: number, dataUrl: string): Promise<void>
  scanChildProject(absFolder: string): Promise<ChildProjectScan>
  openPath(absPath: string): Promise<OpenPathResult>
  /**
   * 用系统默认浏览器打开一个**外部网址**（例如字体页的「识字网」）。
   *
   * 与 `openPath` 分开是有意的：那个的语义是"打开一个已存在的文件"，
   * 传网址属于没文档保证的用法。这里只放行 `http` / `https`，
   * 规则在 `shared/external-url.ts`（纯函数，有单测）。
   */
  openExternal(url: string): Promise<OpenPathResult>
  /**
   * 查一下有没有新版本（只读网络：不下载、不替换、不写任何文件）。
   * 永远 resolve —— 查不到就是 `failed`，不会抛。
   */
  checkForUpdate(): Promise<UpdateCheckResult>
  /**
   * Opens a native picker for a user-configured external tool.
   * `executable` → .exe only; `script` → Photoshop .jsx scripts.
   * Returns null when cancelled.
   */
  pickToolFile(kind: ToolFileKind): Promise<string | null>
  /**
   * Launches an external tool chosen by the user (the LabelPlusFX translation
   * editor, Photoshop, or Photoshop with a .jsx script argument). Unlike
   * `openPath`, an existing file is required — a stale configured path must
   * surface as E_NOT_FOUND rather than a silent no-op.
   */
  launchTool(exePath: string, args?: string[]): Promise<OpenPathResult>
  /**
   * Native confirm shown when the 嵌字 action has no PSD and no import tool is
   * configured. Returns the pressed button plus the "不再提醒" checkbox state.
   */
  confirmPsFallback(): Promise<PsFallbackDecision>
  writeLog(entry: LogEntry): Promise<void>
  getLogPath(): Promise<string>
  importLegacyJson(): Promise<LegacyJsonImportResult>
  fontList(): Promise<FontListResult>
  fontInstall(): Promise<FontInstallResult>
  fontUninstall(fontId: string): Promise<FontActionResult>
  fontUninstallMany(fontIds: string[]): Promise<FontBatchActionResult>
  storeGet(key: string): Promise<unknown>
  storeSet(key: string, val: unknown): Promise<void>
  memoryGetProject(childId: string): Promise<ProjectMemory | null>
  memorySetStatuses(
    childId: string,
    folderPath: string,
    updates: ProjectMemoryStatusUpdate[],
    /**
     * 标记台账上下文（第十四轮）。
     * 给了它，主进程会在**同一个事务**里再写一条流水（改前 / 改后逐文件），
     * 于是"库变了但台账没有"这种状态不可能出现；不给就不记（旧调用点不受影响）。
     */
    audit?: MarkAuditContext
  ): Promise<void>
  memoryRemoveProject(childId: string): Promise<void>
  /** 诊断快照（D2）：版本 / 数据目录 / 库大小 / 标记行数 / 备份份数。 */
  diagnosticsSnapshot(): Promise<DiagnosticsSnapshot>
  /** 日志尾部（默认最后 200 KB；读不到返回空串）。 */
  readLogTail(maxBytes?: number): Promise<string>
  /** 成就页的数据源：按话汇总的标记记录（含完成时间；删图不影响）。 */
  memoryMarkStatistics(): Promise<ChildMarkStatistics[]>
  /** 标记台账：最近若干次操作（新的在前）。 */
  memoryListMarkAudit(limit?: number): Promise<MarkAuditOperation[]>
  /** 最近一次**可撤销**的操作（没有则 null）—— 页脚/工具栏那个「撤销标记」用它决定亮不亮。 */
  memoryFindUndoableMark(): Promise<MarkAuditOperation | null>
  /** 撤销一次标记操作（按台账精确还原模式与时间戳），并记一条 `kind='undo'` 流水。 */
  memoryUndoMark(opId: string): Promise<MarkWriteBackResult>
  /** 立即做一份数据库备份（一致性快照）。 */
  dbBackupCreate(reason: string): Promise<DbBackupInfo>
  /** 已有备份列表（新的在前）。 */
  dbBackupList(): Promise<DbBackupInfo[]>
  /** 拿一份备份与当前库比较，只列出会变的行。 */
  dbBackupRestorePreview(file: string): Promise<MarkRestorePreview>
  /** 按预览结果把标记写回（写之前会自动再备份一份当前库），并记 `kind='restore'` 流水。 */
  dbBackupRestoreApply(file: string): Promise<MarkWriteBackResult>
  selfCheckPreview(parentId: string, sourceRoot?: string): Promise<SelfCheckPreviewResult>
  selfCheckImport(request: SelfCheckImportRequest): Promise<SelfCheckImportResult>
  projectSetSourceRoot(parentId: string, sourceRoot: string): Promise<void>
  projectGetTree(): Promise<ParentProject[]>
  projectSaveTree(tree: ParentProject[]): Promise<void>
  projectSaveProgress(updates: ChildProgressUpdate[]): Promise<void>
  projectDeleteChildren(childIds: string[]): Promise<void>
  projectRenameParent(parentId: string, title: string): Promise<void>
  /** 设置父级（漫画）的职责：1~2 个模式；空数组 = 清空（不是"保持上次"）。 */
  projectSetParentDuties(parentId: string, duties: WorkMode[]): Promise<void>
  projectReorderParents(sourceParentId: string, targetParentId: string): Promise<void>
}
