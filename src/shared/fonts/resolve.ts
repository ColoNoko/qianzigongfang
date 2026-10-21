import type { SystemFontInfo } from '../ipc-api'
import type { StandardFontRef } from '../labelplus-import'

export type FontResolution =
  { status: 'exact' | 'substitute'; font: SystemFontInfo } | { status: 'missing' }
/** Prefer the actual PostScript face over legacy path IDs, which may refer to a TTC file. */
export function resolveFont(reference: StandardFontRef, fonts: SystemFontInfo[]): FontResolution {
  const usable = fonts.filter((font) => Boolean(font.postScriptName))
  const normalized = (value: string) => value.trim().toLowerCase()
  const named =
    reference.postScriptName &&
    usable.find((font) => normalized(font.postScriptName) === normalized(reference.postScriptName))
  if (named) return { status: 'exact', font: named }
  const identity = usable.find(
    (font) =>
      font.id === reference.id &&
      normalized(font.family) === normalized(reference.family) &&
      normalized(font.style) === normalized(reference.style)
  )
  if (identity) return { status: 'substitute', font: identity }
  const family = usable.find(
    (font) =>
      normalized(font.family) === normalized(reference.family) &&
      normalized(font.style) === normalized(reference.style)
  )
  return family ? { status: 'substitute', font: family } : { status: 'missing' }
}
export function fontReference(font: SystemFontInfo): StandardFontRef {
  if (!font.postScriptName) throw new Error('该字体缺少真实 PostScript 名，无法用于 PSD 文字层')
  return {
    id: font.id,
    family: font.family,
    style: font.style,
    postScriptName: font.postScriptName,
    filePath: font.filePath
  }
}
