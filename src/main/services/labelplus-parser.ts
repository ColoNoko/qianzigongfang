import { readFile, stat } from 'node:fs/promises'
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
// Official PS-Script output uses eight `>`/`<` characters, while older
// LabelPlus exporters used six. Accept any run of six or more delimiters.
const FILE_HEADER = /^\s*>{6,}\[(.*)\]<{6,}\s*$/
const LABEL_HEADER = /^\s*-{6,}\[(.*?)\]-{6,}\[([^\]]+)\]\s*$/

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
    ? record.groups.filter((value): value is string => typeof value === 'string').map((value) => value.trim())
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
}

function parseTextDocument(content: string, sourcePath: string): LabelPlusDocument {
  const lines = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const firstFileLine = lines.findIndex((line) => FILE_HEADER.test(line))
  if (firstFileLine < 0) throw new LabelPlusParseError('没有找到图片标题行')

  const headerLines = lines.slice(0, firstFileLine)
  const versionLine = headerLines.find((line) => /^\s*\d+\s*,\s*\d+\s*$/.test(line))
  const versionParts = versionLine?.split(',').map((part) => Number.parseInt(part.trim(), 10)) ?? [1, 0]
  const separators = headerLines
    .map((line, index) => (line.trim() === '-' ? index : -1))
    .filter((index) => index >= 0)
  const groups: string[] = []
  if (separators.length >= 2) {
    for (const line of headerLines.slice(separators[0] + 1, separators[1])) addUnique(groups, line)
  }
  if (groups.length === 0) groups.push('默认')

  const images: LabelPlusImageEntry[] = []
  const imageByName = new Map<string, LabelPlusImageEntry>()
  let currentImage: LabelPlusImageEntry | null = null
  let pending: PendingLabel | null = null
  let totalLabels = 0

  const flushPending = (): void => {
    if (!pending || !currentImage) return
    const fallbackGroup = `分组 ${pending.groupIndex}`
    const group = groups[pending.groupIndex - 1] || fallbackGroup
    addUnique(groups, group)
    currentImage.labels.push({
      index: pending.index > 0 ? pending.index : currentImage.labels.length + 1,
      group,
      text: pending.lines.join('\n').trim(),
      position: pending.position
    })
    totalLabels += 1
    if (totalLabels > MAX_LABEL_COUNT) {
      throw new LabelPlusParseError(`文本条目超过限制（${MAX_LABEL_COUNT}）`)
    }
    pending = null
  }

  for (let index = firstFileLine; index < lines.length; index += 1) {
    const line = lines[index]
    const fileMatch = line.match(FILE_HEADER)
    if (fileMatch) {
      flushPending()
      const fileName = fileMatch[1].trim()
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

    const labelMatch = line.match(LABEL_HEADER)
    if (labelMatch) {
      if (!currentImage) throw new LabelPlusParseError('标签出现在图片标题之前', index + 1)
      flushPending()
      const values = labelMatch[2].split(',').map((value) => value.trim())
      if (values.length < 3) throw new LabelPlusParseError('标签坐标格式错误', index + 1)
      const groupIndex = Number.parseInt(values[2], 10)
      if (!Number.isInteger(groupIndex) || groupIndex <= 0) {
        throw new LabelPlusParseError('标签分组编号无效', index + 1)
      }
      pending = {
        line: index + 1,
        index: Number.parseInt(labelMatch[1], 10) || currentImage.labels.length + 1,
        groupIndex,
        position: normalizedPosition(values[0], values[1], `第 ${index + 1} 行标签`),
        lines: []
      }
      continue
    }

    if (pending) pending.lines.push(line)
  }
  flushPending()

  if (images.length === 0) throw new LabelPlusParseError('没有可导入的图片记录')
  assertDocumentLimits(images)

  return {
    sourcePath,
    version: {
      first: Number.isFinite(versionParts[0]) ? versionParts[0] : 1,
      last: Number.isFinite(versionParts[1]) ? versionParts[1] : 0
    },
    groups,
    images,
    warnings: documentWarnings(images)
  }
}

export function parseLabelPlusContent(content: string, sourcePath = ''): LabelPlusDocument {
  const normalized = content.replace(/^\uFEFF/, '')
  const useJson = extname(sourcePath).toLocaleLowerCase() === '.json' || normalized.trimStart().startsWith('{')
  return useJson
    ? parseJsonDocument(normalized, sourcePath)
    : parseTextDocument(normalized, sourcePath)
}

export async function readLabelPlusFile(filePath: string): Promise<LabelPlusDocument> {
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) throw new LabelPlusParseError('所选路径不是文件')
  if (fileStat.size > MAX_LABELPLUS_FILE_BYTES) {
    throw new LabelPlusParseError(`文件超过 ${MAX_LABELPLUS_FILE_BYTES / 1024 / 1024} MB 限制`)
  }
  const content = await readFile(filePath, 'utf8')
  return parseLabelPlusContent(content, filePath)
}
