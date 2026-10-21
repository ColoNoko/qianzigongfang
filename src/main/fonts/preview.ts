import { cmapRanges } from './coverage'
import type { FontPreviewResult } from '@shared/ipc-api'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { create } from 'fontkit'
import { readPreview, writePreview } from '../services/preview-cache'

function checksum(bytes: Buffer): number {
  let value = 0
  for (let offset = 0; offset < bytes.length; offset += 4) {
    let word = 0
    for (let i = 0; i < 4; i++) word = ((word << 8) | (bytes[offset + i] ?? 0)) >>> 0
    value = (value + word) >>> 0
  }
  return value
}
/** Extract only the selected collection face. Originals are never rewritten. */
export function extractFontFace(bytes: Buffer, faceIndex: number): Buffer {
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || bytes.length < 12)
    throw new Error('字体索引无效')
  if (bytes.toString('ascii', 0, 4) !== 'ttcf') {
    if (faceIndex !== 0) throw new Error('字体索引越界')
    return bytes
  }
  const count = bytes.readUInt32BE(8)
  if (count > 256 || faceIndex >= count || 12 + count * 4 > bytes.length)
    throw new Error('字体集合无效')
  const start = bytes.readUInt32BE(12 + faceIndex * 4)
  if (start + 12 > bytes.length) throw new Error('字体集合不完整')
  const tables = bytes.readUInt16BE(start + 4)
  if (tables < 1 || tables > 512 || start + 12 + tables * 16 > bytes.length)
    throw new Error('字体表无效')
  const records: { tag: string; data: Buffer }[] = []
  for (let i = 0; i < tables; i++) {
    const at = start + 12 + i * 16
    const tag = bytes.toString('ascii', at, at + 4)
    const offset = bytes.readUInt32BE(at + 8),
      length = bytes.readUInt32BE(at + 12)
    if (offset + length > bytes.length) throw new Error('字体表越界')
    if (tag !== 'DSIG')
      records.push({ tag, data: Buffer.from(bytes.subarray(offset, offset + length)) })
  }
  // OpenType sorts by raw tag bytes, not locale collation.
  records.sort((a, b) => Buffer.compare(Buffer.from(a.tag), Buffer.from(b.tag)))
  const headerSize = 12 + records.length * 16
  const size = headerSize + records.reduce((total, r) => total + ((r.data.length + 3) & ~3), 0)
  if (size > 128 * 1024 * 1024) throw new Error('字体预览体积过大')
  const output = Buffer.alloc(size)
  bytes.copy(output, 0, start, start + 4)
  output.writeUInt16BE(records.length, 4)
  const selector = Math.floor(Math.log2(records.length))
  output.writeUInt16BE(16 * 2 ** selector, 6)
  output.writeUInt16BE(selector, 8)
  output.writeUInt16BE(records.length * 16 - 16 * 2 ** selector, 10)
  let offset = headerSize,
    headOffset = -1
  records.forEach((record, index) => {
    const at = 12 + index * 16
    if (record.tag === 'head' && record.data.length >= 12) {
      record.data.writeUInt32BE(0, 8)
      headOffset = offset
    }
    output.write(record.tag, at, 4, 'ascii')
    output.writeUInt32BE(checksum(record.data), at + 4)
    output.writeUInt32BE(offset, at + 8)
    output.writeUInt32BE(record.data.length, at + 12)
    record.data.copy(output, offset)
    offset += (record.data.length + 3) & ~3
  })
  if (headOffset >= 0) output.writeUInt32BE((0xb1b0afba - checksum(output)) >>> 0, headOffset + 8)
  return output
}
export async function fontPreview(path: string, faceIndex = 0, sampleOnly = false): Promise<FontPreviewResult> {
  if (typeof path !== 'string' || !['.ttf', '.otf', '.ttc'].includes(extname(path).toLowerCase()))
    throw new Error('不是支持的字体文件')
  const file = await stat(path)
  if (!file.isFile() || file.size > 128 * 1024 * 1024) throw new Error('字体预览体积过大')
  const revision = `${file.mtimeMs}:${file.size}:glyph-v2`
  const kind = `font-glyphs:${faceIndex}`
  if (sampleOnly) {
    const cached = readPreview(kind,path,revision)
    if (cached) { try { return {...JSON.parse(cached.payload.toString()),buffer:new ArrayBuffer(0)} } catch { /* regenerate corrupt cache */ } }
  }
  const face = extractFontFace(
    await readFile(path, { signal: AbortSignal.timeout(20_000) }),
    faceIndex
  )
  const after = await stat(path)
  if (after.size !== file.size || after.mtimeMs !== file.mtimeMs)
    throw new Error('字体文件已变化，请刷新重试')
  let coverage: Array<[number, number]> | null = null
  if (face.length >= 12) {
    const count = face.readUInt16BE(4)
    for (let i = 0; i < count && 12 + (i + 1) * 16 <= face.length; i++) {
      const at = 12 + i * 16
      if (face.toString('ascii', at, at + 4) !== 'cmap') continue
      const offset = face.readUInt32BE(at + 8),
        length = face.readUInt32BE(at + 12)
      if (offset + length <= face.length)
        coverage = cmapRanges(face.subarray(offset, offset + length))
    }
  }
  if (sampleOnly) {
    const font = create(face)
    if (!('glyphForCodePoint' in font)) throw new Error('无法读取字体字形')
    let advance=0,left=0,right=0,top=font.ascent,bottom=font.descent
    const glyphs = Array.from('嵌字工坊 字体预览 123 ABC').map(text => {
      const glyph = font.glyphForCodePoint(text.codePointAt(0)!)
      if (glyph.bbox) {
        left=Math.min(left,advance+glyph.bbox.minX)
        right=Math.max(right,advance+glyph.bbox.maxX)
        top=Math.max(top,glyph.bbox.maxY)
        bottom=Math.min(bottom,glyph.bbox.minY)
      }
      advance+=glyph.advanceWidth
      return {text,path:glyph.path.toSVG(),width:glyph.advanceWidth}
    })
    const padding=font.unitsPerEm*.04
    const bounds={left:left-padding,top:top+padding,width:Math.max(advance,right)-left+padding*2,height:top-bottom+padding*2}
    const result = {glyphs,bounds,unitsPerEm:font.unitsPerEm,ascent:font.ascent,descent:font.descent,coverage}
    writePreview(kind,path,revision,Buffer.from(JSON.stringify(result)))
    return {...result,buffer:new ArrayBuffer(0)}
  }
  return { buffer: Uint8Array.from(face).buffer, coverage }
}
