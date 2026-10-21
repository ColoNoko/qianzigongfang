import { cmapRanges } from './coverage'
import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { FontLanguage } from '@shared/ipc-api'
import { fontFaceCss } from '@shared/font-style'
export interface FontMetadata {
  faceIndex: number
  family: string
  style: string
  postScriptName: string
  languages: FontLanguage[]
  weight: number
  italic: boolean
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
  for (const [start, end] of cmapRanges(cmap) ?? []) markCoverage(flags, start, end)

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

export async function parseFontFile(filePath: string): Promise<FontMetadata[]> {
  const handle = await open(filePath, 'r')
  try {
    const header = await readExactly(handle, 12, 0)
    const faces: FontMetadata[] = []
    let offsets = [0]
    if (header.toString('ascii', 0, 4) === 'ttcf') {
      const count = header.readUInt32BE(8)
      if (count < 1 || count > 256) throw new Error('字体集合数量异常')
      const directory = await readExactly(handle, count * 4, 12)
      offsets = Array.from({ length: count }, (_, index) => directory.readUInt32BE(index * 4))
    }

    for (const [faceIndex, faceOffset] of offsets.entries()) {
      const faceHeader = await readExactly(handle, 12, faceOffset)
      if (![0x00010000, 0x4f54544f, 0x74727565].includes(faceHeader.readUInt32BE(0)))
        throw new Error('不支持的字体签名')
      const tableCount = faceHeader.readUInt16BE(4)
      if (tableCount === 0 || tableCount > 512) throw new Error('字体表数量异常')

      const tableDirectory = await readExactly(handle, tableCount * 16, faceOffset + 12)
      let nameOffset = -1
      let nameLength = 0
      let cmapOffset = -1
      let cmapLength = 0
      let os2Offset = -1
      let os2Length = 0
      for (let index = 0; index < tableCount; index += 1) {
        const offset = index * 16
        const tag = tableDirectory.toString('ascii', offset, offset + 4)
        if (tag === 'name') {
          nameOffset = tableDirectory.readUInt32BE(offset + 8)
          nameLength = tableDirectory.readUInt32BE(offset + 12)
        } else if (tag === 'OS/2') {
          os2Offset = tableDirectory.readUInt32BE(offset + 8)
          os2Length = tableDirectory.readUInt32BE(offset + 12)
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
      const postScriptName = /^[\x21-\x7e]+$/.test(candidates.get(6)?.value ?? '')
        ? candidates.get(6)!.value
        : ''
      let languages: FontLanguage[] = ['other']
      if (cmapOffset >= 0 && cmapLength >= 4) {
        try {
          languages = classifyCmapCoverage(await readExactly(handle, cmapLength, cmapOffset))
        } catch {
          // Name metadata remains useful even when a malformed cmap cannot be classified.
        }
      }
      let weight = fontFaceCss({ font: { style }, fauxBold: false, fauxItalic: false }).weight
      let italic = /italic|oblique/i.test(style)
      if (os2Offset >= 0 && os2Length >= 64) {
        const os2 = await readExactly(handle, 64, os2Offset)
        const declaredWeight = os2.readUInt16BE(4)
        if (declaredWeight >= 1 && declaredWeight <= 1000) weight = declaredWeight
        italic = Boolean(os2.readUInt16BE(62) & 0x201)
      }
      faces.push({ faceIndex, family, style, postScriptName, languages, weight, italic })
    }
    return faces
  } finally {
    await handle.close()
  }
}
