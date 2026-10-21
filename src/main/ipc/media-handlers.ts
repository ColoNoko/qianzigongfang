import { mediaInfo, readMedia } from '../services/media-source'
import { coverSource } from '../services/cover-source'
import type { MediaInfo } from '../../shared/media'
import {
  readPsdThumbnailBytes,
  writePsdThumbnailBytes,
  invalidatePsdThumbnail
} from '../services/thumbnail-cache'
import { ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import { extname } from 'path'
import { readPsdThumbnailCache, writePsdThumbnailCache } from '../services/thumbnail-cache'
import { IPCError, mimeFromExt } from './support'

export function registerMediaHandlers(): void {
  ipcMain.handle('comicType:coverSource',(_,folder:string)=>coverSource(folder))
  ipcMain.handle('comicType:mediaInfo', (_, path: string) => mediaInfo(path))
  ipcMain.handle('comicType:readMedia', (_, path: string, info: MediaInfo) => readMedia(path, info))
  ipcMain.handle('comicType:readPsdThumbnailBytes', (_, path: string, mtime: number) =>
    readPsdThumbnailBytes(path, mtime)
  )
  ipcMain.handle(
    'comicType:writePsdThumbnailBytes',
    (_, path: string, mtime: number, bytes: Uint8Array, size?: number) =>
      writePsdThumbnailBytes(path, mtime, bytes, size)
  )
  ipcMain.handle('comicType:invalidatePsdThumbnail', (_, path: string, mtime: number) =>
    invalidatePsdThumbnail(path, mtime)
  )
  ipcMain.handle('comicType:readFileBuffer', async (_, absPath: string): Promise<ArrayBuffer> => {
    try {
      const buffer = await readFile(absPath)
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new IPCError('E_UNREADABLE', message)
    }
  })
  ipcMain.handle('comicType:readFileDataURL', async (_, absPath: string): Promise<string> => {
    try {
      const buffer = await readFile(absPath)
      const b64 = buffer.toString('base64')
      const mime = mimeFromExt(extname(absPath))
      return `data:${mime};base64,${b64}`
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new IPCError('E_UNREADABLE', message)
    }
  })
  ipcMain.handle(
    'comicType:readPsdThumbnailCache',
    async (_, psdPath: string, mtimeMs: number): Promise<string | null> =>
      readPsdThumbnailCache(psdPath, mtimeMs)
  )
  ipcMain.handle(
    'comicType:writePsdThumbnailCache',
    async (_, psdPath: string, mtimeMs: number, dataUrl: string): Promise<void> =>
      writePsdThumbnailCache(psdPath, mtimeMs, dataUrl)
  )
}
