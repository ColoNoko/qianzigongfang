/**
 * Shared domain types for the 汉化工坊 (qianzi-gongfang) app.
 *
 * Pure type definitions only — no runtime code, no fs/io. Imported by
 * main, preload, and renderer (via `@shared/types` per tsconfig paths).
 *
 * Domain model:
 *   ParentProject   — 漫画 (a comic / series)
 *     └─ ChildProject — 集 (a chapter folder containing PSDs + optional JPGs)
 *          └─ PsdEntry   — a single .psd file, with a derived TypesetStatus
 *   ChapterProgress — done/total + percentage, computed from PSD statuses
 *   JpgPsdPair      — a .jpg (if any) paired with a PsdEntry for preview
 *   ChildProjectScan — raw scan output: jpgPairs, txtFiles, errors, rootMissing
 *   *Record types   — registry rows persisted via electron-store
 */

export interface ParentProject {
  id: string
  title: string // 漫画名称 (父级), e.g. "ドラゴンボール"
  /**
   * 可选：自检（"刷新并检测新章节"）的扫描根。用户手动选过并"记住"时写入。
   *
   * 为什么是数组：同一父级下的子项目可能分散在多个中间目录里
   * （真实案例 `搬砖\{无,有}\<章节>`），此时只扫一个目录必然漏。
   * `sourceRoot` 是旧版单根字段，继续读作 `[sourceRoot]`，写入时同步为主根。
   */
  sourceRoots?: string[]
  /** @deprecated 单根时代的字段，保留兼容；新代码读写 `sourceRoots`。 */
  sourceRoot?: string
  /**
   * 职责：这一本漫画归我干哪几道工序（1~2 个模式，例如「校对 + 监修」）。
   *
   * 与 `WorkMode` 的区别：模式是"当前章节正在做哪道工序"，
   * 职责是"这本归我做什么"（每本一份）。空数组 = 显式无职责；缺省 = 没声明过，界面会按
   * 已有标记猜一个（`shared/duties.ts` 的 `inferParentDuties`），但**不写库**。
   */
  duties?: WorkMode[]
  children: ChildProject[]
  lastMtimeMs: number // max of children's lastMtimeMs, for sorting
}

export interface ChildProject {
  id: string
  parentTitle: string // parent comic name
  folderPath: string // absolute path to the chapter folder
  chapterNumber: string // 集数, e.g. "第1話"
  projectTitle: string // 项目标题
  lastMtimeMs: number // latest PSD mtime in this child, for sorting
  psdStats?: PsdStat[] // optional cached stats from the latest import/scan
  statsVersion?: number // cache schema version for paired-file-only progress
  /**
   * 这一话的**内容指纹**（2026-10-05，R1）：稳定扫描时记录一次，
   * 用于"本地文件夹改名后认回原来那一话"（目录不在的旧话 + 指纹相同的候选 ⇒ 疑似改名）。
   *
   * ⚠️ 与 `ChildProjectScan.sourceRevision` 的分工：那个只含原图/TXT（给目录监听用），
   * 这个含 **PSD + 原图 + TXT**（改名判定必须把 PSD 也算进去，否则"只有 PSD 的话"
   * 指纹会退化成同一个常量、互相误配）。
   */
  contentFingerprint?: string
  /** 各模式的完成时间序列，用于月/年统计。 */
  psdModeStats?: Record<WorkMode, PsdStat[]>
  modeStatsVersion?: number
}

export type TypesetStatus = 'done' | 'pending' | 'none'

export type WorkMode = 'typeset' | 'translated' | 'proofread' | 'supervised'
export type WorkModeStatus = Record<WorkMode, boolean>

export interface ChapterProgress {
  done: number // completed effective work items
  total: number // PSD count, or image count when the folder has no PSD
  pct: number | null // done/total * 100 rounded to 2 decimals, or null if total === 0
}

export interface PsdStat {
  mtimeMs: number
  ctimeMs: number // creation/birth time in ms; legacy field name kept for compatibility
}

/** 只包含进度缓存字段的子项目更新，用于持久化扫描/标记结果。 */
export interface ChildProgressUpdate {
  childId: string
  lastMtimeMs: number
  psdStats?: PsdStat[]
  statsVersion?: number
  psdModeStats?: Record<WorkMode, PsdStat[]>
  modeStatsVersion?: number
}

export interface PsdEntry {
  /** File revision; optional for historical records. */
  size?: number
  absPath: string
  mtimeMs: number
  ctimeMs: number
  status: TypesetStatus // derived from isTypesetDone
  /** 多模式标记：嵌字/翻译/校对/监修。扫描阶段只填充 typeset。 */
  modes?: WorkModeStatus
  /** 各模式的完成时间；没有完成时为空。 */
  modeTimestamps?: Partial<Record<WorkMode, number>>
}

export interface JpgPsdPair {
  jpgPath?: string // optional — some PSDs may not have a matching JPG
  psd: PsdEntry
  previewOnly?: boolean // image fallback entry used only when the folder has no PSDs
  countsTowardProgress?: boolean // scanner-selected effective progress entry
}

export interface ChildProjectScan {
  jpgPairs: JpgPsdPair[]
  imageFiles?: string[]
  txtFiles: string[]
  errors: { path: string; msg: string }[]
  /**
   * 扫描稳定性状态（2026-10-05 移植 0.4.0）：
   *   · `complete`    全部读成功；
   *   · `partial`     部分路径读失败（结果仍可用，但**入库前**要过 `requireCompleteScan`）；
   *   · `unavailable` 章节根目录不在（被删 / 被改名）；
   *   · `unstable`    调度器连续多次都没等到稳定结果（文件仍在写），由调度器给出。
   * 与 `rootMissing` 的分工：`rootMissing` 只表达"目录不在"这一种，`status` 是全集。
   */
  status?: 'complete' | 'partial' | 'unavailable' | 'unstable'
  /** 调度器每稳定一次 +1（同目录递增，调用方可判断"这是不是一份新结果"）。 */
  revision?: number
  /** 图片与 TXT 的指纹（path/size/mtime 的 sha256）：内容变了能看出来（目录监听用）。 */
  sourceRevision?: string
  /** **全部**文件（PSD + 原图 + TXT）的指纹 —— 只用于"改名认领"的比对（见 ChildProject）。 */
  contentFingerprint?: string
  /**
   * 章节根目录本身**不在**（被删掉 / 被改名）。
   *
   * 与"读不到"（权限不足、网络盘没挂载、OneDrive 占位符）不是一回事：前者是用户
   * 自己整理文件造成的**预期状态**，后者才是该报出来的错误。调用方据此决定
   * "怎么提示"。
   *
   * ⚠️ 但两者都**不许**把这一话记成"0 页"：会让侧栏/首页永久显示 0/0，且
   * `statsVersion` 一旦落库，`enrichMissingStats` 再也不会补算（重启也不自修）。
   * 这个字段只影响提示文案，不改变"不写库"这条底线。
   */
  rootMissing?: boolean
}

// Registry record types (for electron-store persistence)
export interface ChildProjectRecord {
  id: string
  parentTitle: string
  folderPath: string
  chapterNumber: string
  projectTitle: string
}

export interface ParentProjectRecord {
  id: string
  title: string
  sourceRoot?: string
  children: ChildProjectRecord[]
}
