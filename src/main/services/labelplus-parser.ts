import { readTranslationCredits } from '../../shared/translation-credits'
import { matchLabelPlusFileHeader } from '../../shared/labelplus-format'
export { matchLabelPlusFileHeader } from '../../shared/labelplus-format'
import type { ChapterTranslationFingerprint } from '@shared/chapter-translation'
import { readChapterTranslationSnapshot } from './chapter-translation-snapshot'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type {
  LabelPlusDocument,
  LabelPlusImageEntry,
  LabelPlusLabel,
  NormalizedTextPosition
} from '@shared/labelplus-import'

const MAX_LABELPLUS_FILE_BYTES = 64 * 1024 * 1024
const MAX_IMAGE_COUNT = 20_000
const MAX_LABEL_COUNT = 250_000
const LABEL_HEADER = /^\s*-{6,}\[(.*?)\]-{6,}\[([^\]]+)\]\s*$/

/** 认"标签头"，取出序号与坐标串。序号认不出时为 `0`（调用方回退成"第几条"）。 */
export function matchLabelPlusLabelHeader(line: string): { index: number; values: string } | null {
  const match = LABEL_HEADER.exec(line)
  if (!match) return null
  return { index: Number.parseInt(match[1], 10) || 0, values: match[2] }
}

/**
 * 一条译文在**文件里**占哪几行（1 基，针对**规范化后**的文本：去 BOM、CRLF/CR 统一成 LF）。
 *
 * · `headerLine`       —— 标签头那一行
 * · `contentStartLine` —— 文本内容区第一行（**只算有内容的行**；空译文时为 `0`）
 * · `contentEndLine`   —— 文本内容区最后一行（同上）
 *
 * 首尾的**空行不算内容区**：真实文件里它是条目之间的分隔，回写时原样留着。
 * 中间的**空行算内容**（多段译文不能被切掉）。
 *
 * 为什么需要它：P2 的写回是**原地改行**，只替换被改条目所占的这几行，
 * 文件其余字节原样搬运 —— 所以必须知道"改哪一行"，而不是从模型重新拼一份文件。
 */
export interface LabelPlusTextSpan {
  imageName: string
  labelIndex: number
  headerLine: number
  contentStartLine: number
  contentEndLine: number
}

export class LabelPlusParseError extends Error {
  readonly line?: number

  constructor(message: string, line?: number) {
    super(line ? `第 ${line} 行：${message}` : message)
    this.name = 'LabelPlusParseError'
    this.line = line
  }
}

function normalizedPosition(
  x: unknown,
  y: unknown,
  context: string,
  width?: unknown,
  height?: unknown
): NormalizedTextPosition {
  const parsedX = typeof x === 'number' ? x : Number(String(x).trim())
  const parsedY = typeof y === 'number' ? y : Number(String(y).trim())
  if (!Number.isFinite(parsedX) || !Number.isFinite(parsedY)) {
    throw new LabelPlusParseError(`${context} 的坐标无效`)
  }
  if (parsedX < -10 || parsedX > 10 || parsedY < -10 || parsedY > 10) {
    throw new LabelPlusParseError(`${context} 的坐标超出合理范围`)
  }
  const result: NormalizedTextPosition = { unit: 'normalized', x: parsedX, y: parsedY }
  for (const [key, value] of [
    ['width', width],
    ['height', height]
  ] as const) {
    if (value === undefined || value === null || value === '') continue
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
      throw new LabelPlusParseError(`${context} 的${key}无效`)
    }
    result[key] = parsed
  }
  return result
}

function addUnique(target: string[], value: string): void {
  const normalized = value.trim()
  if (normalized && !target.includes(normalized)) target.push(normalized)
}

function documentWarnings(images: LabelPlusImageEntry[]): string[] {
  const warnings: string[] = []
  for (const image of images) {
    for (const label of image.labels) {
      if (
        label.position.x < 0 ||
        label.position.x > 1 ||
        label.position.y < 0 ||
        label.position.y > 1
      ) {
        warnings.push(`${image.fileName} 的第 ${label.index} 条文字位于画布范围外`)
      }
    }
  }
  return warnings
}

function assertDocumentLimits(images: LabelPlusImageEntry[]): void {
  if (images.length > MAX_IMAGE_COUNT) {
    throw new LabelPlusParseError(`图片数量超过限制（${MAX_IMAGE_COUNT}）`)
  }
  const labelCount = images.reduce((sum, image) => sum + image.labels.length, 0)
  if (labelCount > MAX_LABEL_COUNT) {
    throw new LabelPlusParseError(`文本条目超过限制（${MAX_LABEL_COUNT}）`)
  }
}

function parseJsonDocument(content: string, sourcePath: string): LabelPlusDocument {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (error) {
    throw new LabelPlusParseError(
      `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!raw || typeof raw !== 'object') throw new LabelPlusParseError('JSON 根节点必须为对象')

  const record = raw as Record<string, unknown>
  const groups = Array.isArray(record.groups)
    ? record.groups
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
    : []
  const imagesRecord = record.images
  if (!imagesRecord || typeof imagesRecord !== 'object' || Array.isArray(imagesRecord)) {
    throw new LabelPlusParseError('JSON 缺少 images 对象')
  }

  const images: LabelPlusImageEntry[] = []
  for (const [fileName, rawLabels] of Object.entries(imagesRecord as Record<string, unknown>)) {
    if (!Array.isArray(rawLabels)) throw new LabelPlusParseError(`${fileName} 的标签列表无效`)
    const labels: LabelPlusLabel[] = rawLabels.map((rawLabel, index) => {
      if (!rawLabel || typeof rawLabel !== 'object') {
        throw new LabelPlusParseError(`${fileName} 的第 ${index + 1} 条标签无效`)
      }
      const label = rawLabel as Record<string, unknown>
      const group = typeof label.group === 'string' ? label.group.trim() : ''
      if (!group) throw new LabelPlusParseError(`${fileName} 的第 ${index + 1} 条标签缺少分组`)
      addUnique(groups, group)
      return {
        index: index + 1,
        group,
        text: typeof label.contents === 'string' ? label.contents : String(label.contents ?? ''),
        position: normalizedPosition(
          label.x,
          label.y,
          `${fileName} 第 ${index + 1} 条标签`,
          label.width,
          label.height
        )
      }
    })
    images.push({ fileName: fileName.trim(), labels })
  }

  if (images.length === 0) throw new LabelPlusParseError('JSON 中没有图片记录')
  if (groups.length === 0) groups.push('默认')
  assertDocumentLimits(images)

  return {
    sourcePath,
    version: { first: 1, last: 0 },
    groups,
    images,
    warnings: documentWarnings(images)
  }
}

interface PendingLabel {
  line: number
  index: number
  groupIndex: number
  position: NormalizedTextPosition
  lines: string[]
  /** 内容区第一行（`0` = 这一条还没有非空行，即空译文） */
  firstContentLine: number
  /** 内容区最后一行（`0` = 同上） */
  lastContentLine: number
}

interface LabelPlusTextParseResult {
  document: LabelPlusDocument
  spans: LabelPlusTextSpan[]
  /**
   * **头部那张分组表**（两条 `-` 之间）里的名字，按下标即分组编号（第 1 个 = 编号 1）。
   *
   * ⚠️ 与 `document.groups` **不是一回事**：后者会被"标签里实际用到的分组名"追加
   * （认不出编号时还会补一个 `分组 N` 回退名）。写回服务**只认这一份** —— 否则
   * 用 `document.groups` 反查编号，遇到 `分组 5` 这类回退名会算出错误的编号。
   */
  headerGroups: string[]
}

function parseTextDocumentWithSpans(content: string, sourcePath: string): LabelPlusTextParseResult {
  const lines = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const firstFileLine = lines.findIndex((line) => matchLabelPlusFileHeader(line) !== null)
  if (firstFileLine < 0) throw new LabelPlusParseError('没有找到图片标题行')

  const headerLines = lines.slice(0, firstFileLine)
  const versionLine = headerLines.find((line) => /^\s*\d+\s*,\s*\d+\s*$/.test(line))
  const versionParts = versionLine?.split(',').map((part) => Number.parseInt(part.trim(), 10)) ?? [
    1, 0
  ]
  const separators = headerLines
    .map((line, index) => (line.trim() === '-' ? index : -1))
    .filter((index) => index >= 0)
  const groups: string[] = []
  if (separators.length >= 2) {
    for (const line of headerLines.slice(separators[0] + 1, separators[1])) addUnique(groups, line)
  }
  if (groups.length === 0) groups.push('默认')
  // 头部那张表的**快照**：下面的循环会把"标签里实际用到的分组名"也追加进 groups，
  // 之后就没法从 groups 反推编号了（遇到 `分组 N` 回退名会算错，见 headerGroups 注释）。
  const headerGroups = [...groups]

  const images: LabelPlusImageEntry[] = []
  const spans: LabelPlusTextSpan[] = []
  const imageByName = new Map<string, LabelPlusImageEntry>()
  let currentImage: LabelPlusImageEntry | null = null
  let pending: PendingLabel | null = null
  let totalLabels = 0

  const flushPending = (): void => {
    if (!pending || !currentImage) return
    const fallbackGroup = `分组 ${pending.groupIndex}`
    const group = groups[pending.groupIndex - 1] || fallbackGroup
    addUnique(groups, group)
    const resolvedIndex = pending.index > 0 ? pending.index : currentImage.labels.length + 1
    currentImage.labels.push({
      index: resolvedIndex,
      group,
      text: pending.lines.join('\n').trim(),
      position: pending.position
    })
    // 行号区间与"这条译文"一一对应（同一个 resolvedIndex），写回服务据此原地改行。
    spans.push({
      imageName: currentImage.fileName,
      labelIndex: resolvedIndex,
      headerLine: pending.line,
      contentStartLine: pending.firstContentLine,
      contentEndLine: pending.lastContentLine
    })
    totalLabels += 1
    if (totalLabels > MAX_LABEL_COUNT) {
      throw new LabelPlusParseError(`文本条目超过限制（${MAX_LABEL_COUNT}）`)
    }
    pending = null
  }

  for (let index = firstFileLine; index < lines.length; index += 1) {
    const line = lines[index]
    const fileMatch = matchLabelPlusFileHeader(line)
    if (fileMatch !== null) {
      flushPending()
      const fileName = fileMatch
      if (!fileName) throw new LabelPlusParseError('图片文件名为空', index + 1)
      currentImage = imageByName.get(fileName) ?? { fileName, labels: [] }
      if (!imageByName.has(fileName)) {
        imageByName.set(fileName, currentImage)
        images.push(currentImage)
        if (images.length > MAX_IMAGE_COUNT) {
          throw new LabelPlusParseError(`图片数量超过限制（${MAX_IMAGE_COUNT}）`)
        }
      }
      continue
    }

    const labelMatch = matchLabelPlusLabelHeader(line)
    if (labelMatch) {
      if (!currentImage) throw new LabelPlusParseError('标签出现在图片标题之前', index + 1)
      flushPending()
      const values = labelMatch.values.split(',').map((value) => value.trim())
      if (values.length < 3) throw new LabelPlusParseError('标签坐标格式错误', index + 1)
      const groupIndex = Number.parseInt(values[2], 10)
      if (!Number.isInteger(groupIndex) || groupIndex <= 0) {
        throw new LabelPlusParseError('标签分组编号无效', index + 1)
      }
      pending = {
        line: index + 1,
        index: labelMatch.index || currentImage.labels.length + 1,
        groupIndex,
        position: normalizedPosition(values[0], values[1], `第 ${index + 1} 行标签`),
        lines: [],
        firstContentLine: 0,
        lastContentLine: 0
      }
      continue
    }

    if (pending) {
      pending.lines.push(line)
      // 只把**非空行**记进内容区：首尾的空行是条目之间的分隔，回写时要原样留着；
      // 中间的空行天然落在 first..last 之内，所以不必特判。
      if (line.trim() !== '') {
        if (pending.firstContentLine === 0) pending.firstContentLine = index + 1
        pending.lastContentLine = index + 1
      }
    }
  }
  flushPending()

  if (images.length === 0) throw new LabelPlusParseError('没有可导入的图片记录')
  assertDocumentLimits(images)

  return {
    document: {
      credits: readTranslationCredits(content),
      sourcePath,
      version: {
        first: Number.isFinite(versionParts[0]) ? versionParts[0] : 1,
        last: Number.isFinite(versionParts[1]) ? versionParts[1] : 0
      },
      groups,
      images,
      warnings: documentWarnings(images)
    },
    spans,
    headerGroups
  }
}

/** 只读解析（既有内部入口：签名与行为都不变，只是把 spans / headerGroups 丢掉）。 */
function parseTextDocument(content: string, sourcePath: string): LabelPlusDocument {
  return parseTextDocumentWithSpans(content, sourcePath).document
}

/**
 * 解析文本，并**顺带报出每一条所占的行号区间**（P2 写回的"原地改行"要用）。
 *
 * 与只读那条路**共用同一个扫描器** —— 绝不另写一份"找标签头"的实现：
 * 两处对"哪一行是标签头"的判断一旦分叉，回写就会改错行。
 */
export function parseLabelPlusTextWithSpans(
  content: string,
  sourcePath = ''
): LabelPlusTextParseResult {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  return parseTextDocumentWithSpans(normalized, sourcePath)
}

export function parseLabelPlusContent(content: string, sourcePath = ''): LabelPlusDocument {
  const normalized = content.replace(/^\uFEFF/, '')
  const useJson =
    extname(sourcePath).toLocaleLowerCase() === '.json' || normalized.trimStart().startsWith('{')
  return useJson
    ? parseJsonDocument(normalized, sourcePath)
    : parseTextDocument(normalized, sourcePath)
}

/** Parse and fingerprint the same bytes so a later external save is detected. */
export async function readLabelPlusFileSnapshot(filePath: string): Promise<{
  document: LabelPlusDocument
  fingerprint: ChapterTranslationFingerprint
}> {
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) throw new LabelPlusParseError('所选路径不是文件')
  if (fileStat.size > MAX_LABELPLUS_FILE_BYTES) {
    throw new LabelPlusParseError(`文件超过 ${MAX_LABELPLUS_FILE_BYTES / 1024 / 1024} MB 限制`)
  }
  const { bytes, fingerprint } = await readChapterTranslationSnapshot(filePath, fileStat)
  // The file may have grown after stat; retain the size guard for this snapshot too.
  if (bytes.length > MAX_LABELPLUS_FILE_BYTES) {
    throw new LabelPlusParseError(`文件超过 ${MAX_LABELPLUS_FILE_BYTES / 1024 / 1024} MB 限制`)
  }
  return {
    document: parseLabelPlusContent(bytes.toString('utf8'), filePath),
    fingerprint
  }
}

export async function readLabelPlusFile(filePath: string): Promise<LabelPlusDocument> {
  return (await readLabelPlusFileSnapshot(filePath)).document
}
