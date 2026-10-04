import extract from 'extract-zip'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, resolve } from 'node:path'
import type { LabelPlusFileSelection, LabelPlusInputKind } from '@shared/labelplus-import'
import { createLabelPlusFileSelection } from './labelplus-import-service'
import { listLabelPlusSourceFiles, matchLabelPlusImages } from './labelplus-matcher'
import { readLabelPlusFile } from './labelplus-parser'

const LABEL_EXTENSIONS = new Set(['.txt', '.json', '.labelplus'])
const IMAGE_EXTENSIONS = new Set([
  '.psd',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.tif',
  '.tiff',
  '.bmp'
])
const MAX_DISCOVERED_ENTRIES = 20_000

interface BundleWalkResult {
  labelFiles: string[]
  imageDirectories: string[]
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function safeBundleName(filePath: string): string {
  const value = parse(filePath)
    .name.split('')
    .map((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character
    })
    .join('')
    .trim()
  return value || 'labelplus-zip'
}

async function walkBundle(rootDirectory: string): Promise<BundleWalkResult> {
  const labelFiles: string[] = []
  const imageDirectories = new Set<string>()
  const queue = [rootDirectory]
  let discovered = 0

  while (queue.length > 0) {
    const current = queue.shift()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      discovered += 1
      if (discovered > MAX_DISCOVERED_ENTRIES) {
        throw new Error(`导入目录文件过多，已超过 ${MAX_DISCOVERED_ENTRIES} 项限制`)
      }
      const absPath = join(current, entry.name)
      if (entry.isDirectory()) {
        if (!['node_modules', '.git'].includes(entry.name.toLocaleLowerCase())) queue.push(absPath)
        continue
      }
      if (!entry.isFile()) continue
      const extension = extname(entry.name).toLocaleLowerCase()
      if (LABEL_EXTENSIONS.has(extension)) labelFiles.push(absPath)
      if (IMAGE_EXTENSIONS.has(extension)) imageDirectories.add(current)
    }
  }

  labelFiles.sort(naturalCompare)
  return { labelFiles, imageDirectories: [...imageDirectories].sort(naturalCompare) }
}

async function selectLabelFile(labelFiles: string[]): Promise<LabelPlusFileSelection> {
  const candidates: LabelPlusFileSelection[] = []
  const errors: string[] = []
  for (const filePath of labelFiles) {
    try {
      candidates.push(await createLabelPlusFileSelection(filePath))
    } catch (error) {
      errors.push(`${basename(filePath)}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  candidates.sort(
    (left, right) =>
      right.images.length - left.images.length ||
      right.totalLabels - left.totalLabels ||
      naturalCompare(left.filePath, right.filePath)
  )
  const selected = candidates[0]
  if (!selected) {
    const details = errors.slice(0, 3).join('；')
    throw new Error(details ? `未找到可解析的 LabelPlus 文本：${details}` : '未找到 LabelPlus TXT/JSON 文本')
  }
  if (candidates.length > 1) {
    selected.warnings = [
      ...selected.warnings,
      `检测到 ${candidates.length} 个可解析文本，已自动选择 ${selected.fileName}`
    ]
  }
  return selected
}

async function bestSourceDirectory(
  selection: LabelPlusFileSelection,
  bundleRoot: string,
  imageDirectories: string[]
): Promise<string> {
  const document = await readLabelPlusFile(selection.filePath)
  const candidates = [
    selection.suggestedSourceDirectory,
    join(dirname(selection.filePath), 'images'),
    join(dirname(selection.filePath), 'image'),
    dirname(selection.filePath),
    bundleRoot,
    ...imageDirectories
  ]
  const unique = [...new Set(candidates.filter(Boolean).map((candidate) => resolve(candidate)))]
  let best = ''
  let bestScore = -1

  for (const candidate of unique) {
    try {
      const files = await listLabelPlusSourceFiles(candidate)
      if (files.length === 0) continue
      const preview = matchLabelPlusImages(document, files, { mode: 'file-name', forcedExtension: '' })
      const score = preview.matchedCount * 1_000_000 + files.length
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    } catch {
      // Skip unreadable candidate directories and continue discovery.
    }
  }
  return best || selection.suggestedSourceDirectory || dirname(selection.filePath)
}

async function prepareBundleDirectory(
  directory: string,
  inputKind: LabelPlusInputKind,
  inputPath: string,
  extractedDirectory?: string
): Promise<LabelPlusFileSelection> {
  const bundleRoot = resolve(directory)
  const walked = await walkBundle(bundleRoot)
  const selection = await selectLabelFile(walked.labelFiles)
  const sourceDirectory = await bestSourceDirectory(
    selection,
    bundleRoot,
    walked.imageDirectories
  )
  return {
    ...selection,
    suggestedSourceDirectory: sourceDirectory,
    suggestedOutputDirectory: join(bundleRoot, 'output'),
    inputKind,
    inputPath,
    inputRootDirectory: bundleRoot,
    ...(extractedDirectory ? { extractedDirectory } : {})
  }
}

export async function prepareLabelPlusInput(
  inputPath: string,
  zipTempRoot: string
): Promise<LabelPlusFileSelection> {
  const absoluteInput = resolve(inputPath)
  const inputStat = await stat(absoluteInput)
  if (inputStat.isDirectory()) {
    return prepareBundleDirectory(absoluteInput, 'directory', absoluteInput)
  }
  if (!inputStat.isFile()) throw new Error('拖入内容不是文件或文件夹')

  const extension = extname(absoluteInput).toLocaleLowerCase()
  if (LABEL_EXTENSIONS.has(extension)) {
    return {
      ...(await createLabelPlusFileSelection(absoluteInput)),
      inputKind: 'file',
      inputPath: absoluteInput,
      inputRootDirectory: dirname(absoluteInput)
    }
  }
  if (extension !== '.zip') throw new Error('仅支持 LabelPlus TXT/JSON、文件夹或 ZIP')

  const tempRoot = resolve(zipTempRoot)
  const extractionDirectory = resolve(tempRoot, safeBundleName(absoluteInput))
  if (dirname(extractionDirectory) !== tempRoot) throw new Error('ZIP 临时目录解析失败')
  await mkdir(tempRoot, { recursive: true })
  await rm(extractionDirectory, { recursive: true, force: true })
  await mkdir(extractionDirectory, { recursive: true })
  await extract(absoluteInput, { dir: extractionDirectory })
  return prepareBundleDirectory(extractionDirectory, 'zip', absoluteInput, extractionDirectory)
}
