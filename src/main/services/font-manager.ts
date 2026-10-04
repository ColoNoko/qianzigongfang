import { app } from 'electron'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { constants, copyFile, mkdir, open, readdir, stat, unlink } from 'fs/promises'
import type { FileHandle } from 'fs/promises'
import { basename, extname, isAbsolute, join, parse, resolve } from 'path'
import type {
  FontActionResult,
  FontBatchActionResult,
  FontInstallFailure,
  FontInstallResult,
  FontLanguage,
  FontListResult,
  FontSource,
  SystemFontInfo
} from '@shared/ipc-api'
import { getStoredValue, setStoredValue } from './database'

const execFileAsync = promisify(execFile)
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc'])
const FONT_REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'

interface FontMetadata {
  family: string
  style: string
  /** OpenType name ID 6, used by Photoshop's text engine. */
  postScriptName: string
  languages: FontLanguage[]
}

interface RegistryFont {
  name: string
  value: string
  scope: 'system' | 'user'
}

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

interface CachedMetadata {
  signature: string
  metadata: FontMetadata
}

let managedMemory: FontManagerMemory | null = null
let writeQueue: Promise<void> = Promise.resolve()
const metadataCache = new Map<string, CachedMetadata>()

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

function decodeUtf16Be(buffer: Buffer): string {
  const evenLength = buffer.length - (buffer.length % 2)
  const swapped = Buffer.allocUnsafe(evenLength)
  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = buffer[index + 1]
    swapped[index + 1] = buffer[index]
  }
  return swapped.toString('utf16le').replace(/\0/g, '').trim()
}

function decodeName(platformId: number, buffer: Buffer): string {
  if (platformId === 0 || platformId === 3) return decodeUtf16Be(buffer)
  return buffer.toString('latin1').replace(/\0/g, '').trim()
}

function nameRank(platformId: number, languageId: number, nameId: number): number {
  // Name ID 6 is the PostScript name and is the most stable identifier for
  // Photoshop text layers. Prefer it over typographic family/subfamily names
  // while still retaining the latter as a fallback for older fonts.
  let rank = nameId === 6 ? 140 : nameId === 16 || nameId === 17 ? 100 : 0
  if (platformId === 3) rank += 50
  if (platformId === 0) rank += 40
  if ([0x0804, 0x0404, 0x0c04, 0x1004].includes(languageId)) rank += 20
  if (languageId === 0x0409) rank += 10
  return rank
}

function fallbackPostScriptName(family: string, style: string): string {
  const familyPart = family.replace(/[^A-Za-z0-9]+/g, '') || 'Arial'
  const normalizedStyle = style.trim().toLocaleLowerCase()
  if (!normalizedStyle || normalizedStyle === 'regular' || normalizedStyle === 'normal') {
    return `${familyPart}MT`
  }
  const stylePart = style.replace(/[^A-Za-z0-9]+/g, '') || 'Regular'
  return `${familyPart}-${stylePart}`
}

interface CoverageFlags {
  chinese: boolean
  japanese: boolean
  korean: boolean
  latin: boolean
  symbol: boolean
}

function rangeIntersects(
  start: number,
  end: number,
  targetStart: number,
  targetEnd: number
): boolean {
  return start <= targetEnd && end >= targetStart
}

function markCoverage(flags: CoverageFlags, start: number, end: number): void {
  if (
    rangeIntersects(start, end, 0x3400, 0x4dbf) ||
    rangeIntersects(start, end, 0x4e00, 0x9fff) ||
    rangeIntersects(start, end, 0xf900, 0xfaff) ||
    rangeIntersects(start, end, 0x20000, 0x323af)
  ) {
    flags.chinese = true
  }
  if (
    rangeIntersects(start, end, 0x3040, 0x30ff) ||
    rangeIntersects(start, end, 0x31f0, 0x31ff) ||
    rangeIntersects(start, end, 0xff66, 0xff9f)
  ) {
    flags.japanese = true
  }
  if (
    rangeIntersects(start, end, 0x1100, 0x11ff) ||
    rangeIntersects(start, end, 0x3130, 0x318f) ||
    rangeIntersects(start, end, 0xac00, 0xd7af)
  ) {
    flags.korean = true
  }
  if (rangeIntersects(start, end, 0x0020, 0x024f)) flags.latin = true
  if (
    rangeIntersects(start, end, 0x2600, 0x27bf) ||
    rangeIntersects(start, end, 0xe000, 0xf8ff) ||
    rangeIntersects(start, end, 0x1f000, 0x1faff)
  ) {
    flags.symbol = true
  }
}

export function classifyCmapCoverage(cmap: Buffer): FontLanguage[] {
  const flags: CoverageFlags = {
    chinese: false,
    japanese: false,
    korean: false,
    latin: false,
    symbol: false
  }
  if (cmap.length < 4) return ['other']

  const encodingCount = cmap.readUInt16BE(2)
  if (encodingCount > 1024 || 4 + encodingCount * 8 > cmap.length) return ['other']
  const subtableOffsets = new Set<number>()
  for (let index = 0; index < encodingCount; index += 1) {
    const recordOffset = 4 + index * 8
    const platformId = cmap.readUInt16BE(recordOffset)
    const encodingId = cmap.readUInt16BE(recordOffset + 2)
    if (platformId !== 0 && !(platformId === 3 && [1, 10].includes(encodingId))) continue
    const subtableOffset = cmap.readUInt32BE(recordOffset + 4)
    if (subtableOffset + 2 <= cmap.length) subtableOffsets.add(subtableOffset)
  }

  for (const subtableOffset of subtableOffsets) {
    const format = cmap.readUInt16BE(subtableOffset)
    if (format === 4 && subtableOffset + 16 <= cmap.length) {
      const length = cmap.readUInt16BE(subtableOffset + 2)
      const segmentCount = cmap.readUInt16BE(subtableOffset + 6) / 2
      const endCodeOffset = subtableOffset + 14
      const startCodeOffset = endCodeOffset + segmentCount * 2 + 2
      if (
        segmentCount > 0 &&
        segmentCount <= 32768 &&
        length >= 16 &&
        subtableOffset + length <= cmap.length &&
        startCodeOffset + segmentCount * 2 <= subtableOffset + length
      ) {
        for (let index = 0; index < segmentCount; index += 1) {
          const start = cmap.readUInt16BE(startCodeOffset + index * 2)
          const end = cmap.readUInt16BE(endCodeOffset + index * 2)
          if (start <= end && start !== 0xffff) markCoverage(flags, start, end)
        }
      }
    } else if ((format === 12 || format === 13) && subtableOffset + 16 <= cmap.length) {
      const length = cmap.readUInt32BE(subtableOffset + 4)
      const groupCount = cmap.readUInt32BE(subtableOffset + 12)
      if (
        groupCount <= 200000 &&
        length >= 16 &&
        subtableOffset + length <= cmap.length &&
        16 + groupCount * 12 <= length
      ) {
        for (let index = 0; index < groupCount; index += 1) {
          const groupOffset = subtableOffset + 16 + index * 12
          const start = cmap.readUInt32BE(groupOffset)
          const end = cmap.readUInt32BE(groupOffset + 4)
          if (start <= end) markCoverage(flags, start, end)
        }
      }
    }
  }

  const languages = (Object.keys(flags) as Array<keyof CoverageFlags>).filter(
    (language) => flags[language]
  )
  return languages.length > 0 ? languages : ['other']
}

async function readExactly(handle: FileHandle, length: number, position: number): Promise<Buffer> {
  if (length <= 0 || length > 8 * 1024 * 1024) {
    throw new Error('字体表长度异常')
  }
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, position)
  if (bytesRead !== length) throw new Error('字体文件不完整')
  return buffer
}

async function readFontMetadataUncached(filePath: string): Promise<FontMetadata> {
  const handle = await open(filePath, 'r')
  try {
    const header = await readExactly(handle, 12, 0)
    let faceOffset = 0
    if (header.toString('ascii', 0, 4) === 'ttcf') {
      const firstFaceOffset = await readExactly(handle, 4, 12)
      faceOffset = firstFaceOffset.readUInt32BE(0)
    }

    const faceHeader = await readExactly(handle, 12, faceOffset)
    const tableCount = faceHeader.readUInt16BE(4)
    if (tableCount === 0 || tableCount > 512) throw new Error('字体表数量异常')

    const tableDirectory = await readExactly(handle, tableCount * 16, faceOffset + 12)
    let nameOffset = -1
    let nameLength = 0
    let cmapOffset = -1
    let cmapLength = 0
    for (let index = 0; index < tableCount; index += 1) {
      const offset = index * 16
      const tag = tableDirectory.toString('ascii', offset, offset + 4)
      if (tag === 'name') {
        nameOffset = tableDirectory.readUInt32BE(offset + 8)
        nameLength = tableDirectory.readUInt32BE(offset + 12)
      } else if (tag === 'cmap') {
        cmapOffset = tableDirectory.readUInt32BE(offset + 8)
        cmapLength = tableDirectory.readUInt32BE(offset + 12)
      }
    }
    if (nameOffset < 0 || nameLength < 6) throw new Error('字体缺少名称信息')

    const nameTable = await readExactly(handle, nameLength, nameOffset)
    const recordCount = nameTable.readUInt16BE(2)
    const stringOffset = nameTable.readUInt16BE(4)
    if (recordCount > 4096 || 6 + recordCount * 12 > nameTable.length) {
      throw new Error('字体名称表异常')
    }

    const candidates = new Map<number, { value: string; rank: number }>()
    for (let index = 0; index < recordCount; index += 1) {
      const offset = 6 + index * 12
      const platformId = nameTable.readUInt16BE(offset)
      const languageId = nameTable.readUInt16BE(offset + 4)
      const nameId = nameTable.readUInt16BE(offset + 6)
      if (![1, 2, 6, 16, 17].includes(nameId)) continue

      const length = nameTable.readUInt16BE(offset + 8)
      const valueOffset = stringOffset + nameTable.readUInt16BE(offset + 10)
      if (valueOffset < 0 || valueOffset + length > nameTable.length) continue

      const value = decodeName(platformId, nameTable.subarray(valueOffset, valueOffset + length))
      if (!value) continue
      const rank = nameRank(platformId, languageId, nameId)
      const current = candidates.get(nameId)
      if (!current || rank > current.rank) candidates.set(nameId, { value, rank })
    }

    const family = candidates.get(16)?.value || candidates.get(1)?.value
    const style = candidates.get(17)?.value || candidates.get(2)?.value || 'Regular'
    if (!family) throw new Error('无法读取字体名称')
    const postScriptName =
      candidates.get(6)?.value?.replace(/\s+/g, '') || fallbackPostScriptName(family, style)
    let languages: FontLanguage[] = ['other']
    if (cmapOffset >= 0 && cmapLength >= 4) {
      try {
        languages = classifyCmapCoverage(await readExactly(handle, cmapLength, cmapOffset))
      } catch {
        // Name metadata remains useful even when a malformed cmap cannot be classified.
      }
    }
    return { family, style, postScriptName, languages }
  } finally {
    await handle.close()
  }
}

async function readFontMetadata(filePath: string): Promise<FontMetadata> {
  const snapshot = await stat(filePath)
  const key = resolve(filePath).toLocaleLowerCase()
  const signature = `${snapshot.size}:${snapshot.mtimeMs}`
  const cached = metadataCache.get(key)
  if (cached?.signature === signature) return cached.metadata

  const metadata = await readFontMetadataUncached(filePath)
  metadataCache.set(key, { signature, metadata })
  return metadata
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

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

async function runPowerShell(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true }
  )
  return stdout.trim()
}

async function queryRegistryFonts(): Promise<RegistryFont[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$rows = @()
$keys = @(
  @{ Path = 'Registry::HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'; Scope = 'system' },
  @{ Path = 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'; Scope = 'user' }
)
foreach ($key in $keys) {
  if (-not (Test-Path $key.Path)) { continue }
  $item = Get-ItemProperty -Path $key.Path
  foreach ($property in $item.PSObject.Properties) {
    if ($property.Name -like 'PS*' -or $property.Value -isnot [string]) { continue }
    $rows += [PSCustomObject]@{
      name = $property.Name
      value = [Environment]::ExpandEnvironmentVariables([string]$property.Value)
      scope = $key.Scope
    }
  }
}
ConvertTo-Json -InputObject @($rows) -Compress
`
  try {
    const output = await runPowerShell(script)
    if (!output) return []
    const parsed = JSON.parse(output) as RegistryFont[] | RegistryFont
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
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
  if (normalized.startsWith(resolve(userFontDirectory()).toLocaleLowerCase())) return 'user'
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

  const fonts = await mapWithConcurrency<string, SystemFontInfo | null>(
    [...allPaths.values()],
    12,
    async (filePath) => {
      try {
        const snapshot = await stat(filePath)
        if (!snapshot.isFile()) return null
      } catch {
        return null
      }

      const id = fontId(filePath)
      const managedRecord = memory.installed[id]
      const registryEntry = registryByPath.get(resolve(filePath).toLocaleLowerCase())
      let metadata: FontMetadata
      try {
        metadata = await readFontMetadata(filePath)
      } catch {
        const fallback = cleanRegistryName(registryEntry?.name || parse(filePath).name)
        metadata = {
          family: fallback,
          style: 'Regular',
          postScriptName: fallbackPostScriptName(fallback, 'Regular'),
          languages: ['other']
        }
      }

      const family = managedRecord?.family || metadata.family
      const style = managedRecord?.style || metadata.style
      const postScriptName =
        (managedRecord as Partial<ManagedFontRecord> | undefined)?.postScriptName ||
        metadata.postScriptName ||
        fallbackPostScriptName(family, style)
      const languages =
        managedRecord?.languages?.length > 0 ? managedRecord.languages : metadata.languages
      const managed = Boolean(managedRecord)
      return {
        id,
        family,
        style,
        postScriptName,
        displayName: managedRecord?.displayName || `${family} ${style}`.trim(),
        fileName: basename(filePath),
        filePath,
        format: fontFormat(filePath),
        source: sourceForPath(filePath, managed),
        managed,
        languages,
        installedAt: managedRecord?.installedAt
      }
    }
  )

  const availableFonts = fonts.filter((font): font is SystemFontInfo => font !== null)
  availableFonts.sort((left, right) =>
    left.family.localeCompare(right.family, 'zh-CN', { numeric: true, sensitivity: 'base' })
  )

  return { supported: true, fonts: availableFonts, scannedAt: Date.now() }
}

function registryDisplayName(
  metadata: FontMetadata,
  format: 'TTF' | 'OTF' | 'TTC',
  marker: string
): string {
  const style = /^regular$/i.test(metadata.style) ? '' : ` ${metadata.style}`
  const suffix = format === 'OTF' ? 'OpenType' : 'TrueType'
  // ⚠️ 这里的「嵌字工坊」**不是软件名，是写进 Windows 字体注册表的字体显示名的一部分**。
  // 2026-09-23 软件改名成「汉化工坊」时**刻意没动它**：一旦改了，
  // 用户此前用本软件装过的托管字体会对不上号（App 记录的旧名 ≠ 新名）→ 认不出、卸不掉。
  // 换句话说：**这不是漏改，是有意保留**。真要改，必须同时写一段"按旧名回认已装字体"的迁移。
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
    } catch {
      return candidate
    }
  }
  throw new Error('无法生成字体目标文件名')
}

function nativeFontScript(action: 'add' | 'remove', filePath: string): string {
  const safePath = filePath.replace(/'/g, "''")
  const method = action === 'add' ? 'AddFontResourceEx' : 'RemoveFontResourceEx'
  return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace QianziFontNative {
  public static class NativeMethods {
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    public static extern int AddFontResourceEx(string fileName, uint flags, IntPtr reserved);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    public static extern bool RemoveFontResourceEx(string fileName, uint flags, IntPtr reserved);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SendMessageTimeout(
      IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam,
      uint flags, uint timeout, out IntPtr result);
  }
}
'@
[void][QianziFontNative.NativeMethods]::${method}('${safePath}', 0, [IntPtr]::Zero)
$result = [IntPtr]::Zero
[void][QianziFontNative.NativeMethods]::SendMessageTimeout(
  [IntPtr]0xffff, 0x001D, [IntPtr]::Zero, [IntPtr]::Zero, 2, 2000, [ref]$result)
`
}

async function registerFont(record: ManagedFontRecord): Promise<void> {
  await execFileAsync(
    'reg.exe',
    [
      'add',
      FONT_REGISTRY_KEY,
      '/v',
      record.registryName,
      '/t',
      'REG_SZ',
      '/d',
      record.filePath,
      '/f'
    ],
    { windowsHide: true }
  )
  try {
    await runPowerShell(nativeFontScript('add', record.filePath))
  } catch (error) {
    try {
      await execFileAsync(
        'reg.exe',
        ['delete', FONT_REGISTRY_KEY, '/v', record.registryName, '/f'],
        { windowsHide: true }
      )
    } catch {
      // Preserve the original registration error.
    }
    throw error
  }
}

async function deleteUserRegistryValues(registryNames: string[]): Promise<void> {
  for (const registryName of registryNames) {
    try {
      await execFileAsync('reg.exe', ['delete', FONT_REGISTRY_KEY, '/v', registryName, '/f'], {
        windowsHide: true
      })
    } catch {
      // A missing registry value does not mean the font file survived.
    }
  }
}

async function unregisterFontFile(filePath: string, registryNames: string[]): Promise<void> {
  try {
    await runPowerShell(nativeFontScript('remove', filePath))
  } catch {
    // Continue: deleting the user font file is the authoritative uninstall step.
  }
  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await deleteUserRegistryValues(registryNames)
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
    try {
      const metadata = await readFontMetadata(sourcePath)
      destination = await uniqueDestination(sourcePath)
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL)
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
      await registerFont(record)
      memory.installed[id] = record
      installed.push({ ...record, source: 'managed', managed: true })
    } catch (error) {
      if (destination) {
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

  if (installed.length > 0) await saveManagedMemory(memory)
  return { canceled: false, installed, failed }
}

export async function uninstallUserFont(fontIdToRemove: string): Promise<FontActionResult> {
  const result = await uninstallUserFonts([fontIdToRemove])
  if (result.succeeded.includes(fontIdToRemove)) {
    return { ok: true, message: '字体已卸载' }
  }
  return {
    ok: false,
    message:
      result.failed.find((failure) => failure.fontId === fontIdToRemove)?.message || '卸载失败'
  }
}

function pathIsInside(directory: string, filePath: string): boolean {
  const normalizedDirectory = `${resolve(directory).toLocaleLowerCase()}\\`
  return resolve(filePath).toLocaleLowerCase().startsWith(normalizedDirectory)
}

export async function uninstallUserFonts(fontIds: string[]): Promise<FontBatchActionResult> {
  const uniqueIds = [...new Set(fontIds.filter((id) => typeof id === 'string' && id.length > 0))]
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
  let memoryChanged = false

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

    try {
      await unregisterFontFile(filePath, registryNames)
      metadataCache.delete(normalizedPath)
      if (managedRecord) {
        delete memory.installed[fontIdToRemove]
        memoryChanged = true
      }
      result.succeeded.push(fontIdToRemove)
    } catch (error) {
      try {
        await runPowerShell(nativeFontScript('add', filePath))
      } catch {
        // The original uninstall error is more useful to the user.
      }
      result.failed.push({
        fontId: fontIdToRemove,
        message: `卸载失败：${error instanceof Error ? error.message : String(error)}`
      })
    }
  }

  if (memoryChanged) await saveManagedMemory(memory)
  return result
}
