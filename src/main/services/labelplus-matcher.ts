import { readdir } from 'node:fs/promises'
import { extname, join, parse } from 'node:path'
import type {
  LabelPlusDocument,
  LabelPlusImageMatch,
  LabelPlusMatchOptions,
  LabelPlusMatchPreview
} from '@shared/labelplus-import'
import { LABELPLUS_IMPORT_API_VERSION, normalizeLabelPlusExtension } from '@shared/labelplus-import'

export const LABELPLUS_SOURCE_EXTENSIONS = new Set([
  '.psd',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.gif',
  '.avif',
  '.jfif',
  '.tif',
  '.tiff'
])

const EXTENSION_PRIORITY = [
  '.psd',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.gif',
  '.avif',
  '.jfif',
  '.tif',
  '.tiff'
]
const naturalCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export interface LabelPlusSourceFile {
  name: string
  absPath: string
}

export async function listLabelPlusSourceFiles(sourceDirectory: string): Promise<LabelPlusSourceFile[]> {
  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && LABELPLUS_SOURCE_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase()))
    .map((entry) => ({ name: entry.name, absPath: join(sourceDirectory, entry.name) }))
    .sort((left, right) => naturalCollator.compare(left.name, right.name))
}

function stemOf(fileName: string): string {
  const parsed = parse(fileName)
  return (parsed.name || parsed.base).toLocaleLowerCase()
}

function chooseByName(
  labelImageName: string,
  files: LabelPlusSourceFile[],
  forcedExtension: string
): LabelPlusSourceFile | null {
  const lowerName = labelImageName.toLocaleLowerCase()
  const exact = files.find((file) => file.name.toLocaleLowerCase() === lowerName)
  if (exact && !forcedExtension) return exact

  const stem = stemOf(labelImageName)
  const sameStem = files.filter((file) => stemOf(file.name) === stem)
  if (sameStem.length === 0) return null

  if (forcedExtension) {
    return (
      sameStem.find((file) => extname(file.name).toLocaleLowerCase() === forcedExtension) ?? null
    )
  }
  if (exact) return exact

  return (
    [...sameStem].sort((left, right) => {
      const leftPriority = EXTENSION_PRIORITY.indexOf(extname(left.name).toLocaleLowerCase())
      const rightPriority = EXTENSION_PRIORITY.indexOf(extname(right.name).toLocaleLowerCase())
      return (leftPriority < 0 ? Number.MAX_SAFE_INTEGER : leftPriority) -
        (rightPriority < 0 ? Number.MAX_SAFE_INTEGER : rightPriority)
    })[0] ?? null
  )
}

export function matchLabelPlusImages(
  document: LabelPlusDocument,
  sourceFiles: LabelPlusSourceFile[],
  options: LabelPlusMatchOptions
): LabelPlusMatchPreview {
  // Keep the pure matcher deterministic even when callers provide an
  // unsorted list (the directory adapter already sorts, but IPC/tests may not).
  const orderedSourceFiles = [...(Array.isArray(sourceFiles) ? sourceFiles : [])].sort((left, right) =>
    naturalCollator.compare(left.name, right.name)
  )
  const mode = options?.mode === 'sequential' ? 'sequential' : 'file-name'
  const forcedExtension = normalizeLabelPlusExtension(options?.forcedExtension)
  const warnings: string[] = []
  const rows: LabelPlusImageMatch[] = []

  if (mode === 'sequential' && document.images.length !== orderedSourceFiles.length) {
    warnings.push(
      `按顺序匹配时，文本含 ${document.images.length} 张图片，图源目录含 ${orderedSourceFiles.length} 个可识别文件`
    )
  }

  document.images.forEach((image, index) => {
    const source =
      mode === 'sequential'
        ? orderedSourceFiles[index] ?? null
        : chooseByName(image.fileName, orderedSourceFiles, forcedExtension)
    rows.push({
      labelImageName: image.fileName,
      labelCount: image.labels.length,
      sourceFileName: source?.name ?? null,
      sourcePath: source?.absPath ?? null,
      matched: Boolean(source),
      message: source
        ? mode === 'sequential'
          ? `按顺序匹配到 ${source.name}`
          : `匹配到 ${source.name}`
        : '未找到图源'
    })
  })

  const matchedCount = rows.filter((row) => row.matched).length
  return {
    apiVersion: LABELPLUS_IMPORT_API_VERSION,
    rows,
    matchedCount,
    unmatchedCount: rows.length - matchedCount,
    sourceFileCount: orderedSourceFiles.length,
    warnings
  }
}
