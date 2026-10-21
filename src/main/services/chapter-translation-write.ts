import { rewriteTranslationCredits } from '../../shared/translation-credits'
/**
 * 章节译文的**写回服务**（P2-a，2026-10-06）—— 全项目**唯一**会写用户话目录文件的地方。
 *
 * ## 它做七件事，顺序就是安全语义
 *
 * 1. **算盘上现状**（size / mtime / sha256）与读回正文；
 * 2. **比对基指纹** —— 内容对不上就**拒绝写入**（除非用户明确选了"强制覆盖"）；
 * 3. **算出该变成什么样** —— 交给纯函数 `chapter-translation-rewrite`，
 *    它自己会拒绝每一种"会写坏文件"的情形（换行混用 / 坐标段数不对 / 译文里混进结构行…）；
 * 4. **内容没变就不写** —— 不churn mtime、不惊动目录监听；
 * 5. **写前备份**（`<userData>/backups/translation/`，留最近 {@link TRANSLATION_BACKUP_KEEP} 份）——
 *    备份失败就**不写**；
 * 6. **原子替换**（`publishOutput`：临时文件 → fsync → rename），任何一步失败原文件原样；
 * 7. **写后回读** —— 读回来的与预期不一致就**如实报错**并把备份路径告诉调用方（不假装成功）。
 *
 * ## 它还负责"回退最近一次保存"（2026-10-07）
 *
 * 回退也是写用户话目录，所以**必须**落在这个文件里（"唯一会写话目录的地方"这条不变量）。
 * 它复用上面同一套安全网，只是"要写回去的内容"换成 {@link sessionTranslationBaselines} 的栈顶
 * —— 也就是"上次保存之前那份原文"。见 {@link undoChapterTranslation}。
 *
 * ## 一条说在前面的边界（不宣称无条件安全）
 *
 * `publishOutput` 是"原子替换"，**不是跨进程写锁**：第 1 步与第 6 步之间还有一个极短的窗口。
 * 本机单用户点一次保存，这个窗口小到可忽略，但我们**不宣称**它是无条件安全的。
 * 更要紧的是：LabelPlusFX 里若还开着同一份 txt，**它保存时仍会覆盖我们的改动** ——
 * 那发生在别人的进程里，这里拦不住。
 *
 * ## 备份为什么不放在话目录里
 *
 * 扫描器只收 `.txt`，而我们"找译文"的规则是"取最新且能解析的那一份"——
 * 原地备份若带 `.txt` 后缀，回头会被**我们自己**当成正文选中（拿备份当正文，是真灾难）。
 * 所以统一放进 `<userData>/backups/translation/`：同一个备份根下的**子目录**，
 * 与外层那份数据库备份列表互不干扰。
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  buildEmptyChapterTranslationText,
  buildChapterTranslationWithEntry,
  type ChapterTranslationCreateRequest,
  type ChapterTranslationCreateResult,
  type ChapterTranslationDeleteSaveRequest,
  type ChapterTranslationDeleteSaveResult,
  type ChapterTranslationFingerprint,
  type ChapterTranslationInsertSaveRequest,
  type ChapterTranslationInsertSaveResult,
  type ChapterTranslationSaveRequest,
  type ChapterTranslationSaveResult,
  type ChapterTranslationUndoRequest,
  type ChapterTranslationUndoResult
} from '@shared/chapter-translation'
import { sanitizeFileNamePart } from '@shared/file-name'
import { publishOutput } from './atomic-output'
import { backupsDirectory, stamp } from './db-backup'
import {
  deleteChapterTranslationEntry,
  insertChapterTranslationEntry,
  rewriteChapterTranslationText
} from './chapter-translation-rewrite'

/** 译文备份最多留几份（与数据库备份同一档，见 `KEEP_BACKUPS`）。 */
export const TRANSLATION_BACKUP_KEEP = 20

/**
 * **本会话内"每次保存前的原文"的堆栈**（键 = 这份 txt 的路径）。
 *
 * ## 为什么在内存里，而不是去读磁盘上那串备份
 *
 * 备份只留最近 {@link TRANSLATION_BACKUP_KEEP} 份、而且是**跨话共享**的一个池子（按 mtime 删最老的）。
 * 译文是"**失焦即存**"，一次编辑会话轻松超过 20 次保存 ⇒ 本会话最早那份备份**会被 prune 删掉**，
 * 那时"本会话的基线"就找不回来了。放内存里则天然满足"**限本会话**"（进程退出即空），
 * 也不受 prune 影响，还不新增任何文件。
 *
 * ## 为什么是"栈"而不是单值
 *
 * 每次真的写盘压一层（内容 = 写盘**之前**那份原文），回退时弹一层。
 * 当前界面**只暴露"退一步"**（见 `useChapterTranslationDraft` 的 `canUndoSaved`）——
 * 将来若发现"退一步不够用"，只改界面与热键逻辑，**这一层一个字都不用动**。
 *
 * ## 每层保存文本和关联校对记录的回退操作；文本可能是 `null`
 *
 * `null` = **这次写盘之前那份文件根本不存在**（"从零新建"那条路，第 5 批）。
 * 撤销遇到 `null` 就是"把刚建出来的那份删掉"，而不是写回内容 —— 见 {@link undoChapterTranslation}。
 *
 * 导出只为让测试能验"重启后不认上一会话的备份"与逐层出栈；生产代码只经下面两个函数读写。
 */
/** Optional database work supplied by the IPC boundary; this module stays filesystem-only. */
export interface ChapterTranslationWriteEffects {
  apply?: () => Promise<void>
  undo: () => Promise<void>
}

export type PrepareChapterTranslationEffects = (change: {
  insertedIndex?: number
}) => Promise<ChapterTranslationWriteEffects>

interface SessionTranslationBaseline {
  text: string | null
  undoEffects?: () => Promise<void>
}

export const sessionTranslationBaselines = new Map<string, SessionTranslationBaseline[]>()

/**
 * 会话历史**只认当前这一话**：一旦出现另一份 txt（换话），上一话的历史整份丢掉。
 *
 * 用户拍板："换话 ⇒ 堆栈清空，不许跨话退。" 放在这里之后，"跨话退"在结构上就不可能
 * —— 历史里任何时候最多只有一份 txt 的层。
 */
function ensureSessionFile(filePath: string): void {
  if (sessionTranslationBaselines.size > 0 && !sessionTranslationBaselines.has(filePath)) {
    sessionTranslationBaselines.clear()
  }
}

/** 压一层：这次写盘**之前**那份原文（`null` = 之前根本没有这份文件）。 */
function pushSessionBaseline(
  filePath: string,
  text: string | null,
  undoEffects?: () => Promise<void>
): void {
  ensureSessionFile(filePath)
  const stack = sessionTranslationBaselines.get(filePath)
  const baseline = { text, undoEffects }
  if (stack) stack.push(baseline)
  else sessionTranslationBaselines.set(filePath, [baseline])
}

/** 弹一层（**只有真退成功了才调用** —— 没退成不该消耗历史）。 */
function popSessionBaseline(filePath: string): void {
  const stack = sessionTranslationBaselines.get(filePath)
  if (!stack) return
  stack.pop()
  if (stack.length === 0) sessionTranslationBaselines.delete(filePath)
}

/** 译文备份目录：同一个备份根下的**子目录**（理由见文件头）。 */
export function translationBackupsDirectory(): string {
  return join(backupsDirectory(), 'translation')
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 算一份 txt 的基指纹。
 *
 * 读结果里带它、保存请求里回传它、写之前再算一次比对 —— **同一处实现**，
 * 免得"读时按一种算法、写时按另一种"（那种分叉只会以"永远冲突"或"永远不冲突"收场）。
 */
export async function fingerprintChapterTranslationFile(
  filePath: string
): Promise<ChapterTranslationFingerprint> {
  const info = await stat(filePath)
  const bytes = await readFile(filePath)
  return {
    size: info.size,
    mtimeMs: info.mtimeMs,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
}

/** 备份文件名里的话名：去掉扩展名、剔掉 Windows 不许的字符；空了就用 `translation`。 */
function safeStem(filePath: string): string {
  const stem = basename(filePath).replace(/\.[^.]+$/, '')
  // 逐字符过滤（不用正则：控制字符区间会踩 no-control-regex，
  // 而这里是"文件名清洗"这种一眼能看懂的规则，写成判断反而更直白）
  const cleaned = [...stem]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      if (code < 0x20 || code === 0x7f) return false
      return !'<>:"/\\|?*'.includes(char)
    })
    .join('')
    .trim()
  return cleaned.slice(0, 80) || 'translation'
}

/**
 * 写前备份：`copyFile`（**按字节拷**，不经过"读成字符串再写回"——
 * 万一文件里有无效 UTF-8 序列，那条路会把备份弄成另一份东西）。
 */
async function backupChapterTranslation(filePath: string): Promise<string> {
  const dir = translationBackupsDirectory()
  await mkdir(dir, { recursive: true })
  const at = Date.now()
  const stem = safeStem(filePath)
  let target = join(dir, `qianzi-translation-${stamp(at)}-${stem}.txt`)
  let suffix = 2
  while (existsSync(target)) {
    target = join(dir, `qianzi-translation-${stamp(at)}-${stem}-${suffix}.txt`)
    suffix += 1
  }
  await copyFile(filePath, target)
  await pruneTranslationBackups()
  return target
}

/** 只保留最近 `TRANSLATION_BACKUP_KEEP` 份（按 mtime 倒序）。返回删掉的名字。 */
async function pruneTranslationBackups(): Promise<string[]> {
  const dir = translationBackupsDirectory()
  if (!existsSync(dir)) return []
  const names = (await readdir(dir)).filter((name) => name.endsWith('.txt'))
  const described: Array<{ path: string; mtimeMs: number }> = []
  for (const name of names) {
    const full = join(dir, name)
    described.push({ path: full, mtimeMs: (await stat(full)).mtimeMs })
  }
  described.sort((left, right) => right.mtimeMs - left.mtimeMs)
  const removed: string[] = []
  for (const item of described.slice(TRANSLATION_BACKUP_KEEP)) {
    await unlink(item.path)
    removed.push(item.path)
  }
  return removed
}

/**
 * 把若干条编辑写回那一份 txt。**不抛异常**：每一种"没写成"都有对应的人话与 `kind`。
 *
 * 返回 `ok: true` 且 `changed: false` = 盘上已经就是要写的内容（跳过写入，不是失败）。
 */
/** 读盘现状（指纹 + 正文）—— 两条写盘路径共用的第 ① 步。 */
async function readCurrentChapterTranslation(
  filePath: string
): Promise<
  | { ok: true; fingerprint: ChapterTranslationFingerprint; text: string }
  | { ok: false; kind: 'io'; message: string }
> {
  try {
    const fingerprint = await fingerprintChapterTranslationFile(filePath)
    const text = await readFile(filePath, 'utf8')
    return { ok: true, fingerprint, text }
  } catch (error) {
    return { ok: false, kind: 'io', message: `读不了这个 txt：${describeError(error)}` }
  }
}

/**
 * **把算好的新文本写回去**（安全网的 ④~⑧ 步）——「改现有条目」与「新增框」**共用这一段**。
 *
 * 为什么必须抽出来：这一段的**顺序就是安全语义**（没变就不写 → 写前备份 → 原子替换 →
 * 写后回读 → 压会话基线）。两条路各抄一遍，早晚有一处漏掉回读或忘了压基线 ——
 * 而那种漏在界面上完全看不出来（只会在真出事那天才发现"备份呢？撤销呢？"）。
 */
async function writeChapterTranslationText(
  filePath: string,
  current: ChapterTranslationFingerprint,
  currentText: string,
  nextText: string,
  prepareEffects?: PrepareChapterTranslationEffects,
  change: { insertedIndex?: number } = {}
): Promise<
  | {
      ok: true
      changed: boolean
      backupPath: string | null
      fingerprint: ChapterTranslationFingerprint
    }
  | { ok: false; kind: 'invalid' | 'io'; message: string }
> {
  // ④ 没变就不写（不 churn mtime、不惊动目录监听）
  if (nextText === currentText) {
    return { ok: true, changed: false, backupPath: null, fingerprint: current }
  }

  // Capture related records before changing the file. A failed snapshot must not write TXT.
  let effects: ChapterTranslationWriteEffects | undefined
  try {
    effects = await prepareEffects?.(change)
  } catch (error) {
    return {
      ok: false,
      kind: 'io',
      message: `校对记录读不出来，所以没有写入：${describeError(error)}`
    }
  }

  // ⑤ 写前备份（失败就不写 —— 没有退路就不动别人的文件）
  let backupPath: string
  try {
    backupPath = await backupChapterTranslation(filePath)
  } catch (error) {
    return { ok: false, kind: 'io', message: `备份失败，所以没有写入：${describeError(error)}` }
  }

  // ⑥ 原子替换
  try {
    await publishOutput(filePath, Buffer.from(nextText, 'utf8'), true)
  } catch (error) {
    return {
      ok: false,
      kind: 'io',
      message: `写入失败，原文件未变：${describeError(error)}（已留备份：${backupPath}）`
    }
  }

  // ⑦ 写后回读
  let after: ChapterTranslationFingerprint
  let afterText: string
  try {
    after = await fingerprintChapterTranslationFile(filePath)
    afterText = await readFile(filePath, 'utf8')
  } catch (error) {
    return {
      ok: false,
      kind: 'io',
      message: `写完读不回来：${describeError(error)}（已留备份：${backupPath}）`
    }
  }
  if (afterText !== nextText) {
    return {
      ok: false,
      kind: 'io',
      message: `写完读回来的内容与预期不一致（已留备份：${backupPath}）`
    }
  }

  // ⑧ 记一层"这次写盘前的原文"（会话内堆栈）——**只有真写成功了才记**：
  //    没写盘就没有"保存"可言，更不该给用户一个可以"退回"的假历史。
  try {
    await effects?.apply?.()
  } catch (error) {
    const rollback = await restoreTextAfterEffectsFailure(filePath, nextText, currentText)
    return {
      ok: false,
      kind: 'io',
      message: `校对记录更新失败：${describeError(error)}。${rollback}（已留备份：${backupPath}）`
    }
  }
  pushSessionBaseline(filePath, currentText, effects?.undo)

  return { ok: true, changed: true, backupPath, fingerprint: after }
}

export async function saveChapterTranslation(
  request: ChapterTranslationSaveRequest,
  prepareEffects?: PrepareChapterTranslationEffects
): Promise<ChapterTranslationSaveResult> {
  const filePath = typeof request?.filePath === 'string' ? request.filePath.trim() : ''
  if (!filePath) return { ok: false, kind: 'io', message: '没有指定要保存的文件' }

  const edits = Array.isArray(request?.edits) ? request.edits : []
  if (edits.length === 0 && !request.credits)
    return { ok: false, kind: 'invalid', message: '没有要改的内容' }

  // ① 盘上现状
  const read = await readCurrentChapterTranslation(filePath)
  if (!read.ok) return read

  // ② 冲突：内容对不上 ⇒ 拒绝写入（判定看 sha256，理由见 shared 的契约注释）
  if (!request.force && read.fingerprint.sha256 !== request.base?.sha256) {
    return {
      ok: false,
      kind: 'conflict',
      message: '这个 txt 在你读进来之后被改过了（可能是 LabelPlusFX 存的），所以没有写入。',
      current: read.fingerprint
    }
  }

  // ③ 该变成什么样（纯函数，自己会拒绝写坏文件的情形）
  const rewritten = edits.length
    ? rewriteChapterTranslationText(read.text, edits)
    : { ok: true as const, text: read.text }
  if (!rewritten.ok) return { ok: false, kind: 'invalid', message: `没有写入：${rewritten.reason}` }

  if (request.credits) {
    try {
      rewritten.text = rewriteTranslationCredits(rewritten.text, request.credits)
    } catch (error) {
      return { ok: false, kind: 'invalid', message: (error as Error).message }
    }
  }
  // ④~⑧ 写回去（与"新增框"共用同一段安全网）
  return await writeChapterTranslationText(
    filePath,
    read.fingerprint,
    read.text,
    rewritten.text,
    prepareEffects
  )
}

/**
 * 「新增框」**有 txt 时**：把一条新条目插进现有那份 txt（第 5 批，2026-10-07）。
 *
 * 安全语义与「保存」**完全一致**（读盘 → 比指纹 → 同一段 ④~⑧），只多做一件事：
 * 把主进程算出来的**新序号**带回给界面（界面据此滚到/高亮那一条）。
 */
export async function insertChapterTranslation(
  request: ChapterTranslationInsertSaveRequest,
  prepareEffects?: PrepareChapterTranslationEffects
): Promise<ChapterTranslationInsertSaveResult> {
  const filePath = typeof request?.filePath === 'string' ? request.filePath.trim() : ''
  if (!filePath) return { ok: false, kind: 'io', message: '没有指定要写入的文件' }
  if (!request?.insert) return { ok: false, kind: 'invalid', message: '没有要新增的内容' }

  // ① 盘上现状
  const read = await readCurrentChapterTranslation(filePath)
  if (!read.ok) return read

  // ② 冲突：读完之后被别处改过 ⇒ 拒绝写入（与保存同一条尺子）
  if (read.fingerprint.sha256 !== request.base?.sha256) {
    return {
      ok: false,
      kind: 'conflict',
      message: '这个 txt 在你读进来之后被改过了（可能是 LabelPlusFX 存的），所以没有新增。',
      current: read.fingerprint
    }
  }

  // ③ 该变成什么样（纯函数；**新序号由它算**，渲染层不传）
  const inserted = insertChapterTranslationEntry(read.text, request.insert)
  if (!inserted.ok) return { ok: false, kind: 'invalid', message: `没有新增：${inserted.reason}` }

  // ④~⑧ 写回去（同一段安全网 ⇒ Ctrl+Z 自动能撤这一步）
  const written = await writeChapterTranslationText(
    filePath,
    read.fingerprint,
    read.text,
    inserted.text,
    prepareEffects,
    { insertedIndex: inserted.insertedIndex }
  )
  if (!written.ok) return written
  return { ...written, insertedIndex: inserted.insertedIndex }
}

/** 从零新建时最多试到 `-N`；再多就请用户自己整理（不无限试名字）。 */
export const MAX_CREATE_FILE_ATTEMPTS = 10

/**
 * 「新增框」**这一话一份能解析的 txt 都没有时**：在话目录里新建一份，并把第一条写进去。
 *
 * ## 这条路与「保存」**不一样**，所以单独写
 *
 * · **没有基指纹可比**（文件还不存在）⇒ 这里没有"冲突"这一档；
 * · **绝不覆盖**：靠 `publishOutput(..., overwrite=false)` 的 link 分支"**创建即判定**"，
 *   目标已存在就换下一个名字（`-2`·`-3`…）—— 不是"先 stat 再写"，没有竞争窗口；
 * · 名字要**洗**：复用 `@shared/file-name` 的 `sanitizeFileNamePart`（与「另存」同一个出处），
 *   话名里带 `?` / `:` 也不会把系统惹毛；
 * · 会话基线压 **`null`**（"之前根本没有这份文件"）⇒ Ctrl+Z 撤这一步 = **把刚建的那份删掉**。
 */
export async function createChapterTranslation(
  request: ChapterTranslationCreateRequest,
  prepareEffects?: PrepareChapterTranslationEffects
): Promise<ChapterTranslationCreateResult> {
  const folderPath = typeof request?.folderPath === 'string' ? request.folderPath.trim() : ''
  if (!folderPath) return { ok: false, kind: 'invalid', message: '没有指定话目录，新建不了译文' }

  const insert = request?.insert
  if (!insert && !request.credits) return { ok: false, kind: 'invalid', message: '没有要新增的内容' }

  // 分组表：这份是我们自己建的 ⇒ 就用这套工具链的默认两组，**组号 = 表序**
  const groups = ['框内', '框外']
  const groupIndex = groups.indexOf(String(insert?.groupName ?? '框内').trim()) + 1
  if (groupIndex <= 0) {
    return {
      ok: false,
      kind: 'invalid',
      message: `分组「${insert?.groupName}」不认识（新建时只认 框内 / 框外）`
    }
  }

  let text = insert ? buildChapterTranslationWithEntry({
    pages: Array.isArray(request?.pages) ? request.pages : [],
    groups,
    imageName: insert.imageName,
    groupIndex,
    position: insert.position,
    text: insert.text
  }) : buildEmptyChapterTranslationText(request.pages, groups)
  if (text === null) {
    return {
      ok: false,
      kind: 'invalid',
      message: '算不出这一话的译文底稿（页表或坐标不对），所以没有新建'
    }
  }

  if (!insert && (!Array.isArray(request.pages) || !request.pages.length || request.pages.some(page => typeof page !== 'string' || /[\r\n]/.test(page)))) return { ok: false, kind: 'invalid', message: '缺少有效的图片页表' }
  if (request.credits) {
    try { text = rewriteTranslationCredits(text, request.credits) }
    catch (error) { return { ok: false, kind: 'invalid', message: describeError(error) } }
  }

  let effects: ChapterTranslationWriteEffects | undefined
  try {
    effects = await prepareEffects?.({ insertedIndex: insert ? 1 : 0 })
  } catch (error) {
    return {
      ok: false,
      kind: 'io',
      message: `校对记录读不出来，所以没有新建：${describeError(error)}`
    }
  }

  const stem = sanitizeFileNamePart(basename(folderPath)) || '译文'

  let target = ''
  for (let attempt = 1; attempt <= MAX_CREATE_FILE_ATTEMPTS; attempt += 1) {
    const candidate = join(folderPath, attempt === 1 ? `${stem}.txt` : `${stem}-${attempt}.txt`)
    let published: boolean
    try {
      published = await publishOutput(candidate, Buffer.from(text, 'utf8'), false)
    } catch (error) {
      return { ok: false, kind: 'io', message: `新建失败：${describeError(error)}` }
    }
    if (published) {
      target = candidate
      break
    }
  }
  if (!target) {
    return {
      ok: false,
      kind: 'invalid',
      message: `同名文件太多了（一直试到 -${MAX_CREATE_FILE_ATTEMPTS} 都被占用），请先整理一下话目录里的 txt`
    }
  }

  // 写后回读：与保存同一条纪律（读完不一致就如实报错，不假装成功）
  let after: ChapterTranslationFingerprint
  let afterText: string
  try {
    after = await fingerprintChapterTranslationFile(target)
    afterText = await readFile(target, 'utf8')
  } catch (error) {
    return { ok: false, kind: 'io', message: `新建后读不回来：${describeError(error)}` }
  }
  if (afterText !== text) {
    return { ok: false, kind: 'io', message: '新建后读回来的内容与预期不一致' }
  }

  // 会话基线压 `null`：**之前根本没有这份文件** ⇒ Ctrl+Z 撤这一步 = 删掉它
  try {
    await effects?.apply?.()
  } catch (error) {
    const rollback = await restoreTextAfterEffectsFailure(target, text, null)
    return {
      ok: false,
      kind: 'io',
      message: `校对记录更新失败：${describeError(error)}。${rollback}`
    }
  }
  pushSessionBaseline(target, null, effects?.undo)

  return {
    ok: true,
    path: target,
    fileName: basename(target),
    insertedIndex: insert ? 1 : 0,
    fingerprint: after
  }
}

/**
 * 「**删除一条译文**」（第 5 批 5e，2026-10-07）—— 写盘那一半。
 *
 * 安全语义与「保存」「新增框」**完全一致**（读盘 → 比指纹 → 同一段 ④~⑧）：
 * 于是 **Ctrl+Z 自动能撤回这次删除**（会话基线已经压了一层），不需要另做撤销。
 *
 * 与它们的分工只在于"新文本怎么算"：这里调
 * {@link deleteChapterTranslationEntry}（删这一条的行区间 + 同图后续序号 -1，一次原子完成）。
 *
 * IPC supplies transactional review effects. They run after TXT verification, and their
 * undo snapshot lives in the same history entry as the text. If applying the effects fails,
 * restore the previous TXT instead of reporting a successful, misaligned deletion.
 */
export async function deleteChapterTranslation(
  request: ChapterTranslationDeleteSaveRequest,
  prepareEffects?: PrepareChapterTranslationEffects
): Promise<ChapterTranslationDeleteSaveResult> {
  const filePath = typeof request?.filePath === 'string' ? request.filePath.trim() : ''
  if (!filePath) return { ok: false, kind: 'io', message: '没有指定要写入的文件' }

  const want = request?.delete
  if (!want || typeof want.imageName !== 'string' || !want.imageName.trim()) {
    return { ok: false, kind: 'invalid', message: '没有指定要删哪一条' }
  }

  // ① 盘上现状
  const read = await readCurrentChapterTranslation(filePath)
  if (!read.ok) return read

  // ② 冲突：读完之后被别处改过 ⇒ 拒绝（与保存 / 新增同一条尺子）
  if (read.fingerprint.sha256 !== request.base?.sha256) {
    return {
      ok: false,
      kind: 'conflict',
      message: '这个 txt 在你读进来之后被改过了（可能是 LabelPlusFX 存的），所以没有删除。',
      current: read.fingerprint
    }
  }

  // ③ 该变成什么样（纯函数；找不到那一条会自己拒绝）
  const removed = deleteChapterTranslationEntry(read.text, want)
  if (!removed.ok) return { ok: false, kind: 'invalid', message: `没有删除：${removed.reason}` }

  // ④~⑧ 写回去（与"保存 / 新增框"共用同一段安全网 ⇒ Ctrl+Z 能撤这一步）
  const written = await writeChapterTranslationText(
    filePath,
    read.fingerprint,
    read.text,
    removed.text,
    prepareEffects
  )
  if (!written.ok) return written

  return {
    ...written,
    deletedIndex: removed.deletedIndex,
    renumbered: removed.renumbered
  }
}

/**
 * **回退最近一次保存**（2026-10-07）—— 把这份 txt 写回"本会话内上一次保存之前"的样子。
 *
 * ## 它和"保存"的唯一区别：要写回去的那份内容从哪来
 *
 * 保存：内容由纯函数 `chapter-translation-rewrite` 按 edits 现算；
 * 回退：内容直接取自 {@link sessionTranslationBaselines} 的**栈顶**（就是上次保存前的原文）。
 * 其余步骤**一字不差地照抄保存那条链**：算指纹 → 比指纹（冲突拒绝）→ 写前备份 →
 * 原子替换 → 写后回读。
 *
 * ## 三条边界
 *
 * 1. **只认内存栈**：磁盘上那串备份**不算数**（理由见 {@link sessionTranslationBaselines}）
 *    ⇒ 重启后本函数必然报"没有可回退的"，哪怕备份文件还躺在磁盘上。
 * 2. **冲突拒绝、绝不强写**：读完之后被别处改过就**不写**（没有"强制回退"这个选项）——
 *    覆盖别人在 LabelPlusFX 里的改动，比"误操作"更糟。
 * 3. **失败不消耗历史**：只有真的退成功了才弹掉栈顶那层，否则用户重试还有机会。
 */
export async function undoChapterTranslation(
  request: ChapterTranslationUndoRequest
): Promise<ChapterTranslationUndoResult> {
  const filePath = typeof request?.filePath === 'string' ? request.filePath.trim() : ''
  if (!filePath) return { ok: false, kind: 'invalid', message: '没有指定要回退的文件' }

  // ① 本会话的堆栈（**只认内存**；换话则先把上一话的历史整份丢掉）
  ensureSessionFile(filePath)
  const stack = sessionTranslationBaselines.get(filePath)
  if (!stack || stack.length === 0) {
    return { ok: false, kind: 'invalid', message: '本会话还没有可回退的保存。' }
  }

  // ② 盘上现状
  let current: ChapterTranslationFingerprint
  let currentText: string
  try {
    current = await fingerprintChapterTranslationFile(filePath)
    currentText = await readFile(filePath, 'utf8')
  } catch (error) {
    return { ok: false, kind: 'io', message: `读不了这个 txt：${describeError(error)}` }
  }

  // ③ 冲突：读完之后被别处改过 ⇒ 拒绝（判定只看 sha256，与保存同一条尺子）
  if (current.sha256 !== request.base?.sha256) {
    return {
      ok: false,
      kind: 'conflict',
      message: '这个 txt 在你读进来之后被改过了（可能是 LabelPlusFX 存的），所以没有回退。',
      current
    }
  }

  // ④ 栈顶 = 要退回去的那一版（`null` = **之前根本没有这份文件**）
  const baseline = stack[stack.length - 1]
  const target = baseline.text

  // ⑤ "从零新建"那一步的回退 = **把刚建出来的那份删掉**（第 5 批）
  if (target === null) {
    try {
      await unlink(filePath)
    } catch (error) {
      return { ok: false, kind: 'io', message: `删不掉刚新建的那份译文：${describeError(error)}` }
    }
    const effectsError = await undoRelatedState(filePath, baseline, currentText, null)
    if (effectsError) return effectsError
    popSessionBaseline(filePath)
    return {
      ok: true,
      changed: true,
      deleted: true,
      // 删文件这条路没有"写前备份"（要备份的那份本来就还没进过备份池）
      backupPath: null,
      // 文件已经删了，没有"删完之后的指纹"可言 —— 给回的是**删之前那份**的指纹（调用方会重读）
      fingerprint: current
    }
  }

  // ⑥ 盘上已经就是那一版 ⇒ 不写（不 churn mtime），但历史照样消耗掉这一层
  if (target === currentText) {
    const effectsError = await undoRelatedState(filePath, baseline, currentText, target)
    if (effectsError) return effectsError
    popSessionBaseline(filePath)
    return { ok: true, changed: false, backupPath: null, fingerprint: current }
  }

  // ⑦ 写前备份 —— "回退前"的**返程票**（万一退错了，这份还能把它换回来）
  let backupPath: string
  try {
    backupPath = await backupChapterTranslation(filePath)
  } catch (error) {
    return { ok: false, kind: 'io', message: `备份失败，所以没有回退：${describeError(error)}` }
  }

  // ⑧ 原子替换
  try {
    await publishOutput(filePath, Buffer.from(target, 'utf8'), true)
  } catch (error) {
    return {
      ok: false,
      kind: 'io',
      message: `回退失败，原文件未变：${describeError(error)}（已留备份：${backupPath}）`
    }
  }

  // ⑨ 写后回读
  let after: ChapterTranslationFingerprint
  let afterText: string
  try {
    after = await fingerprintChapterTranslationFile(filePath)
    afterText = await readFile(filePath, 'utf8')
  } catch (error) {
    return {
      ok: false,
      kind: 'io',
      message: `回退后读不回来：${describeError(error)}（已留备份：${backupPath}）`
    }
  }
  if (afterText !== target) {
    return {
      ok: false,
      kind: 'io',
      message: `回退后读回来的内容与预期不一致（已留备份：${backupPath}）`
    }
  }

  // File and review restoration must both succeed before consuming history.
  const effectsError = await undoRelatedState(filePath, baseline, currentText, target)
  if (effectsError) return effectsError
  // ⑩ **真退成功了**才弹掉这一层
  popSessionBaseline(filePath)

  return { ok: true, changed: true, backupPath, fingerprint: after }
}

/** Compensate a failed database step without overwriting a later external file edit. */
async function restoreTextAfterEffectsFailure(
  filePath: string,
  expectedText: string | null,
  previousText: string | null
): Promise<string> {
  try {
    if (expectedText === null) {
      if (existsSync(filePath)) throw new Error('txt 已被重新创建')
    } else if ((await readFile(filePath, 'utf8')) !== expectedText) {
      throw new Error('txt 已被其他程序改动')
    }
    if (previousText === null) {
      await unlink(filePath)
    } else {
      const published = await publishOutput(
        filePath,
        Buffer.from(previousText, 'utf8'),
        expectedText !== null
      )
      if (!published || (await readFile(filePath, 'utf8')) !== previousText) {
        throw new Error('恢复后回读不一致')
      }
    }
    return 'txt 已恢复到操作前的内容'
  } catch (error) {
    return `txt 自动恢复失败，请从备份恢复后重试：${describeError(error)}`
  }
}

async function undoRelatedState(
  filePath: string,
  baseline: SessionTranslationBaseline,
  previousText: string,
  target: string | null
): Promise<{ ok: false; kind: 'io'; message: string } | null> {
  try {
    await baseline.undoEffects?.()
    return null
  } catch (error) {
    const rollback = await restoreTextAfterEffectsFailure(filePath, target, previousText)
    return {
      ok: false,
      kind: 'io',
      message: `校对记录回退失败：${describeError(error)}。${rollback}；回退历史仍保留。`
    }
  }
}
