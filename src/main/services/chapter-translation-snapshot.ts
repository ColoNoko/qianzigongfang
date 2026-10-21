import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { ChapterTranslationFingerprint } from '@shared/chapter-translation'

/** Content and SHA256 must describe one byte snapshot, never separate reads. */
export async function readChapterTranslationSnapshot(
  filePath: string,
  fileStat?: { mtimeMs: number }
): Promise<{ bytes: Buffer; fingerprint: ChapterTranslationFingerprint }> {
  const info = fileStat ?? await stat(filePath)
  const bytes = await readFile(filePath)
  return {
    bytes,
    fingerprint: {
      size: bytes.length,
      mtimeMs: info.mtimeMs,
      sha256: createHash('sha256').update(bytes).digest('hex')
    }
  }
}
