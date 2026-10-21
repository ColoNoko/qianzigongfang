/**
 * 原地改行 writer（P2-a，2026-10-06）—— **纯函数**，不碰文件系统。
 *
 * ## 它承诺什么
 *
 * **除被改的那几行，文件其余部分逐字节不变。** 这是靠"只替换目标行区间、其余行原样拼回"
 * 做到的（不是"重新生成一份再祈祷格式一样"）。所以真实文件里那些 parser **根本不解析**的
 * 头部内容（`翻译：たかね` / `校对：浅夢`）、BOM、4 位小数、条目之间的空行、
 * 结尾换行 —— 全都自动保住，不需要逐项对齐。
 *
 * ## 为什么它不在 `shared/`
 *
 * 它要用 `labelplus-parser` 的**同一次扫描**来定位"哪一行是哪一条"。
 * 把定位规则抽到 shared 就得连扫描器一起搬；两处各写一份扫描，一旦分叉就会**改错行**。
 * 所以它留在 main 侧、紧挨 parser，并在文件头写明这条依赖。真正的 IPC 契约类型在
 * `@shared/chapter-translation`。
 *
 * ## 边界（拒绝清单见用例）
 *
 * · 换行符混用 / 单独 CR ⇒ 拒绝（不敢猜哪一种是"对的"）
 * · 坐标串少于三段 ⇒ 拒绝（形状不认识就不动）
 * · 译文里出现"看起来像文件结构"的整行 ⇒ 拒绝（否则会把结构写坏）
 * · 找不到那一条 / 同一条被写两遍 / 坐标越界 / 分组名不在表里 ⇒ 拒绝
 * · 一律**整份拒绝**：不做"改一半"（宁可一个字节都不写）
 */
import {
  MIN_POSITION_DECIMALS,
  serializeChapterTranslationLabel,
  type ChapterTranslationDeleteRequest,
  type ChapterTranslationDeleteResult,
  type ChapterTranslationEdit,
  type ChapterTranslationInsertRequest,
  type ChapterTranslationInsertResult
} from '@shared/chapter-translation'
import {
  parseLabelPlusTextWithSpans,
  matchLabelPlusFileHeader,
  matchLabelPlusLabelHeader,
  type LabelPlusTextSpan
} from './labelplus-parser'

/**
 * ⚠️ 坐标小数位与"标签头长什么样"这两条规则**都在 `@shared/chapter-translation` 里**：
 * 那边是"新增框 / 从零新建"共用的序列化出处，这里只是**用**它（`formatCoordinate` 用同一个
 * 小数位下限，新条目用同一个 {@link serializeChapterTranslationLabel}）。别在本文件再定义一份。
 */

export type ChapterTranslationRewriteResult =
  { ok: true; text: string; applied: number } | { ok: false; reason: string }

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason }
}

/** `\r\n` / 单独 `\n` / 单独 `\r` 的分布，决定"这份文件能不能安全地按行改"。 */
function detectLineEnding(body: string): { eol: string } | { reason: string } {
  const hasCrlf = /\r\n/.test(body)
  const hasLoneLf = /(?<!\r)\n/.test(body)
  const hasLoneCr = /\r(?!\n)/.test(body)

  if (hasLoneCr) return { reason: '这个 txt 里有单独的 CR 换行（不是 CRLF），不敢改' }
  if (hasCrlf && hasLoneLf) {
    return { reason: '这个 txt 的换行符不统一（既有 CRLF 又有 LF），不敢改' }
  }
  return { eol: hasCrlf ? '\r\n' : '\n' }
}

/** 小数位沿用原本的；不足 {@link MIN_POSITION_DECIMALS} 位时补足（不丢精度）。 */
function formatCoordinate(originalToken: string, value: number): string {
  const trimmed = originalToken.trim()
  const dot = trimmed.indexOf('.')
  const originalDecimals = dot >= 0 ? trimmed.length - dot - 1 : 0
  return value.toFixed(Math.max(originalDecimals, MIN_POSITION_DECIMALS))
}

/**
 * 只重排坐标串里的前三段（x / y / 分组号），**分隔符与多余字段原样留着**。
 * 少于三段 ⇒ `null`（形状不认识就不动）。
 */
function rebuildHeaderValues(
  values: string,
  patch: { x?: number; y?: number; groupIndex?: number }
): string | null {
  const tokens = values.split(',')
  if (tokens.length < 3) return null
  return tokens
    .map((token, index) => {
      // 保留每段前面的空白 —— 别人文件里写的是 `0.1, 0.2, 1`，我们就别顺手"规范化"成无空格。
      const leading = /^\s*/.exec(token)?.[0] ?? ''
      if (index === 0 && patch.x !== undefined) return leading + formatCoordinate(token, patch.x)
      if (index === 1 && patch.y !== undefined) return leading + formatCoordinate(token, patch.y)
      if (index === 2 && patch.groupIndex !== undefined) return leading + String(patch.groupIndex)
      return token
    })
    .join(',')
}

/** 把标签头的**最后一段方括号**换掉，其余（短横线、序号、行尾空白）原样。 */
function rebuildHeaderLine(line: string, values: string): string | null {
  const match = /^(.*\[)([^\]]*)(\]\s*)$/.exec(line)
  if (!match) return null
  return match[1] + values + match[3]
}

/** 译文里**不许**出现"独占一行、看起来像文件结构"的行 —— 否则会被读成新条目/新图片。 */
function guardTextShape(text: string): string | null {
  const normalized = text.replace(/\r\n?/g, '\n')
  for (const line of normalized.split('\n')) {
    if (matchLabelPlusFileHeader(line) !== null || matchLabelPlusLabelHeader(line) !== null) {
      return '译文里有独占一行、看起来像文件结构的行（>>>>>>… 或 ------…），会被读成新条目'
    }
  }
  return null
}

interface LineOperation {
  /** 0 基、左闭 */
  from: number
  /** 0 基、右开 */
  to: number
  lines: string[]
}

function keyOf(imageName: string, labelIndex: number): string {
  return `${String(imageName).trim().toLocaleLowerCase()}\u0000${labelIndex}`
}

/**
 * 只改这几条、其余字节原样搬运。返回**新的整份文本**（含原样的 BOM 与换行风格）。
 *
 * 调用方（写回服务）负责：读文件、比对基指纹、备份、原子替换、写后回读。
 * 这里只回答"文件内容该变成什么样"，答不了就 `ok: false` + 一句人话。
 */
export function rewriteChapterTranslationText(
  raw: string,
  edits: readonly ChapterTranslationEdit[]
): ChapterTranslationRewriteResult {
  if (!Array.isArray(edits) || edits.length === 0) return fail('没有要改的内容')

  const seen = new Set<string>()
  for (const item of edits) {
    const key = keyOf(item.imageName, item.labelIndex)
    if (seen.has(key)) {
      return fail(`同一条（${item.imageName} 第 ${item.labelIndex} 条）被写了两遍，不猜谁赢`)
    }
    seen.add(key)
    if (item.text === undefined && item.position === undefined && item.groupName === undefined) {
      return fail(`第 ${item.labelIndex} 条没有任何要改的字段`)
    }
  }

  const bom = raw.startsWith('\uFEFF')
  const body = bom ? raw.slice(1) : raw
  const ending = detectLineEnding(body)
  if ('reason' in ending) return fail(ending.reason)

  let parsed: ReturnType<typeof parseLabelPlusTextWithSpans>
  try {
    parsed = parseLabelPlusTextWithSpans(raw)
  } catch (error) {
    return fail(
      `这个 txt 解析不了，不敢改：${error instanceof Error ? error.message : String(error)}`
    )
  }

  const lines = body.split(ending.eol)
  const operations: LineOperation[] = []

  for (const item of edits) {
    const span = parsed.spans.find(
      (candidate) =>
        String(candidate.imageName).trim().toLocaleLowerCase() ===
          String(item.imageName).trim().toLocaleLowerCase() &&
        candidate.labelIndex === item.labelIndex
    )
    if (!span) {
      return fail(`找不到要改的那一条：${item.imageName} 第 ${item.labelIndex} 条`)
    }

    if (item.position) {
      const { x, y } = item.position
      const valid = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1
      if (!valid) {
        return fail(`${item.imageName} 第 ${item.labelIndex} 条的坐标超出 0..1 范围，拒绝写入`)
      }
    }

    let groupIndex: number | undefined
    if (item.groupName !== undefined) {
      const wanted = String(item.groupName).trim()
      const found = parsed.headerGroups.findIndex((name) => name.trim() === wanted)
      if (found < 0) {
        return fail(`分组「${wanted}」不在这个 txt 的分组表里（不新建分组）`)
      }
      groupIndex = found + 1
    }

    // ① 标签头那一行（改坐标 / 改分组时才动）
    if (item.position || groupIndex !== undefined) {
      const headerIndex = span.headerLine - 1
      const values = rebuildHeaderValues(
        matchLabelPlusLabelHeader(lines[headerIndex])?.values ?? '',
        { x: item.position?.x, y: item.position?.y, groupIndex }
      )
      if (values === null) {
        return fail(
          `${item.imageName} 第 ${item.labelIndex} 条的坐标不是「x,y,分组」三段，超出本版能安全改写的形状`
        )
      }
      const rebuilt = rebuildHeaderLine(lines[headerIndex], values)
      if (rebuilt === null) {
        return fail(`${item.imageName} 第 ${item.labelIndex} 条的标签头认不出来，拒绝改写`)
      }
      operations.push({ from: headerIndex, to: span.headerLine, lines: [rebuilt] })
    }

    // ② 文本内容那几行（空译文时"插在标签头后面"）
    if (item.text !== undefined) {
      const shape = guardTextShape(item.text)
      if (shape) return fail(shape)
      const nextLines = item.text.replace(/\r\n?/g, '\n').split('\n')
      // 空文本 ⇒ 一条内容行都不留
      const payload = nextLines.length === 1 && nextLines[0] === '' ? [] : nextLines
      const from = span.contentStartLine === 0 ? span.headerLine : span.contentStartLine - 1
      const to = span.contentEndLine === 0 ? span.headerLine : span.contentEndLine
      operations.push({ from, to, lines: payload })
    }
  }

  operations.sort((left, right) => left.from - right.from)
  const stitched: string[] = []
  let cursor = 0
  for (const operation of operations) {
    if (operation.from < cursor) return fail('要改的行区间互相重叠，拒绝写入')
    stitched.push(...lines.slice(cursor, operation.from), ...operation.lines)
    cursor = operation.to
  }
  stitched.push(...lines.slice(cursor))

  return {
    ok: true,
    text: (bom ? '\uFEFF' : '') + stitched.join(ending.eol),
    applied: edits.length
  }
}

/**
 * 「新增框」（第 5 批，2026-10-07）—— 在某个图片块**末尾**插入一条新译文。
 *
 * ## 与"改"的分工
 *
 * · 改（`rewriteChapterTranslationText`）= 找到那一条、替换它的行；
 * · 插（本函数）= 找到那张图、在它末尾**推几行**。
 *
 * 相同的承诺：**除插进去的那几行，文件其余部分逐字节不变** —— 靠的还是"只拼回、不重排"，
 * 所以头部 credits、BOM、换行风格、条目间的空行全都自动保住。
 *
 * ## 新序号由这里算，渲染层不传
 *
 * 序号 = 该图已有条目里最大的序号 +1；空图块从 1 起。渲染层手上的清单可能过期，
 * 传了就会撞号 —— 与"主进程不信任载荷"同一条纪律。算出来的序号随结果还给渲染层。
 */
export function insertChapterTranslationEntry(
  raw: string,
  request: ChapterTranslationInsertRequest
): ChapterTranslationInsertResult {
  const imageName = typeof request?.imageName === 'string' ? request.imageName.trim() : ''
  if (!imageName) return fail('没有指定要插到哪张图')

  const position = request?.position
  const validPosition =
    position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    position.x >= 0 &&
    position.x <= 1 &&
    position.y >= 0 &&
    position.y <= 1
  if (!validPosition) return fail('新条目的坐标超出 0..1 范围，拒绝写入')

  if (request?.text !== undefined) {
    const shape = guardTextShape(request.text)
    if (shape) return fail(shape)
  }

  const bom = raw.startsWith('\uFEFF')
  const body = bom ? raw.slice(1) : raw
  const ending = detectLineEnding(body)
  if ('reason' in ending) return fail(ending.reason)

  let parsed: ReturnType<typeof parseLabelPlusTextWithSpans>
  try {
    parsed = parseLabelPlusTextWithSpans(raw)
  } catch (error) {
    return fail(
      `这个 txt 解析不了，不敢插：${error instanceof Error ? error.message : String(error)}`
    )
  }

  // 分组名 → 组号（1 基；不在表里就整份拒绝，不新建分组）
  const wantedGroup = String(request?.groupName ?? '').trim()
  const groupIndex = parsed.headerGroups.findIndex((name) => name.trim() === wantedGroup) + 1
  if (groupIndex <= 0) {
    return fail(`分组「${wantedGroup}」不在这个 txt 的分组表里（不新建分组）`)
  }

  const lines = body.split(ending.eol)
  const imageKey = imageName.toLocaleLowerCase()

  // ① 找到这张图的图片标题行（0 基）
  let blockStart = -1
  for (let index = 0; index < lines.length; index += 1) {
    const name = matchLabelPlusFileHeader(lines[index])
    if (name !== null && name.trim().toLocaleLowerCase() === imageKey) {
      blockStart = index
      break
    }
  }
  if (blockStart < 0) return fail(`找不到这张图：${imageName}（不猜、不新建图片块）`)

  // ② 该图已有的那些条目：决定"插到哪"与"新序号"
  const ownSpans = parsed.spans.filter(
    (span) => span.imageName.trim().toLocaleLowerCase() === imageKey
  )

  let cursor: number
  let nextIndex: number
  if (ownSpans.length === 0) {
    // 空图块：插在图片标题行之后
    cursor = blockStart + 1
    nextIndex = 1
  } else {
    let last: LabelPlusTextSpan = ownSpans[0]
    for (const span of ownSpans) {
      if (span.headerLine > last.headerLine) last = span
    }
    // "这条译文之后"的 0 基右开游标 —— 与 `rewriteChapterTranslationText` 同一套行号约定
    cursor = last.contentEndLine === 0 ? last.headerLine : last.contentEndLine
    nextIndex = Math.max(...ownSpans.map((span) => span.labelIndex)) + 1
  }

  // ③ 新标签头 + 内容行 —— **格式走共享层那一处实现**（与"从零新建"同一份，别在这里再写一遍）
  const newLines = serializeChapterTranslationLabel({
    index: nextIndex,
    groupIndex,
    position,
    text: request?.text
  })

  const stitched = [...lines.slice(0, cursor), ...newLines, ...lines.slice(cursor)]

  return {
    ok: true,
    text: (bom ? '\uFEFF' : '') + stitched.join(ending.eol),
    insertedIndex: nextIndex
  }
}

/**
 * 把一条标签头里的**序号**换掉，**其余一个字节都不动**（第 5 批 5e）。
 *
 * 为什么不能用 `serializeChapterTranslationLabel` 重新拼一行：它会拿参数把整行重写一遍
 * （短横线的个数、坐标串里**多余的那些字段**、两边的空白都会跟着我的实现走）。
 * 而"删一条之后只是序号变了"这件事，**不该顺手规范化别人的文件** ——
 * 与 `formatCoordinate` 那条"沿用原本的小数位"同一个道理。
 *
 * 认不出形状就返回 `null`（调用方据此**整份拒绝**，不猜）。
 */
function replaceLabelHeaderIndex(line: string, nextIndex: number): string | null {
  const matched = matchLabelPlusLabelHeader(line)
  if (matched === null) return null
  // 只换 `[序号]` 那一段：短横线与后面的 `[x,y,组号]` 原样搬回
  const head = line.indexOf(`[${matched.index}]`)
  if (head < 0) return null
  const start = head + 1
  const end = start + String(matched.index).length
  if (line.slice(start, end) !== String(matched.index)) return null
  return `${line.slice(0, start)}${nextIndex}${line.slice(end)}`
}

/**
 * 「**删除一条译文**」（第 5 批 5e，2026-10-07）—— 用户拍板定稿的删除口径。
 *
 * ## 三件事，一次做完
 *
 * 1. **删掉这一条自己的行区间**：`headerLine..contentEndLine`（标签头 + 内容行）。
 *    **分隔空行原样留着**（Q5=A：空行是文件版式，不归删除动作管）——
 *    于是"其余字节逐字节不变"这条承重墙照旧成立。
 * 2. **同图后续条目序号 -1**：只换标签头里那一个数字，**其余字节不动**
 *    （见 {@link replaceLabelHeaderIndex}：不重新拼行，免得顺手把坐标串、空白"规范化"了）。
 * 3. 把 `renumbered`（被 -1 的那些原序号）还给上层 —— 界面要拿它把"按序号存的草稿改动"跟着挪，
 *    否则删第 3 条之后，草稿里第 4 条的改动会落到**另一句话**上。
 *
 * ## 拒绝（整份，不写一个字节）
 *
 * · 找不到这张图 · 这张图里没有这一条 · 这一条的标签头认不出形状
 *   · 换行符混用 / 单独 CR（与"改 / 插"同一套判据，走同一个 `detectLineEnding`）
 *
 * ⚠️ 没有"删最后一条就把图片块也删掉"这回事：图片块（`>>>>>>>>[图名]<<<<<<<<`）**保留**
 * （用户拍板），所以"删到空图块"是允许的中间状态，这里不做额外处理。
 */
export function deleteChapterTranslationEntry(
  raw: string,
  request: ChapterTranslationDeleteRequest
): ChapterTranslationDeleteResult {
  const imageName = typeof request?.imageName === 'string' ? request.imageName.trim() : ''
  if (!imageName) return fail('没有指定要删哪张图里的条目')

  const wantedIndex = Math.trunc(Number(request?.labelIndex))
  if (!Number.isFinite(wantedIndex) || wantedIndex <= 0) {
    return fail('要删的条目序号不合法')
  }

  const bom = raw.startsWith('\uFEFF')
  const body = bom ? raw.slice(1) : raw
  const ending = detectLineEnding(body)
  if ('reason' in ending) return fail(ending.reason)

  let parsed: ReturnType<typeof parseLabelPlusTextWithSpans>
  try {
    parsed = parseLabelPlusTextWithSpans(raw)
  } catch (error) {
    return fail(
      `这个 txt 解析不了，不敢删：${error instanceof Error ? error.message : String(error)}`
    )
  }

  const lines = body.split(ending.eol)
  const imageKey = imageName.toLocaleLowerCase()
  const ownSpans = parsed.spans.filter(
    (span) => span.imageName.trim().toLocaleLowerCase() === imageKey
  )
  if (ownSpans.length === 0) return fail(`这张图里没有可删的条目：${imageName}`)

  const target = ownSpans.find((span) => span.labelIndex === wantedIndex)
  if (!target) return fail(`这张图里没有第 ${wantedIndex} 条（不猜、不删别条）`)

  // 标签头认不出形状 ⇒ 整份拒绝（宁可不动，也不猜哪一段是序号）
  const headerRaw = lines[target.headerLine - 1]
  if (typeof headerRaw !== 'string' || matchLabelPlusLabelHeader(headerRaw) === null) {
    return fail(`第 ${wantedIndex} 条的标签头认不出来，拒绝删除`)
  }

  const operations: LineOperation[] = []
  // ① 删这一条：标签头 .. 内容行（空译文 ⇒ 只删标签头那一行）
  operations.push({
    from: target.headerLine - 1,
    to: target.contentEndLine === 0 ? target.headerLine : target.contentEndLine,
    lines: []
  })

  // ② 同图后续条目：序号 -1（只换那个数字）
  const renumbered: number[] = []
  for (const span of ownSpans) {
    if (span.labelIndex <= wantedIndex) continue
    const original = lines[span.headerLine - 1]
    const rebuilt = typeof original === 'string' ? replaceLabelHeaderIndex(original, span.labelIndex - 1) : null
    if (rebuilt === null) return fail(`第 ${span.labelIndex} 条的标签头认不出来，拒绝重排序号`)
    operations.push({ from: span.headerLine - 1, to: span.headerLine, lines: [rebuilt] })
    renumbered.push(span.labelIndex)
  }
  renumbered.sort((left, right) => left - right)

  // ③ 拼回（与"改 / 插"共用同一段：按区间顺序推、重叠就整份拒绝）
  operations.sort((left, right) => left.from - right.from)
  const stitched: string[] = []
  let cursor = 0
  for (const operation of operations) {
    if (operation.from < cursor) return fail('要删/要改的行区间互相重叠，拒绝写入')
    stitched.push(...lines.slice(cursor, operation.from), ...operation.lines)
    cursor = operation.to
  }
  stitched.push(...lines.slice(cursor))

  return {
    ok: true,
    text: (bom ? '\uFEFF' : '') + stitched.join(ending.eol),
    deletedIndex: wantedIndex,
    renumbered
  }
}
