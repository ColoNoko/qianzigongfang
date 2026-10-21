import type { MediaInfo } from './media'
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
import type {
  ChapterTranslationCreateRequest,
  ChapterTranslationCreateResult,
  ChapterTranslationDeleteSaveRequest,
  ChapterTranslationDeleteSaveResult,
  ChapterTranslationExportRequest,
  ChapterTranslationExportResult,
  ChapterTranslationInsertSaveRequest,
  ChapterTranslationInsertSaveResult,
  ChapterTranslationReadResult,
  ChapterTranslationSaveRequest,
  ChapterTranslationSaveResult,
  ChapterTranslationUndoRequest,
  ChapterTranslationUndoResult
} from './chapter-translation'
import type {
  TranslationReviewDeleteRequest,
  TranslationReviewDeleteResult,
  TranslationReviewExportRequest,
  TranslationReviewExportResult,
  TranslationReviewListResult,
  TranslationReviewRecord,
  TranslationReviewSaveResult
} from './translation-review'
import type { AchievementExportPayload } from './achievement-profile'

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

export type FontSource = 'system' | 'user' | 'managed' | 'folder'
export type FontLanguage = 'chinese' | 'japanese' | 'korean' | 'latin' | 'symbol' | 'other'

export interface SystemFontInfo {
  id: string
  /** Installation/removal operates on a file; TTC faces share this ID. */
  fileId?: string
  faceIndex?: number
  weight?: number
  italic?: boolean
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

export interface FontPreviewResult {
  buffer: ArrayBuffer
  coverage: Array<[number, number]> | null
  glyphs?: {text:string;path:string;width:number}[]
  unitsPerEm?: number
  ascent?: number
  descent?: number
  bounds?: {left:number;top:number;width:number;height:number}
}

export interface FontListResult {
  supported: boolean
  fonts: SystemFontInfo[]
  scannedAt: number
  message?: string
  stale?: boolean
}

export interface FontFolderListResult extends FontListResult {
  canceled: boolean
  folderPath?: string
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
  statisticsTimeChanges?: number
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
  /** 实际标记操作时间，不受统计日期归属影响。 */
  lastOperationAtByMode?: Partial<Record<WorkMode, number>>
  datedEntries?: Partial<Record<WorkMode, { at: number; source: import('./statistics-time').StatisticsTimeSource }[]>>
}

/**
 * 「从对方的数据库文件导入」的结果（2026-10-05）。
 *
 * 用途：对面的朋友可能还在老版本 / 别的分支（例如 0.4.0），**没有导出功能**。
 * 他只需要把 `data\database\qianzi-gongfang.sqlite` 拷一份过来；
 * 主进程**只读**打开它、跑同一段汇总查询，返回的仍是与成就页同口径的标记统计。
 */
export interface AchievementDatabaseImportResult {
  canceled: boolean
  path?: string
  statistics?: ChildMarkStatistics[]
  error?: string
}

/** 成就数据导出（需求一）的结果。 */
export interface AchievementExportResult {
  saved: boolean
  path?: string
  error?: string
}

/**
 * 成就数据导入（需求一）的结果：主进程只负责弹窗 + 读回原文，
 * **不解析、不落库** —— 解析与校验在共享层纯函数（`shared/achievement-profile`）里做。
 */
export interface AchievementImportResult {
  canceled: boolean
  path?: string
  text?: string
  error?: string
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
  /**
   * 撞上的那一话（`conflict === 'same-chapter'` 时给出）—— 标题与它自己的路径。
   *
   * ⚠️ 这两个字段**只报事实**："这个集数在这个父级下已经被谁占用了"。
   * 它**不表示**两者是同一话：2026-10-05 现场实测，同一个父级里可能存在
   * 两套命名（`… - 姐煩19` / `… - 戀上19`）与多部作品共用数字，
   * 光看集数**判不出来** —— 判由用户做（所以要把"撞上的是谁"摆在他眼前）。
   * 多条同号时取库里第一条；标题为空时回落到文件夹名（真实库里就有空标题的话）。
   */
  existingChapterTitle?: string
  existingChapterPath?: string
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
  /** 本父级已有的话（认领候选清单；含目录已不在的）。 */
  existingChapters?: SelfCheckExistingChapter[]
}

/**
 * 自检弹窗"认领"时用的**既有话**清单（2026-10-05，R2）。
 *
 * 用途：本地文件夹改名后，注册表里那条话指向的旧路径不存在了，而改名后的文件夹
 * 会被当成"新章节候选"。用户可以在候选上说"它不是新章节，它是《…》"，
 * 程序就**只把那条话的 folderPath 换成新路径**（childId / 集数 / 标记全不动）。
 */
export interface SelfCheckExistingChapter {
  id: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
  /** 该话的目录现在**不在磁盘上**（被删或被改名）—— "候选可能是它改名来的"的第一线索。 */
  missing?: boolean
}

/**
 * 「疑似改名」提示（2026-10-05，R1）：某个候选的内容指纹，与某个**目录已不在**的旧话
 * 记录的指纹**完全相同** ⇒ 它很可能就是那一话改了名。
 *
 * ⚠️ 只比对**指纹**（事实），不做任何名字相似度猜测；而且**仍要用户确认**才认领。
 */
export interface SelfCheckRenameHint {
  /** 候选文件夹路径。 */
  folderPath: string
  /** 疑似就是它（那一话的 id —— 认领时用它，childId 不动）。 */
  childId: string
  chapterTitle: string
  chapterNumber: string
}

export interface SelfCheckImportItem {
  folderName: string
  folderPath: string
  chapterNumber: string
  projectTitle: string
  conflictAction?: 'skip' | 'second-version'
}

export interface SelfCheckImportRequest {
  /** Background discovery requires at least one readable image/PSD. Manual imports stay unchanged. */
  requireContent?: boolean
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
  coverSource(folder:string):Promise<import('./types').JpgPsdPair|null>
  setWindowTitleBarTheme(theme: 'light' | 'dark'): Promise<void>
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
  mediaInfo(path: string): Promise<MediaInfo>
  readMedia(path: string, expected: MediaInfo): Promise<Uint8Array>
  readPsdThumbnailBytes(path: string, mtimeMs: number): Promise<Uint8Array | null>
  writePsdThumbnailBytes(
    path: string,
    mtimeMs: number,
    bytes: Uint8Array,
    size?: number
  ): Promise<void>
  invalidatePsdThumbnail(path: string, mtimeMs: number): Promise<void>
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
  exportLabelPlusManifest(request: LabelPlusManifestJobRequest): Promise<LabelPlusManifestJobResult>
  /** 读 PS 写回来的回执。文件还没出现 / 读到一半都返回 null（调用方当"进行中"）。 */
  readLabelPlusJobReport(reportPath: string): Promise<LabelPlusJobReport | null>
  openLabelPlusPreview(request: LabelPlusPreviewOpenRequest): Promise<LabelPlusPreviewOpenResult>
  getLabelPlusPreviewSession(sessionId: string): Promise<LabelPlusPreviewSessionInfo | null>
  getLabelPlusPreviewPage(sessionId: string, index: number): Promise<LabelPlusPreviewPage>
  /**
   * 读这一话的 LabelPlus 译文（P1「译文对照」的数据源）。
   *
   * **现扫话目录**：取修改时间最新的那份 `.txt`，认不认它是 LabelPlus 文本只看能不能解析成功。
   * 不落库、不写任何文件；`not-found` / `error` 都**不抛**（找不到译文是常态）。
   */
  readChapterTranslation(folderPath: string): Promise<ChapterTranslationReadResult>
  /**
   * 把译文改动**写回那份 txt**（P2）—— 全项目**唯一**会写用户话目录文件的通道。
   *
   * 安全语义全在主进程一侧（渲染层说了不算）：
   * · 写前比对基指纹，内容对不上就**拒绝写入**（除非 `force`）；
   * · 写前必备份到 `<userData>/backups/translation/`（留最近 20 份），备份失败就不写；
   * · 原子替换 + 写后回读比对；
   * · **不抛异常**：`conflict` / `invalid` / `io` 都是正常结果，界面照实显示。
   */
  saveChapterTranslation(
    request: ChapterTranslationSaveRequest
  ): Promise<ChapterTranslationSaveResult>
  /**
   * **回退最近一次保存**（2026-10-07）—— 把这份 txt 写回"本会话内上一次保存之前"的样子。
   *
   * 与 `saveChapterTranslation` 走**同一条链路、同一套安全网**（指纹 / 备份 / 原子写 / 回读），
   * 只是"要写回去的内容"取自主进程**会话内的内存堆栈**（不是磁盘上那串备份 ——
   * 那串只留 20 份且跨话共享，"失焦即存"会把本会话最早的备份清掉）。
   * ⇒ **重启后本会话堆栈即空**，这条通道会明确回一句"本会话还没有可回退的保存"。
   *
   * **没有"强制回退"这个选项**：指纹对不上就拒绝（覆盖别人在 LabelPlusFX 里的改动更糟）。
   */
  undoChapterTranslation(
    request: ChapterTranslationUndoRequest
  ): Promise<ChapterTranslationUndoResult>
  /**
   * 「新增框」**这一话已经有**可解析的 txt 时：把一条新条目**插进**那份 txt（第 5 批 5d-2）。
   *
   * 与 `saveChapterTranslation` 走**同一套安全网**（读盘 → 比指纹 → 写前备份 → 原子替换 →
   * 写后回读 → 压一层会话基线）⇒ **Ctrl+Z 照样能撤掉这次新增**，不用另做撤销。
   *
   * 两件由主进程说了算的事（渲染层不许自己算）：
   * · **插入的位置与序号**：插在**该图块末尾**，序号 = 该图已有最大序号 +1（渲染层不传）；
   * · **冲突判定**：指纹对不上就**拒绝写入**（没有"强行插进去"这个选项）。
   *
   * 结果多一个 `insertedIndex` —— 界面拿它去把右栏滚到/点亮刚新增的那一条。
   */
  insertChapterTranslation(
    request: ChapterTranslationInsertSaveRequest
  ): Promise<ChapterTranslationInsertSaveResult>
  /**
   * 「新增框」**这一话一份能解析的 txt 都没有**时：在话目录里**从零新建**一份（第 5 批 5d-2）。
   *
   * 三条与「另存」不同的硬规矩（这是"从零往用户话目录写文件"的第一条路）：
   * · **绝不覆盖**：同名就换 `-2`·`-3`…（靠 `publishOutput(..., false)` 的 link 分支"创建即判定"，
   *   不是"先 stat 再写"，没有竞争窗口）；试到 `-10` 就明确拒绝；
   * · **不弹框**（用户拍板）：名字按规则自己算（`{话文件夹名}.txt`，走 `@shared/file-name` 清洗）；
   * · 返回**真正写出去的那个路径**（界面拿它去重读，别猜）。
   */
  createChapterTranslation(
    request: ChapterTranslationCreateRequest
  ): Promise<ChapterTranslationCreateResult>
  /**
   * 「删除一条译文」（第 5 批 5e）—— **会写用户话目录**，与「保存」「新增框」同一套安全网。
   *
   * 主进程这条通道做**两件事、有先后**：
   * ① 先写 txt（删这一条的行区间 + 同图后续条目序号 -1，一次原子完成）；
   * ② 写盘成功之后再把**校对记录**按同一个偏移挪过去（`translation_review` 的主键含条目序号，
   *    不挪就会**指向另一句话**）。
   *
   * 由于走的是同一段安全网（读盘 → 比指纹 → 写前备份 → 原子替换 → 写后回读 → 压会话基线），
   * **Ctrl+Z 能撤回这次删除** —— 这也是用户拍板"不加二次确认"的兜底。
   *
   * ⚠️ 如实说明一条边界：客户端的记录重排**不在**写盘那个事务里（一个在文件系统、一个在 sqlite）。
   * 万一第 ② 步失败，txt 已经是"删掉的样子"、记录还是旧的 ⇒ 界面重读记录会看到序号错位。
   * 取舍是"宁可 txt 是对的"（它是权威），错误会往上传，不静默吞。
   */
  deleteChapterTranslation(
    request: ChapterTranslationDeleteSaveRequest
  ): Promise<ChapterTranslationDeleteSaveResult>
  /**
   * 把**当前翻译另存一份**到用户选的位置（译文栏改版第 3 批）。
   *
   * 与 `saveChapterTranslation`（写话目录里那份原件）**分得很清**：这条只写**用户选的位置**，
   * 不比对基指纹、不留备份 —— 它是导出，不是改用户的原件。
   * 目标选成原件本身会被**拒绝**（不弹框），免得绕过"保存"那条有备份与冲突检查的通道。
   *
   * 口径是"复制原文件 + 原地改"：没有待写改动就是**按字节复制**（BOM / 换行 / 非 UTF-8 字节全都过去），
   * 有待写改动就走 P2 那套**原地改行**（`翻译：` / `校对：` 那两行译名、坐标小数位全都保住）。
   * 这一话没有可解析的 txt 时，**从零生成**一份空底稿（版式照真实 LabelPlusFX 产物）。
   *
   * **不抛**：用户取消是 `kind: 'canceled'`（不是失败），其余失败都带一句人话。
   */
  exportChapterTranslation(
    request: ChapterTranslationExportRequest
  ): Promise<ChapterTranslationExportResult>
  /**
   * 读这一话的**校对记录**（译文栏改版第 2 批）。
   *
   * 只读 App 数据库里那张 `translation_review`，**不碰用户话目录**。
   * 记录里存着"校对前的原文"—— 覆盖保存之后 txt 里就没有它了，这里是唯一的一份。
   * **不抛**：读不出来就 `ok: false` + 一句人话（界面照实说，不假装"这一话没校对过"）。
   */
  listTranslationReviews(folderPath: string): Promise<TranslationReviewListResult>
  /**
   * 写一条校对记录（有则更新）。
   *
   * ⚠️ **原文写一次就不再改**（主进程一侧的结构保证，见 store 的 upsert）：
   * 第二次校对此格时同步让上一次的校对稿顶掉唯一的原文 = 真数据丢失。
   * **不抛**：写不进去返回 `ok: false` + 一句人话。
   */
  saveTranslationReview(record: TranslationReviewRecord): Promise<TranslationReviewSaveResult>
  /**
   * 删掉一条校对记录（译文栏改版**第 4 批**修：校对反悔）。
   *
   * ⚠️ 界面必须**先**把记录里的原文写回 txt（走 `saveChapterTranslation`），
   * **成功之后**才发这一条 —— 这一格是"校对前的原文"唯一的一份。
   * 只动 App 数据库，**不写用户话目录**。**不抛**：`deleted: false` = 本来就没有这条。
   */
  deleteTranslationReview(
    request: TranslationReviewDeleteRequest
  ): Promise<TranslationReviewDeleteResult>
  /**
   * 把渲染层拼好的导出文本**弹「另存为」写出去**。
   *
   * 只写用户选的位置；**不写话目录**（本批不新增写用户漫画库的路径）。
   * 用户取消 ⇒ `saved: false` 且没有 `error`（取消不是失败）。
   */
  exportTranslationReview(
    request: TranslationReviewExportRequest
  ): Promise<TranslationReviewExportResult>
  closeCurrentWindow(): Promise<void>
  readPsdThumbnailCache(psdPath: string, mtimeMs: number): Promise<string | null>
  writePsdThumbnailCache(psdPath: string, mtimeMs: number, dataUrl: string): Promise<void>
  scanChildProject(absFolder: string, options?: { cached?: boolean }): Promise<ChildProjectScan>
  watchProject(folderPath: string | null, visible?: boolean): Promise<void>
  onProjectChanged(callback: (event: { folderPath: string }) => void): () => void
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
  fontList(options?: { refresh?: boolean }): Promise<FontListResult>
  fontPreview(path: string, faceIndex?: number, sampleOnly?: boolean): Promise<FontPreviewResult>
  fontListFolder(path?: string): Promise<FontFolderListResult>
  onFontsChanged(listener: (result: FontListResult) => void): () => void
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
  statisticsTimeGet(target: import('./statistics-time').StatisticsTimeTarget, mode: WorkMode): Promise<import('./statistics-time').StatisticsTimeSource>
  statisticsTimeSet(request: import('./statistics-time').StatisticsTimeRequest): Promise<{changed: number; fallback: number}>
  memoryMarkStatistics(): Promise<ChildMarkStatistics[]>
  /** 成就数据导出（需求一）：弹"另存为"，把渲染层组装好的档案写盘。 */
  achievementExportFile(payload: AchievementExportPayload): Promise<AchievementExportResult>
  /** 成就数据导入（需求一）：弹"打开"，读回 JSON 原文（不解析、不校验）。 */
  achievementImportFile(): Promise<AchievementImportResult>
  /**
   * 从**别人的**数据库文件导入成就（对方是老版本 / 别的分支时用）：
   * 只读打开、跑同一段汇总查询；不读项目树、不写回他的库、不碰你自己的数据。
   */
  achievementImportDatabase(): Promise<AchievementDatabaseImportResult>
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
  /**
   * 「疑似改名」检测（R1）：扫一遍给定候选，拿它们的**内容指纹**与"目录已不在"的旧话比对，
   * 返回指纹完全相同的那几条。只报事实、不改任何数据（认领要用户另外确认）。
   */
  selfCheckDetectRenames(parentId: string, candidatePaths: string[]): Promise<SelfCheckRenameHint[]>
  projectSetSourceRoot(parentId: string, sourceRoot: string): Promise<void>
  /**
   * 「认领」（2026-10-05，R2）：把一条**已登记**的话换到某个候选文件夹上去（改名恢复）。
   *
   * ⚠️ 只改 `folderPath` 一个字段 —— **childId、集数、标记历史、进度缓存都不动**。
   * 禁止用"删旧建新"实现（删除会连带清掉这一话的标记记录）。
   * 新路径若已被别的话占用 ⇒ 抛错。
   */
  projectReclaimChildPath(parentId: string, childId: string, folderPath: string): Promise<void>
  /**
   * 设置父级（漫画）"记住的扫描根" —— 「修改扫描目录」写库的那一步（2026-10-05）。
   *
   * `null` 或空数组 = **恢复自动推导**：把 `sourceRoots` 与旧字段 `sourceRoot` 一起删掉，
   * 回到"按各话的路径反推"。
   *
   * ⚠️ 主进程会**再洗一遍**（丢垃圾值 / 去重 / 归一化比较），渲染层洗过不代表那边可信任
   * （与 `projectSetParentDuties` 同一条规矩）。两个字段由主进程**一起写**，
   * 渲染层不许自己拼这两本账。
   */
  projectSetParentSourceRoots(parentId: string, roots: string[] | null): Promise<void>
  projectGetTree(): Promise<ParentProject[]>
  projectSaveTree(tree: ParentProject[]): Promise<void>
  /**
   * **并发安全的章节保存**（2026-10-05 从并行分支 T6 移植）：
   * `before` = 渲染层当时看到的树快照，`after` = 改完的树。主进程在**同一个事务**里
   * 对着库里最新的树只合并本次新增/编辑的章节（旧编辑不覆盖别人的改动，
   * 章节被删/元信息被改 ⇒ 抛错），返回合并后的**权威树** —— 渲染层应当采纳返回值。
   */
  projectSaveChanges(before: ParentProject[], after: ParentProject[]): Promise<ParentProject[]>
  projectSaveProgress(updates: ChildProgressUpdate[]): Promise<void>
  projectDeleteChildren(childIds: string[]): Promise<void>
  projectRenameParent(parentId: string, title: string): Promise<void>
  /** 设置父级（漫画）的职责：1~2 个模式；空数组 = 清空（不是"保持上次"）。 */
  projectSetParentDuties(parentId: string, duties: WorkMode[]): Promise<void>
  projectReorderParents(sourceParentId: string, targetParentId: string): Promise<void>
}
