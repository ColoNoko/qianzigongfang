/**
 * 校对记录（译文栏改版**第 2 批**）—— 数据契约 + 纯规则 + 导出文本。
 *
 * ## 为什么需要这张表（物理约束，不是"顺手加个功能"）
 *
 * `LabelPlusLabel` 每条**只有一个文本位**（`{ index, group, text, position }`）。
 * 「校对」是**覆盖保存**：写完之后，**原文在 txt 里就不存在了**。
 * ⇒ 想回答"这一句原来是什么、我改成了什么、为什么改"，**只能存在我们这边**。
 * 所以本模块与它背后那张表是这一批的**地基**，不是可选装饰。
 *
 * ## 一条底线：理由绝不入 txt
 *
 * 理由/评价只进 App 数据库，**永远不写进 `LabelPlusFX` 的 txt**
 * （进去就破坏那个格式的兼容性，那是这一路守的底线）。
 * 导出文件是**另存为**到用户选的位置，也不落在话目录里。
 *
 * ## 这一层只放"不碰文件系统、不碰数据库"的部分
 *
 * 键怎么算、原文空了怎么写、导出长什么样 —— 全在这里，且全是纯函数：
 * 这样"导出格式逐字对不对"能被单测**逐字**盯住，而不是靠人眼看图。
 * 真正的读写在 `main/services/db/translation-review-store.ts`。
 */
import type { WorkMode } from './types'
import { sanitizeFileNamePart } from './file-name'

/** 译文栏的两档（用户拍板：只有两档，「全能」已删）。 */
export type TranslationPaneMode = 'translate' | 'review'

/**
 * 四模式 → 译文栏档位的**默认值**（联动规则，用户拍板）。
 *
 * 只有「校对」工序落到校对档；其余三档都在翻译档。
 * ⚠️ 这是"默认值"不是"锁死"：用户在界面手动改过之后，本会话内不再跟随
 * （见 `views/Project.vue` 的 `paneModePinned`）。
 */
export function paneModeForWorkMode(mode: WorkMode | null | undefined): TranslationPaneMode {
  return mode === 'proofread' ? 'review' : 'translate'
}

/**
 * 一条校对记录。
 *
 * 键 = **话目录 + 图名（不分大小写）+ 条目序号**：
 * 用"文件里真实存在的东西"定位，不用数组下标（下标会随文件内容变化而漂）。
 * 这与 `ChapterTranslationEdit` 的定位口径一致。
 */
export interface TranslationReviewRecord {
  /** 话目录（绝对路径，存进去之前会过 {@link normalizeReviewFolder}）。 */
  folderPath: string
  /** txt 里的图名（原样存一份，供导出与显示）。 */
  imageName: string
  /** 该图里的条目序号（txt 里写的那个 `index`）。 */
  labelIndex: number
  /** 校对时工作台显示的页码（1 起）—— 导出时给"第 N 页"，只是方便对方定位。 */
  page: number
  /**
   * **校对前**的「翻」文本。
   *
   * ⚠️ 这一格**写一次就不再改**（见 store 的 upsert）：覆盖保存之后 txt 里就没有它了，
   * 若第二次校对此格，唯一的那份原文会被"上一次的校对稿"顶掉 —— 那是真数据丢失。
   */
  originalText: string
  /** 校对后写进 txt 的那份文本。 */
  reviewedText: string
  /** 校对理由/评价（**绝不入 txt**）。 */
  reason: string
  /** 最后更新时间（毫秒）。 */
  at: number
}

/**
 * 原文为空时**唯一**的说法（漏翻）。
 *
 * ⚠️ 界面与导出**共用这一句**：两处各写一遍的话，早晚会有一处改了、另一处没改，
 * 而对着一份"漏翻清单"逐个核对的人**不会怀疑是两处文案不一致**。
 */
export const REVIEW_MISSING_ORIGINAL = '（无 —— 翻译漏了这处）'

/**
 * 路径归一：**统一斜杠、去尾斜杠、转小写**。读取与写入都要过它，否则键会对不上。
 *
 * 为什么连大小写也要归一：Windows 路径**本来就不分大小写**，而这一格只当"哪一话"的
 * 分区键用（显示用的路径不经过它）。若只按原样存，用户重扫一次项目、盘符大小写变了，
 * 记录就会**静默分成两套** —— 界面表现为"我的校对记录不见了"，正是最难查的那类。
 * 本仓库 `connection.ts` 的 `normalizeImportedPath()` 也是这个口径。
 */
export function normalizeReviewFolder(folderPath: string | null | undefined): string {
  return String(folderPath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLocaleLowerCase()
}

/** 图名归一：**不分大小写**（与 `findTranslationEntryForPage` 的口径一致）。 */
export function normalizeReviewImage(imageName: string | null | undefined): string {
  return String(imageName ?? '')
    .trim()
    .toLocaleLowerCase()
}

/**
 * 一条记录的键（内存里做索引时用同一套拼法，别在别处手拼）。
 *
 * 用 `\u0000` 分隔：路径与图名里都不可能出现它，所以不会撞键。
 */
export function reviewKey(
  folderPath: string | null | undefined,
  imageName: string | null | undefined,
  labelIndex: number
): string {
  return `${normalizeReviewFolder(folderPath)}\u0000${normalizeReviewImage(imageName)}\u0000${
    Number.isFinite(labelIndex) ? Math.trunc(labelIndex) : -1
  }`
}

/**
 * 「翻：」那一行该显示什么 —— 原文为空（翻译漏了这处）就给那句固定的话。
 *
 * 其余情况原样给（只去首尾空白，与清单里 `rowText()` 的口径一致）。
 */
export function displayReviewOriginal(text: string | null | undefined): string {
  const trimmed = String(text ?? '').trim()
  return trimmed || REVIEW_MISSING_ORIGINAL
}

/** 导出时"一条"要吃的东西 —— 已经是**解好的**值，格式化时不再回文档里找。 */
export interface TranslationReviewExportEntry {
  page: number
  imageName: string
  /** 校对前的原文（为空 ⇒ 导出照写漏翻那句）。 */
  originalText: string
  /** **定稿**的译文：能对上当前 txt 就用 txt 里的现在值，对不上才回落到记录里的。 */
  reviewedText: string
  /** 理由（空 ⇒ **不写「评：」那一行**，不是写一行空的）。 */
  reason: string
}

export interface TranslationReviewExportInput {
  /** 作品名（父级标题）。 */
  workTitle: string
  /** 话名（子项目标题）。 */
  chapterTitle: string
  /** 导出时刻（毫秒）—— 按本机本地时间写进文件头。 */
  exportedAt: number
  entries: readonly TranslationReviewExportEntry[]
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 文件头里那行时间：`YYYY-MM-DD HH:mm`（本地时间）。 */
export function formatReviewExportTime(exportedAt: number): string {
  const date = new Date(Number.isFinite(exportedAt) ? exportedAt : Date.now())
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  )
}

/**
 * 导出文本（**逐字锁着**，见 `__tests__/translation-review.spec.ts`）。
 *
 * 形状：四行文件头（作品 / 话 / 时间 / 条数）+ 空行 + 每条三行式
 * （`第N页·文件名` ／ `翻：` ／ `校：` ／ 可选 `评：`），条与条之间空一行，结尾一个换行。
 *
 * 为什么坚持"每条列出文件名 + 页码"：这份东西是**发给别人看缺漏**的，
 * 对方手里只有文件，得能按图索骥找到那一页。
 */
export function buildTranslationReviewExport(input: TranslationReviewExportInput): string {
  const entries = Array.isArray(input.entries) ? input.entries : []
  const lines: string[] = [
    `作品：${String(input.workTitle ?? '').trim()}`,
    `话：${String(input.chapterTitle ?? '').trim()}`,
    `时间：${formatReviewExportTime(input.exportedAt)}`,
    `已校：${entries.length} 条`
  ]
  for (const entry of entries) {
    const reason = String(entry.reason ?? '').trim()
    lines.push(
      '',
      `第${Math.trunc(Number(entry.page) || 0)}页·${String(entry.imageName ?? '').trim()}`,
      `翻：${displayReviewOriginal(entry.originalText)}`,
      `校：${String(entry.reviewedText ?? '').trim()}`
    )
    // **无评不写那一行**（写一行空的"评："会让对方以为"有评价但是空的"）。
    if (reason) lines.push(`评：${reason}`)
  }
  return `${lines.join('\n')}\n`
}

/** 读这一话全部校对记录的结果（**不抛**：读不出来就 `ok: false` + 一句人话）。 */
export interface TranslationReviewListResult {
  ok: boolean
  records: TranslationReviewRecord[]
  message: string
}

/**
 * 写一条校对记录的结果。
 *
 * **不抛异常**：写不进去（库锁着 / 磁盘满）是"正常结果"之一 ——
 * 界面照实说一句，用户还能把这一条改回去，而不是整页白屏。
 */
export type TranslationReviewSaveResult = { ok: true } | { ok: false; message: string }

/**
 * 删一条校对记录的请求。
 *
 * ⚠️ 调用方（界面）**必须先确认原文已经写回 txt**，再发这一条 ——
 * 这一格是"校对前的原文"唯一的一份，删早了就真丢了。
 */
export interface TranslationReviewDeleteRequest {
  folderPath: string
  imageName: string
  labelIndex: number
}

/**
 * 删一条校对记录的结果。
 *
 * `deleted: false` = **本来就没有这条**（不是错误，界面不该为此报错）。
 */
export type TranslationReviewDeleteResult =
  { ok: true; deleted: boolean } | { ok: false; message: string }

/** 导出请求：文本由渲染层拼好（那里才有作品名/话名与文档），主进程只负责"弹框 + 写"。 */
export interface TranslationReviewExportRequest {
  text: string
  /** 「另存为」的默认文件名（非法字符已由 {@link translationReviewExportFileName} 洗过）。 */
  defaultFileName: string
}

/**
 * 导出结果。
 *
 * `saved: false` + 没有 `error` = **用户取消了**（不是失败，不该报错）。
 */
export interface TranslationReviewExportResult {
  saved: boolean
  path?: string
  error?: string
}

/**
 * 「另存为」对话框的默认文件名：`{作品}-{话}-校对记录.txt`。
 *
 * 清洗规则在 {@link sanitizeFileNamePart}（**唯一一处** —— 另存译文那份也用同一个，
 * 否则早晚会出现"一个洗了 `?`、另一个没洗"）。
 */
export function translationReviewExportFileName(workTitle: string, chapterTitle: string): string {
  const parts = [sanitizeFileNamePart(workTitle), sanitizeFileNamePart(chapterTitle)].filter(
    Boolean
  )
  return [...parts, '校对记录'].join('-').concat('.txt')
}
