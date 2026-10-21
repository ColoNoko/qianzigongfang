import type { JpgPsdPair } from '@shared/types'
import { basenameOf } from '@shared/paths'
const imageFile = /\.(?:jpe?g|png|webp|gif|bmp|avif|jfif)$/i
const key = (path: string) => path.replace(/\\/g, '/').toLocaleLowerCase()
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
/** Translation pages are original images, never PSD entries or PSD fallbacks. */
export function imageViewerPages(source: JpgPsdPair[], images: string[]): JpgPsdPair[] {
  const seen = new Set<string>()
  return images.filter(path => {
    if (!imageFile.test(path) || seen.has(key(path))) return false
    seen.add(key(path)); return true
  }).sort((a,b) => collator.compare(basenameOf(a), basenameOf(b)) || a.localeCompare(b))
    .map(path => {
      const original = source.find(pair => key(pair.jpgPath ?? '') === key(path))
      return { jpgPath: path, previewOnly: true, countsTowardProgress: false,
        psd: { absPath: path, status: 'none', mtimeMs: original?.psd.mtimeMs ?? 0, ctimeMs: 0 } }
    })
}
