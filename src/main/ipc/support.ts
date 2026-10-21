import { dirname, join } from 'path'

export class IPCError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'IPCError'
  }
}

export function labelPlusZipTempRoot(): string {
  const executableDirectory = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
  return join(executableDirectory, 'temp')
}

export function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.avif':
      return 'image/avif'
    case '.jfif':
      return 'image/jpeg'
    case '.psd':
      return 'image/vnd.adobe.photoshop'
    default:
      return 'application/octet-stream'
  }
}
