/**
 * 章节译文 —— 从"话自己的目录"里现扫一份 LabelPlus txt 并解析（P1「译文对照」的数据源）。
 *
 * ## 为什么在这个位置
 *
 * 读目录 / 读文件是主进程的活（渲染层没有 fs）。但**规则**不在这一层：
 * 排序（取最新）与"这一页对应哪一条"都在 `@shared/chapter-translation` 的纯函数里，
 * 这里只负责"把目录扫出来、按顺序试、把结果说成人话"。
 *
 * ## 三条纪律（用户拍板）
 *
 * 1. **不落库**：每次现扫现读，不写数据库、不记路径 —— 所以没有迁移，也不会"记错了路径"。
 * 2. **只扫一层**：`backup/` 这类子目录里的 txt 不算这一话的译文（与扫描器扫图的深度规则无关，
 *    译文只认"话目录这一层"——那是 LabelPlusFX 放 txt 的地方）。
 * 3. **绝不抛**：找不到译文是常态，返回 `not-found` 让界面说句事实就行；
 *    只有目录本身读不了才是 `error`。
 */
import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  CHAPTER_TRANSLATION_MAX_ATTEMPTS,
  rankChapterTranslationCandidates,
  type ChapterTranslationCandidate,
  type ChapterTranslationReadResult
} from '@shared/chapter-translation'
import { readLabelPlusFileSnapshot } from './labelplus-parser'

const TXT_EXT = '.txt'

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 读这一话的 LabelPlus 译文。
 *
 * @param folderPath 话自己的目录（`ChildProject.folderPath`）。
 */
export async function readChapterTranslation(
  folderPath: string
): Promise<ChapterTranslationReadResult> {
  const folder = typeof folderPath === 'string' ? folderPath.trim() : ''
  if (!folder) {
    return {
      status: 'error',
      file: null,
      txtCount: 0,
      message: '读不了话目录：路径为空',
      document: null
    }
  }

  const txtNames: string[] = []
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name).toLocaleLowerCase() === TXT_EXT) {
        txtNames.push(entry.name)
      }
    }
  } catch (error) {
    return {
      status: 'error',
      file: null,
      txtCount: 0,
      message: `读不了话目录：${describeError(error)}`,
      document: null
    }
  }
  const txtCount = txtNames.length

  // 取 mtime 才能排"谁最新"。拿到不 stat 的（正被占用 / 刚被删）就跳过它。
  const candidates: ChapterTranslationCandidate[] = []
  for (const name of txtNames) {
    const path = join(folder, name)
    try {
      const info = await stat(path)
      candidates.push({ path, name, mtimeMs: info.mtimeMs })
    } catch {
      // 跳过：它的 mtime 无从得知，排序里不该出现"未知时间"的候选
    }
  }

  const ranked = rankChapterTranslationCandidates(candidates, CHAPTER_TRANSLATION_MAX_ATTEMPTS)
  if (ranked.length === 0) {
    return {
      status: 'not-found',
      file: null,
      txtCount,
      message:
        txtCount === 0
          ? '话目录里没有 .txt 文件'
          : `话目录里有 ${txtCount} 份 txt，但一份都读不到（可能正被占用）`,
      document: null
    }
  }

  // 从最新往下试：认不认它是 LabelPlus 文本，**只看能不能解析成功**（不按文件名猜）。
  let firstFailure = ''
  for (const candidate of ranked) {
    try {
      const { document, fingerprint } = await readLabelPlusFileSnapshot(candidate.path)
      return {
        status: 'ok',
        file: {
          path: candidate.path,
          name: candidate.name,
          mtimeMs: fingerprint.mtimeMs,
          size: fingerprint.size,
          sha256: fingerprint.sha256
        },
        txtCount,
        message: '',
        document
      }
    } catch (error) {
      if (!firstFailure) firstFailure = describeError(error)
    }
  }

  return {
    status: 'not-found',
    file: null,
    txtCount,
    message: `找到 ${txtCount} 份 txt，但没有一份能当 LabelPlus 文本读（最近一份：${firstFailure}）`,
    document: null
  }
}
