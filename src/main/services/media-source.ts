import { open, stat, readFile } from 'node:fs/promises'
import { sameMedia, type MediaInfo } from '../../shared/media'

export async function mediaInfo(path: string): Promise<MediaInfo> {
  const info = await stat(path)
  if (!info.isFile() || info.size > 768 * 1024 * 1024)
    throw new Error('图源不存在或超过 768 MiB 读取限制')
  const file = await open(path, 'r')
  let estimatedBytes = Math.max(64 * 1024 * 1024, info.size * 16)
  try {
    const header = Buffer.alloc(64 * 1024)
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    if (bytesRead >= 26 && header.toString('ascii', 0, 4) === '8BPS') {
      const pixels = header.readUInt32BE(14) * header.readUInt32BE(18)
      if (!pixels || pixels * 4 > 512 * 1024 * 1024) throw new Error('PSD 尺寸超过解码限制')
      estimatedBytes = Math.max(32 * 1024 * 1024, info.size + pixels * 16)
    } else {
      let width = 0,
        height = 0
      if (bytesRead >= 24 && header.toString('ascii', 1, 4) === 'PNG') {
        width = header.readUInt32BE(16)
        height = header.readUInt32BE(20)
      } else if (bytesRead >= 10 && header.toString('ascii', 0, 3) === 'GIF') {
        width = header.readUInt16LE(6)
        height = header.readUInt16LE(8)
      } else if (bytesRead >= 26 && header.toString('ascii', 0, 2) === 'BM') {
        width = Math.abs(header.readInt32LE(18))
        height = Math.abs(header.readInt32LE(22))
      } else if (
        bytesRead >= 30 &&
        header.toString('ascii', 8, 12) === 'WEBP' &&
        header.toString('ascii', 12, 16) === 'VP8X'
      ) {
        width = header.readUIntLE(24, 3) + 1
        height = header.readUIntLE(27, 3) + 1
      } else if (header[0] === 255 && header[1] === 216) {
        let offset = 2
        while (offset + 9 < bytesRead) {
          if (header[offset] !== 255) break
          const marker = header[offset + 1]
          if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            height = header.readUInt16BE(offset + 5)
            width = header.readUInt16BE(offset + 7)
            break
          }
          const length = header.readUInt16BE(offset + 2)
          if (length < 2) break
          offset += length + 2
        }
      }
      if (width && height) {
        if (width * height * 4 > 512 * 1024 * 1024) throw new Error('图片尺寸超过解码限制')
        estimatedBytes = info.size + width * height * 12
      } else estimatedBytes = 768 * 1024 * 1024 // Unknown dimensions run alone.
    }
  } finally {
    await file.close()
  }
  return { size: info.size, mtimeMs: info.mtimeMs, estimatedBytes }
}

export async function readMedia(path: string, expected: MediaInfo): Promise<Uint8Array> {
  const before = await stat(path)
  if (!before.isFile() || !sameMedia(before, expected) || before.size > 768 * 1024 * 1024)
    throw new Error('源文件已更新，请重试')
  const bytes = await readFile(path, { signal: AbortSignal.timeout(20_000) })
  if (!sameMedia(await stat(path), expected)) throw new Error('源文件仍在写入，请稍后重试')
  return bytes
}
