import type { TranslationCredits } from './translation-credits'
/**
 * 章节译文（LabelPlus txt）—— P1「译文对照」的数据契约与纯规则。
 *
 * 这一层只放**不碰文件系统**的部分：排序规则与"这一页对应哪一条译文"。
 * 真正的找文件 / 读文件 / 解析在主进程（`main/services/chapter-translation.ts`）。
 *
 * ## 三条用户拍板的规则
 *
 * 1. **不落库**：话目录里现扫现读，不进数据库、不记路径（所以也没有迁移问题）。
 * 2. **取最新**：一个目录里有多份 `.txt` 时，按修改时间倒序，从最新那份往下试。
 * 3. **认不认它是 LabelPlus 文本，只看解析是否成功** —— 不按文件名猜（"像不像"那类
 *    启发式在本仓库栽过，见 §16 的 28 条误报）。所以排序只负责"顺序"，
 *    解析成功与否由主进程逐个试，试到 `CHAPTER_TRANSLATION_MAX_ATTEMPTS` 为止。
 */
import type { LabelPlusDocument, LabelPlusImageEntry, LabelPlusLabel } from './labelplus-import'
import { sanitizeFileNamePart } from './file-name'

/** 目录里的一个 `.txt` 候选（`mtimeMs` 由主进程 stat 得到）。 */
export interface ChapterTranslationCandidate {
  path: string
  name: string
  mtimeMs: number
}

/**
 * 最多尝试解析几个候选。
 *
 * 话目录里常混着原文 / 台本 / 说明之类的普通 txt，它们不是 LabelPlus 文本。
 * 逐个从新到旧试、第一个解析成功的胜出；试到这个上限就停 ——
 * 不为了一个话把整个目录读一遍。
 */
export const CHAPTER_TRANSLATION_MAX_ATTEMPTS = 5

/**
 * 按修改时间倒序排（最新在前），最多取前 `limit` 个。
 *
 * 时间相同则按文件名升序 —— 目录扫描顺序本身不保证稳定，这里补一道，
 * 让"取最新"在时间戳打平时也**可复现**（同一个目录扫两次结果一致）。
 * 不修改传入数组（调用方可能还要用原顺序）。
 */
export function rankChapterTranslationCandidates(
  candidates: readonly ChapterTranslationCandidate[],
  limit: number = CHAPTER_TRANSLATION_MAX_ATTEMPTS
): ChapterTranslationCandidate[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0
  return [...(Array.isArray(candidates) ? candidates : [])]
    .sort((left, right) => {
      const byTime = (Number(right.mtimeMs) || 0) - (Number(left.mtimeMs) || 0)
      if (byTime !== 0) return byTime
      return String(left.name).localeCompare(String(right.name), 'zh-CN')
    })
    .slice(0, safeLimit)
}

/** 取主文件名（去目录、去最后一个扩展名），小写比较用。 */
function stemOf(fileName: string): string {
  const base = fileName.trim().split(/[\\/]/).pop() ?? ''
  return base.replace(/\.[^.]+$/, '').toLocaleLowerCase()
}

/**
 * 一份 txt 的**基指纹**（P2 保存前比对用）。
 *
 * 为什么要有：保存是"读 → 改 → 写"三步，中间隔着人的思考时间。
 * 若这期间 LabelPlusFX（或任何别的东西）动过这个文件，我们就是在**覆盖别人的改动**。
 * 所以读的时候记一份指纹，写之前再算一遍，不一致就**拒绝写入**。
 *
 * ⚠️ **判定只认 `sha256`**（内容才是真相）：`mtimeMs` 只跟着记下来供诊断 ——
 * 有些工具会"碰一下"文件改掉 mtime 而内容没变，那种情况不该拦住保存。
 */
export interface ChapterTranslationFingerprint {
  size: number
  mtimeMs: number
  sha256: string
}

/** 最终采用的那份 txt（`status === 'ok'` 时才有）。 */
export interface ChapterTranslationFileInfo {
  path: string
  name: string
  mtimeMs: number
  size: number
  sha256: string
}

/**
 * 一次读取的结果。
 *
 * · `ok`        —— 解析成功，`document` 里有内容；
 * · `not-found` —— 没有可用的译文：目录里没有 `.txt`，或者 `txt` 都不是 LabelPlus 文本
 *                  （两者用 `message` 区分，界面照实显示）；
 * · `error`     —— 目录本身读不了（不存在 / 没权限）。`message` 是人话。
 *
 * 三者都**不抛异常**：找不到译文是常态，不该让工作台弹错误。
 */
export type ChapterTranslationStatus = 'ok' | 'not-found' | 'error'

export interface ChapterTranslationReadResult {
  status: ChapterTranslationStatus
  /** 实际采用的那份；`not-found` / `error` 时是 null。 */
  file: ChapterTranslationFileInfo | null
  /** 话目录里 `.txt` 的总数（事实，供空态说明用）。 */
  txtCount: number
  /** 人话说明；`ok` 时是空串。 */
  message: string
  /** `ok` 时的解析结果，其余为 null。 */
  document: LabelPlusDocument | null
}

/**
 * 一次保存里"要改哪一条、改成什么"（P2）。
 *
 * · 只带**要改的字段**；没带的字段一律不动。
 * · 定位靠 `imageName + labelIndex`（就是 txt 里写的那两个值）——**不靠数组下标**：
 *   下标会随文件内容变化而漂，而"图名 + 序号"是文件里真实存在的东西。
 * · 分组用**名字**而不是编号：编号的含义是"头部那张分组表里的第几个"，
 *   表一变含义就变；名字交给主进程拿**刚读到的**那份表去解析，解析不出就拒绝写。
 *
 * ⚠️ 主进程**不信任**这份载荷里的任何"行号/旧值"——它会在写之前重新读文件、
 * 重新定位（见 `main/services/chapter-translation-rewrite.ts` 的文件头）。
 */
export interface ChapterTranslationEdit {
  imageName: string
  labelIndex: number
  /** 新的译文文本（多行用 `\n`）；不带 = 不改文本。 */
  text?: string
  /** 新的归一化坐标；须成对出现，不带 = 不改坐标。 */
  position?: { x: number; y: number }
  /** 新的分组名（须是头部那张表里已有的名字）；不带 = 不改分组。 */
  groupName?: string
}

/** 保存请求（P2）。 */
export interface ChapterTranslationSaveRequest {
  credits?: TranslationCredits
  /** 要写的那份 txt；必须来自 `ChapterTranslationReadResult.file.path`。 */
  filePath: string
  /** 读进来时记下的基指纹 —— 写之前会拿它比对（见 {@link ChapterTranslationFingerprint}）。 */
  base: ChapterTranslationFingerprint
  edits: ChapterTranslationEdit[]
  /**
   * 用户在冲突提示里**明确选了**"强制覆盖"。
   * 只有它为 `true` 时才允许"基指纹对不上也写"；默认一律拒绝。
   */
  force?: boolean
}

/**
 * 保存结果。
 *
 * **冲突不是异常**，而是"拒绝写入"这条正常路径：界面照实说明，并给两条明确的路
 * （重新读取 / 强制覆盖）。同理，找不到条目、坐标越界这类"这份文件不改"的结果
 * 也走 `ok: false`，而不是抛异常 —— 抛异常会被上层变成一句笼统的"保存失败"。
 */
export type ChapterTranslationSaveResult =
  | {
      ok: true
      /** 真的写盘了；`false` = 盘上内容已经一致，**跳过写入**（不churn mtime、不惊动目录监听）。 */
      changed: boolean
      /** 写前备份的路径；没写盘时为 `null`。 */
      backupPath: string | null
      /** 落盘后的新指纹（`changed === false` 时就是当前盘上那份的）。 */
      fingerprint: ChapterTranslationFingerprint
    }
  | {
      ok: false
      kind: 'conflict' | 'invalid' | 'io'
      message: string
      /** `kind === 'conflict'` 时给出**盘上当前那份**的指纹，供界面说明"它被改过了"。 */
      current?: ChapterTranslationFingerprint
    }

/**
 * 「回退最近一次保存」的请求（2026-10-07）。
 *
 * ## 它和"保存"共用同一条通道的**理由**
 *
 * 回退也是"写用户话目录里那份 txt"，所以它**必须**走 `chapter-translation-write`
 * —— 那里是全项目唯一会写话目录的地方，安全网（指纹 / 备份 / 原子写 / 回读）也都在那儿。
 *
 * ## 退回的是哪一版（用户拍板：**最近一次保存前**）
 *
 * 依据是**会话内的内存堆栈**，不是磁盘上那串备份：备份只留最近 N 份、且跨话共享，
 * 而译文是"失焦即存"，一次会话轻松超过 N 次保存 ⇒ 本会话最早那份备份会被清掉。
 * 内存堆栈则天然"限本会话"（进程退出即空）。
 */
export interface ChapterTranslationUndoRequest {
  /** 要回退的那份 txt；来自 `ChapterTranslationReadResult.file.path`。 */
  filePath: string
  /**
   * 界面手上那份的指纹 —— 写之前会重新算一遍比对。
   * 对不上说明"你读进来之后又被别处改过" ⇒ **拒绝回退**（绝不覆盖别人的改动）。
   */
  base: ChapterTranslationFingerprint
}

/**
 * 回退结果。形状与 {@link ChapterTranslationSaveResult} 一致，理由也一样：
 * **冲突不是异常**，而是"拒绝写入"这条正常路径；界面照实说明即可。
 */
export type ChapterTranslationUndoResult =
  | {
      ok: true
      /** 真的写盘了；`false` = 盘上已经就是要退回的那份，**跳过写入**。 */
      changed: boolean
      /**
       * `true` = 这一步回退是**把刚新建的那份 txt 删掉**（第 5 批的"从零新建"撤回）。
       * 此时 `fingerprint` 给回的是**删之前那份**的指纹（文件已经没了，调用方应当重读）。
       */
      deleted?: boolean
      /** "回退前"的备份（返程票）；没写盘时为 `null`。 */
      backupPath: string | null
      /** 回退后的新指纹。 */
      fingerprint: ChapterTranslationFingerprint
    }
  | {
      ok: false
      kind: 'conflict' | 'invalid' | 'io'
      message: string
      /** `kind === 'conflict'` 时给出**盘上当前那份**的指纹。 */
      current?: ChapterTranslationFingerprint
    }

/**
 * 「新增框」（第 5 批，2026-10-07）：在某个图片块**末尾**插入一条新译文。
 *
 * ## 新序号由主进程算，渲染层**不传**
 *
 * 序号 = 该图已有条目里最大的序号 +1（空图块从 1 起）。渲染层不传的原因与"主进程不信任
 * 载荷"同一条纪律：渲染层手上的清单可能已经过期（重扫/并发），传了就会撞号。
 * 插入成功后把 `insertedIndex` 还给渲染层，让它知道"刚才那一条现在是第几条"。
 */
export interface ChapterTranslationInsertRequest {
  imageName: string
  /** 分组名（必须是这份 txt 分组表里已有的名字；框内/框外）。 */
  groupName: string
  /** 归一化坐标（0..1，相对图片左上角）；越界会**整份拒绝**。 */
  position: { x: number; y: number }
  /** 新条目的译文文本；不填 = 空条目（只有标签头，没有内容行）。 */
  text?: string
}

/** 插入结果。`text` = 新整份文本；`insertedIndex` = 主进程算出来的新序号。 */
export type ChapterTranslationInsertResult =
  { ok: true; text: string; insertedIndex: number } | { ok: false; reason: string }

/**
 * 「新增框」**写盘**请求（第 5 批，2026-10-07）—— 这一话**已经有** txt 时：把新条目插进去。
 *
 * 与 `ChapterTranslationSaveRequest`（改现有条目）走**同一套安全网**：
 * 读盘 → 比基指纹（对不上就拒绝）→ 写前备份 → 原子替换 → 写后回读 → 压一层会话基线
 * （所以 **Ctrl+Z 能撤掉这次新增**，不用另做撤销）。
 */
export interface ChapterTranslationInsertSaveRequest {
  /** 要写的那份 txt；来自 `ChapterTranslationReadResult.file.path`。 */
  filePath: string
  /** 界面手上那份的指纹；写之前重新算一遍比对，对不上**拒绝写入**。 */
  base: ChapterTranslationFingerprint
  insert: ChapterTranslationInsertRequest
}

/** 插入写盘结果：在保存结果之上多一个**新序号**（渲染层据此滚到/高亮那一条）。 */
export type ChapterTranslationInsertSaveResult =
  | {
      ok: true
      changed: boolean
      backupPath: string | null
      fingerprint: ChapterTranslationFingerprint
      insertedIndex: number
    }
  | {
      ok: false
      kind: 'conflict' | 'invalid' | 'io'
      message: string
      current?: ChapterTranslationFingerprint
    }

/**
 * 「新增框」**从零新建**请求（第 5 批）—— 这一话**一份能解析的 txt 都没有**时：
 * 在**话目录**里新建一份（`{话文件夹名}.txt`；同名加 `-2`·`-3`…）。
 *
 * 三条硬规矩（都是"往用户目录写文件"这条路的底线）：
 * · **绝不覆盖**：靠 `publishOutput(..., overwrite=false)` 的 link 分支"创建即判定"
 *   （目标在就换下一个名字）—— 不是"先 stat 再写"，没有竞争窗口；
 * · **不弹框**（用户拍板）：名字按规则自己算，不打断；
 * · 返回**真正写出去的那个路径** —— 界面要拿它去重读，别猜。
 */
export interface ChapterTranslationCreateRequest {
  /** 话自己的目录（新文件落在这里；**只扫这一层**，与读译文同一条规则）。 */
  folderPath: string
  /** 这一话按页序的图名（版式要按页排；空数组 ⇒ 拒绝）。 */
  pages: string[]
  insert?: ChapterTranslationInsertRequest
  credits?: TranslationCredits
}

/** 从零新建的结果。`path` = 真正写出去的位置（同名时是 `-2` / `-3` …）。 */
export type ChapterTranslationCreateResult =
  | {
      ok: true
      path: string
      fileName: string
      insertedIndex: number
      fingerprint: ChapterTranslationFingerprint
    }
  | { ok: false; kind: 'invalid' | 'io'; message: string }

/**
 * 「**删除一条译文**」的请求（第 5 批 5e，2026-10-07）—— 用户拍板的定稿。
 *
 * ## 删哪些行（Q5=A 定稿）
 *
 * 只删这一条**自己**的行区间：`headerLine..contentEndLine`（标签头 + 它的内容行）。
 * **条目之间的分隔空行不归它管、原样留着** —— 空行属于**文件版式**，
 * 动它就跳出"删这一条"的语义，也会把"其余字节逐字节不变"这条承重墙弄松。
 * （观感上的"删多了攒空行"列为将来单独一批，不在本轮。）
 *
 * ## 序号重排（用户拍板定稿）
 *
 * 删掉第 N 条之后，**同一张图里**序号 > N 的条目要把标签头里的序号 -1（不留空号）。
 * ⇒ 这条链路上"校对记录按 `labelIndex` 存"这件事必须跟着迁移（见 `renumberTranslationReviews`），
 * 否则记录会**指错条目**。
 *
 * ## 没有的就是错的
 *
 * 找不到这张图 / 这张图里没有这一条 ⇒ **整份拒绝**，一个字节都不写
 * （与"改 / 插"同一条纪律：宁可什么都不做，也不猜）。
 */
export interface ChapterTranslationDeleteRequest {
  imageName: string
  /** 要删的那一条的序号（**主进程按它定位**，不按"界面上的第几行"）。 */
  labelIndex: number
}

/**
 * 删除结果。
 *
 * `renumbered` = 被 -1 的那些**原序号**（同一张图里大于被删序号的那些，升序）。
 * 界面拿它去把"草稿里按序号存的那几条改动"跟着挪 —— 不挪的话，
 * 删第 3 条之后草稿里第 4 条的改动会被当成"第 4 条"（那是**另一句话**）。
 */
export type ChapterTranslationDeleteResult =
  | { ok: true; text: string; deletedIndex: number; renumbered: number[] }
  | { ok: false; reason: string }

/**
 * 「删除一条译文」**写盘**请求（第 5 批 5e）—— 与「保存」「新增框」走**同一套安全网**。
 *
 * 与它们的分工只在于"要写的新文本怎么算出来的"：
 * · 保存 = 按 `edits` 原地改行；
 * · 新增 = 在图片块末尾插入新条目；
 * · **删除（本条）= 删掉某一条的行区间 + 同图后续条目序号 -1**（见 `chapter-translation-rewrite.ts`
 *   的 `deleteChapterTranslationEntry`；两件事在同一次纯函数调用里原子完成）。
 *
 * ⇒ 于是"读盘 → 比指纹 → 写前备份 → 原子替换 → 写后回读 → 压会话基线"这一段**完全复用**，
 * **Ctrl+Z 也就能撤回这次删除**（不用另做撤销）。
 */
export interface ChapterTranslationDeleteSaveRequest {
  /** 要改的那份 txt；来自 `ChapterTranslationReadResult.file.path`。 */
  filePath: string
  /** 界面手上那份的指纹；写之前重新算一遍比对，对不上**拒绝写入**。 */
  base: ChapterTranslationFingerprint
  /** 删哪一张图里的哪一条。 */
  delete: ChapterTranslationDeleteRequest
}

/**
 * 删除写盘结果。
 *
 * · `changed: false` = 盘上本来就已经没有这一条（例如别处先删了）—— **不是失败**；
 * · `renumbered` = 被 -1 的那些**原序号**（升序），界面据此挪"按序号存的草稿改动"。
 */
export type ChapterTranslationDeleteSaveResult =
  | {
      ok: true
      changed: boolean
      backupPath: string | null
      fingerprint: ChapterTranslationFingerprint
      deletedIndex: number
      renumbered: number[]
    }
  | {
      ok: false
      kind: 'conflict' | 'invalid' | 'io'
      message: string
      current?: ChapterTranslationFingerprint
    }

/**
 * 「另存一份译文」的请求（第 3 批）。
 *
 * ## 与"保存"是两件事（这是本批最要紧的一条）
 *
 * 「保存」写的是**用户话目录里那份 txt**（唯一会写话目录的通道，走指纹/备份/原子写/回读）；
 * 「另存」写的是**用户自己选的位置**（可能放到桌面、发给别人）——
 * 所以它们**必须是两条通道**：另存这条路**一个字节都不许碰话目录**。
 *
 * 同理，另存**不比对基指纹、也不留备份**：它不是"改用户的原件"，是一次导出。
 * 唯一保留的是**写后回读**（写完读回来与预期不一致就如实报错）。
 */
export interface ChapterTranslationExportRequest {
  /**
   * 要复制的那份 txt；话目录里没有可解析的 txt 时传 `null` ⇒ 走"从零生成一份空底稿"。
   */
  sourcePath: string | null
  /**
   * **还没落盘**的改动（草稿里的那些）。
   *
   * 要带上它们的理由：另存出来的应当是"**当前翻译**"（界面上现在这份）。
   * 若是等落盘再另存，用户就会拿到一份"少了自己刚改的那几条"的文件 —— 那种错最难发现。
   */
  edits: ChapterTranslationEdit[]
  /** 「另存为」的默认文件名（**只有名字**，非法字符由 {@link chapterTranslationExportFileName} 洗过）。 */
  defaultFileName: string
  /** 「另存为」对话框打开时先落在哪个目录（话目录）；空串 = 交给系统记着的上次位置。 */
  defaultDirectory: string
  /** **从零生成**时用的页面图名（按页序）。有 `sourcePath` 时用不上。 */
  pages: string[]
}

/**
 * 另存结果。
 *
 * `kind: 'canceled'` = **用户自己取消了**（不是失败，界面不该为它报错，`message` 为空串）。
 */
export type ChapterTranslationExportResult =
  | {
      ok: true
      /** 真正写出去的那个路径。 */
      path: string
      /** 写出去的字节数。 */
      bytes: number
      /** `true` = 这一话没有可解析的 txt，这份是**从零生成的空底稿**。 */
      generated: boolean
    }
  | { ok: false; kind: 'canceled' | 'invalid' | 'io'; message: string }

/**
 * 「另存为」的默认文件名：`{底稿名}-另存-{YYYYMMDD-HHmm}.txt`。
 *
 * 为什么带时间戳：另存是"留一份副本 / 交稿"，同名反复另存会一直弹"要不要覆盖"，
 * 而覆盖掉上一份副本往往不是用户想要的。
 */
export function chapterTranslationExportFileName(sourceStem: string, at: number): string {
  const stem = sanitizeFileNamePart(sourceStem) || '译文'
  const date = new Date(Number.isFinite(at) ? at : Date.now())
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `${stem}-另存-${stamp}.txt`
}

/**
 * 坐标写几位小数：**4 位**（真实 LabelPlusFX 产物就是 4 位）。
 *
 * 两个用法是**同一条规则的两面**，所以常量只在这里定义一处：
 * · **新条目**（{@link serializeChapterTranslationLabel}）：正好写 4 位；
 * · **改现有条目**（`main/services/chapter-translation-rewrite.ts` 的 `formatCoordinate`）：
 *   沿用原本那条的小数位，**不足 4 位就补到 4 位** —— 否则 2 位甚至整数格式的文件里，
 *   用户刚拖出来的位置会被四舍五入掉（整数格式下坐标只能取 0 或 1）。
 */
export const MIN_POSITION_DECIMALS = 4

/** 标签头的短横线：照真实 LabelPlusFX 产物（16 个；parser 认 `-{6,}`）。 */
const LABEL_HEADER_DASHES = '-'.repeat(16)

/**
 * 一条译文的「标签头 + 内容行」（第 5 批，2026-10-07）。
 *
 * ⚠️ **"新增框"与"从零新建"共用这一处格式实现** —— 两处各写一遍，早晚会出现
 * "一边 16 个短横线、另一边 32 个"这种只有真机才现形的分叉。
 *
 * · `index`：序号（在该图里的位置，从 1 起）；
 * · `groupIndex`：1 基 —— 框内 = 1、框外 = 2（就是分组表里的第几个）；
 * · 文本不填 / 空串 ⇒ **一条内容行都不写**（只有标签头，别造一个空行被读成"有内容"）。
 */
export function serializeChapterTranslationLabel(options: {
  index: number
  groupIndex: number
  position: { x: number; y: number }
  text?: string
}): string[] {
  const x = Number(options?.position?.x ?? 0).toFixed(MIN_POSITION_DECIMALS)
  const y = Number(options?.position?.y ?? 0).toFixed(MIN_POSITION_DECIMALS)
  const header = `${LABEL_HEADER_DASHES}[${options.index}]${LABEL_HEADER_DASHES}[${x},${y},${options.groupIndex}]`
  if (options.text === undefined) return [header]
  const nextLines = String(options.text).replace(/\r\n?/g, '\n').split('\n')
  if (nextLines.length === 1 && nextLines[0] === '') return [header]
  return [header, ...nextLines]
}

/** 头部：版本行 + 两条 `-` 夹分组表（分组表为空时回退 `默认`，与 parser 的回退名同词）。 */
function chapterTranslationHead(groups: readonly string[]): string {
  const names = (Array.isArray(groups) ? groups : [])
    .map((name) => String(name ?? '').trim())
    .filter(Boolean)
  const table = names.length > 0 ? [...new Set(names)] : ['默认']
  return ['1,0', '-', ...table, '-'].join('\n')
}

/** 图片块标题行（8 个分隔符；parser 认 `>{6,}`）。 */
function translationImageBlockHeader(imageName: string): string {
  return `>>>>>>>>[${imageName}]<<<<<<<<`
}

/**
 * **从零生成**一份空底稿（这一话连一份能解析的 txt 都没有时）。
 *
 * 版式照**真实 LabelPlusFX 产物**写（见 `docs/译文编辑与写回-P2-20261006.md` §7 那张对照表）：
 * 版本行 `1,0` → 两条 `-` 夹着分组表 → 每张图一个 `>>>>>>>>[图名]<<<<<<<<` 块（8 个分隔符）。
 *
 * ⚠️ 这里**只写结构、不编内容**：没有条目就是没有条目（一个标签行都不造），
 * 页面按调用方给的顺序排。分组表拿不到真实分组时写 `默认` —— 与
 * `labelplus-parser` 认不出分组表时的回退名**同一个词**，不另发明一个。
 *
 * 末尾换行用 `\n`（与真实文件一致），**不写 BOM**（我们没有"对方文件"可继承，
 * 而 UTF-8 无 BOM 是这套工具链自己的产出习惯）。
 */
export function buildEmptyChapterTranslationText(
  pages: readonly string[],
  groups: readonly string[] = []
): string {
  const head = chapterTranslationHead(groups)
  const blocks: string[] = []
  for (const page of Array.isArray(pages) ? pages : []) {
    const name = String(page ?? '').trim()
    if (!name) continue
    blocks.push(translationImageBlockHeader(name))
  }
  // 块与块之间空一行（真实文件就是这么分隔图片块的）；末尾收一个换行，**不留空行**。
  return blocks.length > 0 ? `${head}\n${blocks.join('\n\n')}\n` : `${head}\n`
}

/**
 * **从零新建**一份这一话的 txt，并在**点中的那一页**里带上第一条译文（第 5 批）。
 *
 * 版式与 {@link buildEmptyChapterTranslationText} 同源，差别只有一处：目标页的块里多一条条目
 * （序号从 1 起 —— 新建的那份本来就只有这一条）。分组表缺省写 `框内/框外`：
 * 这两组是这套工具链的默认两组，**新条目的组号就是表序**（框内 1、框外 2）。
 *
 * 返回 `null` = **拒绝产出**：页表为空 / 这一页不在页表里 / 组号不是正整数 /
 * 坐标不是 0..1 内的有限数。拒绝而不是"少写那条照样给你一份"—— 那种 txt 看着合法，
 * 却**静默丢掉了用户刚点的那一下**。
 */
export function buildChapterTranslationWithEntry(options: {
  pages: readonly string[]
  groups?: readonly string[]
  imageName: string
  groupIndex: number
  position: { x: number; y: number }
  text?: string
}): string | null {
  const imageName = String(options?.imageName ?? '').trim()
  if (!imageName) return null

  const groupIndex = Number(options?.groupIndex)
  if (!Number.isInteger(groupIndex) || groupIndex <= 0) return null

  const position = options?.position
  const validPosition =
    position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    position.x >= 0 &&
    position.x <= 1 &&
    position.y >= 0 &&
    position.y <= 1
  if (!validPosition) return null

  const names = (Array.isArray(options.pages) ? options.pages : [])
    .map((name) => String(name ?? '').trim())
    .filter(Boolean)
  if (names.length === 0) return null

  const wantedGroups = (Array.isArray(options.groups) ? options.groups : [])
    .map((name) => String(name ?? '').trim())
    .filter(Boolean)
  const groups = wantedGroups.length > 0 ? wantedGroups : ['框内', '框外']

  const labelLines = serializeChapterTranslationLabel({
    index: 1,
    groupIndex,
    position,
    text: options.text
  })

  const wanted = imageName.toLocaleLowerCase()
  let placed = false
  const blocks: string[] = []
  for (const name of names) {
    if (!placed && name.toLocaleLowerCase() === wanted) {
      placed = true
      // 图片块头用页表里的**真实图名**（大小写以磁盘为准，不用调用方传进来的那个）
      blocks.push([translationImageBlockHeader(name), ...labelLines].join('\n'))
      continue
    }
    blocks.push(translationImageBlockHeader(name))
  }
  if (!placed) return null

  return `${chapterTranslationHead(groups)}\n${blocks.join('\n\n')}\n`
}

/**
 * 这一页在 txt 里对应哪一条译文记录；找不到就是 `null`（界面按"本页无译文"显示）。
 *
 * **两档匹配，都是确定性的**（顺序即优先级）：
 * 1. 完整文件名（**不分大小写**）；
 * 2. 主名相同、扩展名不同（txt 写 `20.jpg`、磁盘上是 `20.png` 这类）。
 *
 * ⚠️ 与 `main/services/labelplus-matcher.ts` 的 `matchLabelPlusImages()` **不是同一件事**，
 * 别把两者合一：那个回答的是"txt 里的某个名字 → 目录里的哪个**文件**"（一对多、有扩展名
 * 优先级表）；这里回答的是"**这一页**的文件名 → txt 里的哪一条记录"（一对一，只这两档）。
 * 两个方向共用同一个输入域，改动任一处时请一起核对。
 */
export function findTranslationEntryForPage(
  document: LabelPlusDocument | null | undefined,
  fileName: string | null | undefined
): LabelPlusImageEntry | null {
  const images = document?.images
  if (!Array.isArray(images) || images.length === 0) return null
  const raw = typeof fileName === 'string' ? fileName.trim() : ''
  if (!raw) return null
  const base = (raw.split(/[\\/]/).pop() ?? '').toLocaleLowerCase()
  if (!base) return null

  const exact = images.find((image) => String(image.fileName).trim().toLocaleLowerCase() === base)
  if (exact) return exact

  const stem = stemOf(base)
  if (!stem) return null
  return images.find((image) => stemOf(String(image.fileName)) === stem) ?? null
}

/**
 * 按**写盘时的坐标**在一条记录里找回"刚新增的那一条"（第 5 批 5d-2，2026-10-07）。
 *
 * ## 为什么不能直接比坐标
 *
 * 新增之后，界面手上的是**用户点下去的那个坐标**（`normalizedPointFromCenterOffset` 算出来的，
 * 小数点后十几位），而盘上写的是序列化时 `toFixed(MIN_POSITION_DECIMALS)` 之后的值 ——
 * 两个数**不相等**。拿它做全等匹配，会在某些小数位上"一条都找不到"，
 * 而换个位置点又好了（典型"只有真机才现形"的那种错）。
 *
 * ## 匹配顺序（两条，都是"宁可什么都不亮，也不点亮错的那行"）
 *
 * 1. **序号**：主进程算出来的 `insertedIndex` 才是权威 —— 它在就认它；
 * 2. **坐标**：按**序列化后的值**比（`toFixed` 到同一个位数），容差极小（只为吃掉浮点误差）。
 *    再对不上就返回 `null`，交给调用方"只出一句提示、不点亮任何一行"。
 */
export function findTranslationLabelByPosition(
  entry: LabelPlusImageEntry | null | undefined,
  position: { x: number; y: number } | null | undefined,
  index: number | null | undefined
): LabelPlusLabel | null {
  const labels = entry?.labels
  if (!Array.isArray(labels) || labels.length === 0) return null

  if (index !== null && index !== undefined) {
    const byIndex = labels.find((label) => label.index === index)
    if (byIndex) return byIndex
  }

  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null
  const wanted = snappedChapterTranslationPosition(position)
  // 容差**刻意极小**：两个坐标都是同一个 `toFixed` 出来的 4 位小数，
  // 差的只该是浮点表示误差。容差放大到"差不多就算"，就等于在替用户认错行。
  const epsilon = 1e-6
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= epsilon
  return (
    labels.find(
      (label) =>
        close(label.position.x, wanted.x) &&
        close(label.position.y, wanted.y) &&
        Number.isFinite(label.position.x) &&
        Number.isFinite(label.position.y)
    ) ?? null
  )
}

/**
 * **归一到"写进文件时会变成的那个值"**（第 5 批 5d-2）。
 *
 * 取整规则**刻意与 {@link serializeChapterTranslationLabel} 完全一致**（同一个常量、同一个
 * `toFixed`），所以用它比坐标 = 比**文件里真的写着的那两个数**。
 *
 * ⚠️ 边界（如实说）：`toFixed` 的小数进位不是严格"四舍五入"（浮点表示所致），
 * 所以这是"复现序列化行为"，不是"从数学上还原原值" —— 而**与序列化一致**正是它唯一要的保证。
 */
export function snappedChapterTranslationPosition(position: { x: number; y: number }): {
  x: number
  y: number
} {
  return {
    x: Number(Number(position?.x ?? 0).toFixed(MIN_POSITION_DECIMALS)),
    y: Number(Number(position?.y ?? 0).toFixed(MIN_POSITION_DECIMALS))
  }
}
