/**
 * LabelPlus 输入准备（TXT / 文件夹 / ZIP）—— 2026-10-05 从并行分支 T5 移植**导入加固**。
 *
 * 相比旧版多出四条保障：
 *   1. **ZIP 解压守卫**（`createLabelPlusZipEntryGuard`）：越界路径、绝对路径、符号链接、
 *      加密条目、条目数（2 万）、单文件（1 GiB）、解压总体积（16 GiB）——全部在解压前逐条目拦截；
 *   2. **暂存发布**：先解压到独立暂存目录并解析成功，再原子发布到 `temp/<包名>`；
 *      发布失败自动回滚，旧的解压目录与已编辑的 `output` 原样保留；
 *   3. **保留既有 output**：重导入同一 ZIP 不再清掉用户手工编辑过的输出目录；
 *   4. **按发布目录串行**：同名 ZIP 并发导入排队执行，不会相互覆盖。
 *   另：发现图源时排除根目录的 `output`（上一轮的产物不该被当成图源）。
 *
 * 公共部分（walkBundle / selectLabelFile / bestSourceDirectory / prepareBundleDirectory）
 * 与旧版逐字一致，只有上述新增能力是差异。
 */
import extract from 'extract-zip'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, relative, resolve } from 'node:path'
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
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 16 * 1024 * 1024 * 1024
const LABELPLUS_OUTPUT_DIRECTORY_NAME = 'output'

export interface LabelPlusZipEntryLike {
  fileName: string
  uncompressedSize: number
  generalPurposeBitFlag: number
  externalFileAttributes: number
}

export interface LabelPlusZipSafetyLimits {
  maximumEntries: number
  maximumEntryUncompressedBytes: number
  maximumTotalUncompressedBytes: number
}

const DEFAULT_ZIP_SAFETY_LIMITS: LabelPlusZipSafetyLimits = {
  maximumEntries: MAX_DISCOVERED_ENTRIES,
  maximumEntryUncompressedBytes: MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES,
  maximumTotalUncompressedBytes: MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES
}

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

function normalizedZipEntryName(fileName: string): string {
  const normalized = String(fileName ?? '').replace(/\\/gu, '/')
  if (!normalized || normalized.includes('\0')) throw new Error('ZIP 包含无效的空文件名')
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) {
    throw new Error(`ZIP 包含绝对路径：${fileName}`)
  }
  const segments = normalized.split('/').filter(Boolean)
  if (segments.includes('..')) throw new Error(`ZIP 包含越界路径：${fileName}`)
  if (segments.some((segment) => segment.includes(':'))) {
    throw new Error(`ZIP 包含不安全的路径字符：${fileName}`)
  }
  return normalized
}

function zipEntryIsSymbolicLink(entry: LabelPlusZipEntryLike): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  return (unixMode & 0xf000) === 0xa000
}

export function createLabelPlusZipEntryGuard(
  limits: LabelPlusZipSafetyLimits = DEFAULT_ZIP_SAFETY_LIMITS
): (entry: LabelPlusZipEntryLike, declaredEntryCount?: number) => void {
  const maximumEntries = Math.max(1, Math.floor(limits.maximumEntries))
  const maximumEntryBytes = Math.max(1, Math.floor(limits.maximumEntryUncompressedBytes))
  const maximumTotalBytes = Math.max(1, Math.floor(limits.maximumTotalUncompressedBytes))
  let visitedEntries = 0
  let totalUncompressedBytes = 0

  return (entry, declaredEntryCount) => {
    const entryName = normalizedZipEntryName(entry.fileName)
    if (Number.isFinite(declaredEntryCount) && Number(declaredEntryCount) > maximumEntries) {
      throw new Error(`ZIP 文件数量超过 ${maximumEntries} 项限制`)
    }
    visitedEntries += 1
    if (visitedEntries > maximumEntries)
      throw new Error(`ZIP 文件数量超过 ${maximumEntries} 项限制`)
    if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
      throw new Error(`ZIP 包含不支持的加密条目：${entryName}`)
    }
    if (zipEntryIsSymbolicLink(entry)) {
      throw new Error(`ZIP 包含不允许的符号链接：${entryName}`)
    }
    const entryBytes = Number(entry.uncompressedSize)
    if (!Number.isSafeInteger(entryBytes) || entryBytes < 0) {
      throw new Error(`ZIP 条目大小无效：${entryName}`)
    }
    if (entryBytes > maximumEntryBytes) {
      throw new Error(`ZIP 单个文件解压后超过 ${maximumEntryBytes} 字节限制：${entryName}`)
    }
    totalUncompressedBytes += entryBytes
    if (
      !Number.isSafeInteger(totalUncompressedBytes) ||
      totalUncompressedBytes > maximumTotalBytes
    ) {
      throw new Error(`ZIP 解压后总大小超过 ${maximumTotalBytes} 字节限制`)
    }
  }
}

function isBundleRootOutputDirectory(
  rootDirectory: string,
  current: string,
  name: string
): boolean {
  return (
    resolve(current) === resolve(rootDirectory) &&
    name.toLocaleLowerCase() === LABELPLUS_OUTPUT_DIRECTORY_NAME
  )
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
        if (isBundleRootOutputDirectory(rootDirectory, current, entry.name)) continue
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

async function moveDirectoryIfPresent(
  sourcePath: string,
  destinationPath: string
): Promise<boolean> {
  try {
    const source = await lstat(sourcePath)
    if (!source.isDirectory() || source.isSymbolicLink()) return false
    await rename(sourcePath, destinationPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function publishExtractedBundle(
  stagingDirectory: string,
  extractionDirectory: string,
  tempRoot: string
): Promise<void> {
  const nonce = `${process.pid}-${randomUUID()}`
  const previousDirectory = resolve(tempRoot, `.qianzi-previous-${nonce}`)
  const preservedOutput = resolve(tempRoot, `.qianzi-output-${nonce}`)
  const archivedOutput = resolve(tempRoot, `.qianzi-archive-output-${nonce}`)
  let previousMoved = false
  let preservedOutputMoved = false
  let archivedOutputMoved = false
  let stagingPublished = false

  try {
    archivedOutputMoved = await moveDirectoryIfPresent(
      join(stagingDirectory, LABELPLUS_OUTPUT_DIRECTORY_NAME),
      archivedOutput
    )
    try {
      await rename(extractionDirectory, previousDirectory)
      previousMoved = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (previousMoved) {
      preservedOutputMoved = await moveDirectoryIfPresent(
        join(previousDirectory, LABELPLUS_OUTPUT_DIRECTORY_NAME),
        preservedOutput
      )
    }

    await rename(stagingDirectory, extractionDirectory)
    stagingPublished = true
    if (preservedOutputMoved) {
      await rename(preservedOutput, join(extractionDirectory, LABELPLUS_OUTPUT_DIRECTORY_NAME))
      preservedOutputMoved = false
    } else if (archivedOutputMoved) {
      await rename(archivedOutput, join(extractionDirectory, LABELPLUS_OUTPUT_DIRECTORY_NAME))
      archivedOutputMoved = false
    }

    if (previousMoved) {
      await rm(previousDirectory, { recursive: true, force: true })
      previousMoved = false
    }
    if (archivedOutputMoved) {
      await rm(archivedOutput, { recursive: true, force: true })
      archivedOutputMoved = false
    }
  } catch (publishError) {
    try {
      if (stagingPublished) {
        if (!preservedOutputMoved) {
          preservedOutputMoved = await moveDirectoryIfPresent(
            join(extractionDirectory, LABELPLUS_OUTPUT_DIRECTORY_NAME),
            preservedOutput
          )
        }
        await rm(extractionDirectory, { recursive: true, force: true })
        stagingPublished = false
      }
      if (previousMoved) {
        await rename(previousDirectory, extractionDirectory)
        previousMoved = false
      }
      if (preservedOutputMoved) {
        await rename(preservedOutput, join(extractionDirectory, LABELPLUS_OUTPUT_DIRECTORY_NAME))
        preservedOutputMoved = false
      }
    } catch (restoreError) {
      throw new AggregateError(
        [publishError, restoreError],
        `ZIP 解压目录发布失败，旧输出保留在：${preservedOutput}`
      )
    }
    throw publishError
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    if (archivedOutputMoved) {
      await rm(archivedOutput, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

function rebaseExtractedSelection(
  selection: LabelPlusFileSelection,
  stagingDirectory: string,
  extractionDirectory: string,
  inputPath: string
): LabelPlusFileSelection {
  const rebasePath = (value: string): string => {
    const relativePath = relative(stagingDirectory, resolve(value))
    if (!relativePath || relativePath === '.') return extractionDirectory
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    ) {
      throw new Error('ZIP 解析结果超出暂存目录')
    }
    return join(extractionDirectory, relativePath)
  }
  return {
    ...selection,
    filePath: rebasePath(selection.filePath),
    suggestedSourceDirectory: rebasePath(selection.suggestedSourceDirectory),
    suggestedOutputDirectory: join(extractionDirectory, LABELPLUS_OUTPUT_DIRECTORY_NAME),
    inputKind: 'zip',
    inputPath,
    inputRootDirectory: extractionDirectory,
    extractedDirectory: extractionDirectory
  }
}

async function selectLabelFile(labelFiles: string[]): Promise<LabelPlusFileSelection> {
  const candidates: LabelPlusFileSelection[] = []
  const errors: string[] = []
  for (const filePath of labelFiles) {
    try {
      candidates.push(await createLabelPlusFileSelection(filePath))
    } catch (error) {
      errors.push(
        `${basename(filePath)}：${error instanceof Error ? error.message : String(error)}`
      )
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
    throw new Error(
      details ? `未找到可解析的 LabelPlus 文本：${details}` : '未找到 LabelPlus TXT/JSON 文本'
    )
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
      const preview = matchLabelPlusImages(document, files, {
        mode: 'file-name',
        forcedExtension: ''
      })
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
  const sourceDirectory = await bestSourceDirectory(selection, bundleRoot, walked.imageDirectories)
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

async function prepareLabelPlusInputUnlocked(
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
  const stagingDirectory = resolve(tempRoot, `.qianzi-extract-${process.pid}-${randomUUID()}`)
  if (dirname(stagingDirectory) !== tempRoot) throw new Error('ZIP 暂存目录解析失败')
  await mkdir(tempRoot, { recursive: true })
  await rm(stagingDirectory, { recursive: true, force: true })
  await mkdir(stagingDirectory, { recursive: true })
  const guardEntry = createLabelPlusZipEntryGuard()
  try {
    await extract(absoluteInput, {
      dir: stagingDirectory,
      onEntry: (entry, zipFile) => guardEntry(entry, zipFile.entryCount)
    })
    const stagingSelection = await prepareBundleDirectory(
      stagingDirectory,
      'zip',
      absoluteInput,
      stagingDirectory
    )
    await publishExtractedBundle(stagingDirectory, extractionDirectory, tempRoot)
    return rebaseExtractedSelection(
      stagingSelection,
      stagingDirectory,
      extractionDirectory,
      absoluteInput
    )
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

const zipImports = new Map<string, Promise<unknown>>()
export async function prepareLabelPlusInput(
  inputPath: string,
  zipTempRoot: string
): Promise<LabelPlusFileSelection> {
  if (extname(inputPath).toLowerCase() !== '.zip')
    return prepareLabelPlusInputUnlocked(inputPath, zipTempRoot)
  const key = resolve(zipTempRoot, safeBundleName(inputPath)).toLowerCase()
  const previous = zipImports.get(key) ?? Promise.resolve()
  const operation = previous
    .catch(() => undefined)
    .then(() => prepareLabelPlusInputUnlocked(inputPath, zipTempRoot))
  zipImports.set(key, operation)
  try {
    return await operation
  } finally {
    if (zipImports.get(key) === operation) zipImports.delete(key)
  }
}
