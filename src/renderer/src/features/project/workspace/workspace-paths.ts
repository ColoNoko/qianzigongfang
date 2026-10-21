/**
 * workspace 用到的路径 / 键工具（纯函数）。
 *
 * P6（2026-10-05）从 `stores/projectWorkspace.ts` 拆出：**纯搬家**。
 * 唯一的机械改动是**每段开头加了一个 `export `**（它们原本是那个文件的模块私有函数），
 * 函数体本身逐字节未改。
 * ⚠️ 这里的 `basename` / `extname` 与 `@shared/paths.ts` 的 `basenameOf` **不是**同一套语义
 * （本文件的 `extname` 收的是"文件名"而不是完整路径）。本批**只搬家、不合并** ——
 * 合并属于"改行为"，要单独论证（§13 第 21 条）。
 */
import { lastPathSegment } from '@shared/paths'

export function basename(absPath: string): string {
  return lastPathSegment(absPath, absPath)
}

export function extname(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

export function normalizePathForLookup(absPath: string): string {
  return absPath.replace(/\\/g, '/').normalize('NFC').toLocaleLowerCase()
}

export function parentFolderPath(absPath: string): string {
  const normalized = normalizePathForLookup(absPath).replace(/\/+$/, '')
  const separator = normalized.lastIndexOf('/')
  return separator > 0 ? normalized.slice(0, separator) : normalized
}
