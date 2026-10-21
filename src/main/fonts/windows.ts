import { readFontMetadata, invalidateFontMetadata } from './repository'
import type { FontMetadata } from './metadata'
export { classifyCmapCoverage } from './metadata'
import { app } from 'electron'
import { createHash } from 'crypto'
import { queryRegistryFonts, setFontRegistration, removeFontRegistration, changeFontResource, type RegistryFont } from './native'
import { constants, copyFile, mkdir, readdir, stat, unlink, rename } from 'fs/promises'
import { basename, extname, isAbsolute, join, parse, resolve } from 'path'
import type {
  FontActionResult,
  FontBatchActionResult,
  FontInstallFailure,
  FontInstallResult,
  FontFolderListResult,
  FontLanguage,
  FontListResult,
  FontSource,
  SystemFontInfo
} from '@shared/ipc-api'
import { getStoredValue, setStoredValue } from '../services/database'

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc'])

interface ManagedFontRecord {
  id: string
  family: string
  style: string
  postScriptName: string
  displayName: string
  fileName: string
  filePath: string
  format: 'TTF' | 'OTF' | 'TTC'
  languages: FontLanguage[]
  registryName: string
  installedAt: number
}

interface FontManagerMemory {
  version: 1
  installed: Record<string, ManagedFontRecord>
}

let managedMemory: FontManagerMemory | null = null
let writeQueue: Promise<void> = Promise.resolve()

export function resetFontManagerMemory(): void {
  managedMemory = null
}

function userFontDirectory(): string {
  const localAppData = process.env.LOCALAPPDATA || join(app.getPath('home'), 'AppData', 'Local')
  return join(localAppData, 'Microsoft', 'Windows', 'Fonts')
}

function systemFontDirectory(): string {
  return join(process.env.WINDIR || 'C:\\Windows', 'Fonts')
}

function fontId(filePath: string): string {
  return createHash('sha1').update(filePath.toLocaleLowerCase()).digest('hex')
}

function fontFormat(filePath: string): 'TTF' | 'OTF' | 'TTC' {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.otf') return 'OTF'
  if (extension === '.ttc') return 'TTC'
  return 'TTF'
}

function cleanRegistryName(name: string): string {
  return name
    .replace(/\s*\((?:TrueType|OpenType)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function loadManagedMemory(): Promise<FontManagerMemory> {
  if (managedMemory) return managedMemory
  try {
    const parsed = (await getStoredValue('fontManager')) as Partial<FontManagerMemory>
    managedMemory = {
      version: 1,
      installed: parsed.installed && typeof parsed.installed === 'object' ? parsed.installed : {}
    }
  } catch {
    managedMemory = { version: 1, installed: {} }
  }
  return managedMemory
}

async function saveManagedMemory(memory: FontManagerMemory): Promise<void> {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await setStoredValue('fontManager', memory)
    })
  await writeQueue
}

function registryFilePath(entry: RegistryFont): string {
  if (isAbsolute(entry.value)) return resolve(entry.value)
  return join(entry.scope === 'system' ? systemFontDirectory() : userFontDirectory(), entry.value)
}

async function collectFontFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && FONT_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => join(directory, entry.name))
  } catch {
    return []
  }
}

async function collectFontFilesRecursively(directory: string): Promise<string[]> {
  const files: string[] = []
  const pending = [resolve(directory)]
  while (pending.length > 0) {
    const current = pending.pop()!
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const filePath = join(current, entry.name)
      if (entry.isDirectory()) pending.push(filePath)
      else if (entry.isFile() && FONT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(filePath)
      }
    }
  }
  return files
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index])
    }
  })
  await Promise.all(workers)
  return results
}

function sourceForPath(filePath: string, managed: boolean): FontSource {
  if (managed) return 'managed'
  const normalized = resolve(filePath).toLocaleLowerCase()
  if (pathIsInside(userFontDirectory(), normalized)) return 'user'
  return 'system'
}

export async function listSystemFonts(): Promise<FontListResult> {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      fonts: [],
      scannedAt: Date.now(),
      message: '字体管理仅支持 Windows'
    }
  }

  const [registryFonts, systemFiles, userFiles, memory] = await Promise.all([
    queryRegistryFonts(),
    collectFontFiles(systemFontDirectory()),
    collectFontFiles(userFontDirectory()),
    loadManagedMemory()
  ])

  const registryByPath = new Map<string, RegistryFont>()
  for (const entry of registryFonts) {
    const path = registryFilePath(entry)
    if (!FONT_EXTENSIONS.has(extname(path).toLowerCase())) continue
    registryByPath.set(resolve(path).toLocaleLowerCase(), entry)
  }

  const allPaths = new Map<string, string>()
  for (const path of [...systemFiles, ...userFiles, ...registryFonts.map(registryFilePath)]) {
    if (!FONT_EXTENSIONS.has(extname(path).toLowerCase())) continue
    allPaths.set(resolve(path).toLocaleLowerCase(), resolve(path))
  }

  const groups = await mapWithConcurrency<string, SystemFontInfo[]>(
    [...allPaths.values()],
    8,
    async (filePath) => {
      const fileId = fontId(filePath)
      const managedRecord = memory.installed[fileId]
      try {
        const faces = await readFontMetadata(filePath)
        return faces.map((metadata) =>
          fontInfo(
            filePath,
            metadata,
            sourceForPath(filePath, Boolean(managedRecord)),
            managedRecord?.installedAt
          )
        )
      } catch {
        const fallback = cleanRegistryName(
          registryByPath.get(resolve(filePath).toLowerCase())?.name || parse(filePath).name
        )
        return [
          fontInfo(
            filePath,
            {
              faceIndex: 0,
              family: fallback,
              style: 'Regular',
              postScriptName: '',
              languages: ['other'],
              weight: 400,
              italic: false
            },
            sourceForPath(filePath, Boolean(managedRecord))
          )
        ]
      }
    }
  )
  const availableFonts = groups.flat().sort(compareFonts)

  return { supported: true, fonts: availableFonts, scannedAt: Date.now() }
}

function fontInfo(
  filePath: string,
  metadata: FontMetadata,
  source: FontSource,
  installedAt?: number
): SystemFontInfo {
  const fileId = fontId(filePath)
  return {
    ...metadata,
    id: metadata.faceIndex === 0 ? fileId : `${fileId}:${metadata.faceIndex}`,
    fileId,
    displayName: `${metadata.family} ${metadata.style}`.trim(),
    fileName: basename(filePath),
    filePath: resolve(filePath),
    format: fontFormat(filePath),
    source,
    managed: source === 'managed',
    installedAt
  }
}
function compareFonts(left: SystemFontInfo, right: SystemFontInfo): number {
  return (
    left.family.localeCompare(right.family, 'zh-CN', { numeric: true, sensitivity: 'base' }) ||
    (left.weight ?? 400) - (right.weight ?? 400) ||
    left.id.localeCompare(right.id)
  )
}
export async function listFontsInFolder(folderPath: string): Promise<FontFolderListResult> {
  const directory = resolve(folderPath)
  const snapshot = await stat(directory)
  if (!snapshot.isDirectory()) throw new Error('字体目录不存在')
  const paths = await collectFontFilesRecursively(directory)
  const groups = await mapWithConcurrency(paths, 8, async (filePath) => {
    try {
      return (await readFontMetadata(filePath)).map((face) => fontInfo(filePath, face, 'folder'))
    } catch {
      return []
    }
  })
  return {
    canceled: false,
    supported: true,
    folderPath: directory,
    fonts: groups.flat().sort(compareFonts),
    scannedAt: Date.now()
  }
}

function registryDisplayName(
  metadata: FontMetadata,
  format: 'TTF' | 'OTF' | 'TTC',
  marker: string
): string {
  const style = /^regular$/i.test(metadata.style) ? '' : ` ${metadata.style}`
  const suffix = format === 'OTF' ? 'OpenType' : 'TrueType'
  return `${metadata.family}${style} 嵌字工坊-${marker} (${suffix})`
}

async function uniqueDestination(sourcePath: string): Promise<string> {
  const directory = userFontDirectory()
  await mkdir(directory, { recursive: true })
  const parsed = parse(sourcePath)
  let candidate = join(directory, basename(sourcePath))
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await stat(candidate)
      candidate = join(directory, `${parsed.name}-${Date.now()}-${attempt + 1}${parsed.ext}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return candidate
    }
  }
  throw new Error('无法生成字体目标文件名')
}

async function registerFont(record: ManagedFontRecord, registered: () => void): Promise<void> {
  setFontRegistration(record.registryName, record.filePath)
  registered()
  await changeFontResource('add', record.filePath)
}

async function restoreRegistration(filePath: string, names: string[]): Promise<void> {
  for (const name of names) setFontRegistration(name, filePath)
  await changeFontResource('add', filePath)
}

export async function installUserFonts(sourcePaths: string[]): Promise<FontInstallResult> {
  const installed: SystemFontInfo[] = []
  const failed: FontInstallFailure[] = []
  if (process.platform !== 'win32') {
    return {
      canceled: false,
      installed,
      failed: [{ fileName: '', message: '字体管理仅支持 Windows' }]
    }
  }

  const memory = await loadManagedMemory()
  for (const sourcePath of sourcePaths) {
    const sourceName = basename(sourcePath)
    const extension = extname(sourcePath).toLowerCase()
    if (!FONT_EXTENSIONS.has(extension)) {
      failed.push({ fileName: sourceName, message: '仅支持 TTF、OTF、TTC 字体' })
      continue
    }

    let destination = ''
    let copied = false
    let registered: ManagedFontRecord | undefined
    try {
      const faces = await readFontMetadata(sourcePath)
      const metadata = faces[0]
      destination = await uniqueDestination(sourcePath)
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL)
      copied = true
      const format = fontFormat(destination)
      const id = fontId(destination)
      const record: ManagedFontRecord = {
        id,
        family: metadata.family,
        style: metadata.style,
        postScriptName: metadata.postScriptName,
        displayName: `${metadata.family} ${metadata.style}`.trim(),
        fileName: basename(destination),
        filePath: destination,
        format,
        languages: metadata.languages,
        registryName: registryDisplayName(metadata, format, id.slice(0, 8)),
        installedAt: Date.now()
      }
      await registerFont(record, () => {
        registered = record
      })
      memory.installed[id] = record
      await saveManagedMemory(memory)
      installed.push(
        ...faces.map((face) => fontInfo(destination, face, 'managed', record.installedAt))
      )
    } catch (error) {
      if (registered) {
        delete memory.installed[registered.id]
        try {
          await changeFontResource('remove', destination)
          removeFontRegistration(registered.registryName)
        } catch (rollback) {
          failed.push({
            fileName: sourceName,
            message: `安装回滚未完成，保留字体文件：${String(rollback)}`
          })
          continue
        }
      }
      if (copied) {
        try {
          await unlink(destination)
        } catch {
          // Best-effort rollback only.
        }
      }
      failed.push({
        fileName: sourceName,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { canceled: false, installed, failed }
}

export async function uninstallUserFont(fontIdToRemove: string): Promise<FontActionResult> {
  const result = await uninstallUserFonts([fontIdToRemove])
  if (result.succeeded.includes(fontIdToRemove.split(':')[0])) {
    return { ok: true, message: '字体已卸载' }
  }
  return {
    ok: false,
    message:
      result.failed.find((failure) => failure.fontId === fontIdToRemove.split(':')[0])?.message ||
      '卸载失败'
  }
}

function pathIsInside(directory: string, filePath: string): boolean {
  const normalizedDirectory = `${resolve(directory).toLocaleLowerCase()}\\`
  return resolve(filePath).toLocaleLowerCase().startsWith(normalizedDirectory)
}

export async function uninstallUserFonts(fontIds: string[]): Promise<FontBatchActionResult> {
  const uniqueIds = [
    ...new Set(
      fontIds.filter((id) => typeof id === 'string' && id.length > 0).map((id) => id.split(':')[0])
    )
  ]
  const result: FontBatchActionResult = { succeeded: [], failed: [] }
  if (process.platform !== 'win32') {
    result.failed = uniqueIds.map((fontIdToRemove) => ({
      fontId: fontIdToRemove,
      message: '字体管理仅支持 Windows'
    }))
    return result
  }
  if (uniqueIds.length === 0) return result

  const [memory, inventory, registryFonts] = await Promise.all([
    loadManagedMemory(),
    listSystemFonts(),
    queryRegistryFonts()
  ])
  const inventoryById = new Map(inventory.fonts.map((font) => [font.id, font]))

  for (const fontIdToRemove of uniqueIds) {
    const managedRecord = memory.installed[fontIdToRemove]
    const font = inventoryById.get(fontIdToRemove)
    const filePath = managedRecord?.filePath || font?.filePath

    if (!filePath || (!managedRecord && font?.source !== 'user')) {
      result.failed.push({
        fontId: fontIdToRemove,
        message: '系统字体受保护，只能卸载用户字体'
      })
      continue
    }
    if (!pathIsInside(userFontDirectory(), filePath)) {
      result.failed.push({
        fontId: fontIdToRemove,
        message: '字体不在当前用户字体目录中，已拒绝卸载'
      })
      continue
    }

    const normalizedPath = resolve(filePath).toLocaleLowerCase()
    const registryNames = managedRecord
      ? [managedRecord.registryName]
      : registryFonts
          .filter(
            (entry) =>
              entry.scope === 'user' &&
              resolve(registryFilePath(entry)).toLocaleLowerCase() === normalizedPath
          )
          .map((entry) => entry.name)

    const staged = `${filePath}.qianzi-removing-${Date.now()}`
    let moved = false
    try {
      await changeFontResource('remove', filePath)
      await rename(filePath, staged)
      moved = true
      for (const name of registryNames) removeFontRegistration(name)
      if (managedRecord) {
        delete memory.installed[fontIdToRemove]
        await saveManagedMemory(memory)
      }
      invalidateFontMetadata(normalizedPath)
      await unlink(staged)
      result.succeeded.push(fontIdToRemove)
    } catch (error) {
      let failure = error
      try {
        if (moved) await rename(staged, filePath)
        await restoreRegistration(filePath, registryNames)
        if (managedRecord) {
          memory.installed[fontIdToRemove] = managedRecord
          await saveManagedMemory(memory)
        }
      } catch (rollback) {
        failure = new Error(`${String(error)}；恢复未完成：${String(rollback)}；备份：${staged}`)
      }
      result.failed.push({
        fontId: fontIdToRemove,
        message: `卸载失败：${failure instanceof Error ? failure.message : String(failure)}`
      })
    }
  }

  return result
}
