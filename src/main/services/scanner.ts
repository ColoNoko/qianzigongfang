import type { Stats } from 'fs'
import { readdir, stat, realpath } from 'fs/promises'
import { join, extname, basename, dirname, relative } from 'path'
import type { ChildProjectScan, JpgPsdPair, PsdEntry } from '@shared/types'
import { pairKeyOf } from '@shared/pair'

const MAX_DEPTH = 3
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.jfif'])
const PSD_EXT = '.psd'
const TXT_EXT = '.txt'

function getStem(filePath: string): string {
  return basename(filePath, extname(filePath))
}

/**
 * 配对键 —— 规则本身在 `@shared/pair`（2026-10-01 P2 收编）。
 * ⚠️ 这里只做转发：**别再往这个函数体里写规则**（对照视图那边也有一套同样的键，
 * 两边必须永远走同一个实现，否则"侧栏配好的对"与"对照视图显示的图"会不是同一张）。
 */
function getStemLookupKey(filePath: string): string {
  return pairKeyOf(filePath)
}

function getGroupKey(filePath: string): string {
  return join(dirname(filePath), getStem(filePath))
}

interface FileGroup {
  psd?: string
  txt?: string
}

function getCreatedTimeMs(stats: Stats): number {
  return Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0
    ? stats.birthtimeMs
    : stats.ctimeMs
}

export async function scanChildProject(absFolder: string): Promise<ChildProjectScan> {
  const jpgPairs: JpgPsdPair[] = []
  const imageFiles: string[] = []
  const txtFiles: string[] = []
  const errors: { path: string; msg: string }[] = []
  const visitedRealpaths = new Set<string>()

  // 章节根目录**自己**就不在：典型是用户在资源管理器里删掉/改名了整个章节文件夹。
  // 这只探测一次；下面的 walk() 仍会照常把 realpath 失败记进 errors，行为不变 ——
  // 新增的信息只用来区分"目录不在（预期状态）"与"读不到（真错误）"，好让界面
  // 分别用安静的状态提示和红色告警，而不是一律弹红字。
  let rootMissing = false
  try {
    await stat(absFolder)
  } catch {
    rootMissing = true
  }

  // Collect all relevant files by stem
  const groups = new Map<string, FileGroup>()
  const imagesByStem = new Map<string, string[]>()

  async function walk(dirPath: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      return
    }

    // Resolve realpath to detect symlink loops
    let resolvedPath: string
    try {
      resolvedPath = await realpath(dirPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({ path: dirPath, msg })
      return
    }

    if (visitedRealpaths.has(resolvedPath)) {
      return
    }
    visitedRealpaths.add(resolvedPath)

    let entries
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Skip permission errors silently but record them
      errors.push({ path: dirPath, msg })
      return
    }

    for (const entry of entries) {
      const entryPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const ext = extname(entry.name).toLowerCase()
      const key = getGroupKey(entryPath)

      if (!groups.has(key)) {
        groups.set(key, {})
      }
      const group = groups.get(key)!

      if (ext === PSD_EXT) {
        group.psd = entryPath
      } else if (IMAGE_EXTS.has(ext)) {
        const stem = getStemLookupKey(entryPath)
        imageFiles.push(entryPath)
        imagesByStem.set(stem, [...(imagesByStem.get(stem) ?? []), entryPath])
      } else if (ext === TXT_EXT) {
        group.txt = entryPath
      }
    }
  }

  await walk(absFolder, 0)

  // Build results from groups
  for (const [, group] of groups) {
    if (group.txt) {
      txtFiles.push(group.txt)
    }

    if (group.psd) {
      const jpgPath = pickMatchingImage(
        absFolder,
        group.psd,
        imagesByStem.get(getStemLookupKey(group.psd)) ?? []
      )

      let psdEntry: PsdEntry
      try {
        const s = await stat(group.psd)
        // 完成度只认手动标记（project_memory_files 的 mode_statuses_json）。
        // 这里刻意不按文件时间猜"已嵌字"：PSD 被动过 ≠ 嵌完了，而且译文导入
        // 刚生成的 PSD 会立刻被算成已完成，把统计污染成虚高。
        psdEntry = {
          absPath: group.psd,
          mtimeMs: s.mtimeMs,
          ctimeMs: getCreatedTimeMs(s),
          status: 'pending'
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push({ path: group.psd, msg })
        // Still create a PsdEntry with default/unknown values so the pair exists
        psdEntry = {
          absPath: group.psd,
          mtimeMs: 0,
          ctimeMs: 0,
          status: 'none'
        }
      }

      jpgPairs.push({ jpgPath, psd: psdEntry })
    }
  }

  if (jpgPairs.length === 0 && imageFiles.length > 0) {
    for (const imagePath of imageFiles) {
      try {
        const imageStat = await stat(imagePath)
        jpgPairs.push({
          jpgPath: imagePath,
          previewOnly: true,
          countsTowardProgress: true,
          psd: {
            absPath: imagePath,
            mtimeMs: imageStat.mtimeMs,
            ctimeMs: imageStat.mtimeMs,
            status: 'none'
          }
        })
      } catch (err) {
        errors.push({ path: imagePath, msg: err instanceof Error ? err.message : String(err) })
      }
    }
  } else if (jpgPairs.length > 0) {
    // 图少于 5 张时无法可靠按序号配对，全部 PSD 都计入进度；多于 5 张则只计有配对的。
    // 这里不再顺手把状态改成 done —— 完成度只由手动标记决定。
    const fewImages = imageFiles.length < 5
    const countAllPsdFiles = fewImages || imageFiles.length > 5
    for (const pair of jpgPairs) {
      pair.countsTowardProgress = countAllPsdFiles || Boolean(pair.jpgPath)
    }
  }

  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
  jpgPairs.sort((a, b) =>
    collator.compare(basename(a.jpgPath ?? a.psd.absPath), basename(b.jpgPath ?? b.psd.absPath))
  )
  imageFiles.sort((a, b) => collator.compare(basename(a), basename(b)))

  return { jpgPairs, imageFiles, txtFiles, errors, rootMissing }
}

function pickMatchingImage(
  rootFolder: string,
  psdPath: string,
  images: string[]
): string | undefined {
  if (images.length === 0) return undefined

  const psdDir = dirname(psdPath)
  const sorted = [...images].sort(
    (a, b) => imageRank(rootFolder, psdDir, a) - imageRank(rootFolder, psdDir, b)
  )
  return sorted[0]
}

function imageRank(rootFolder: string, psdDir: string, imagePath: string): number {
  const extRank = imageExtRank(imagePath)
  if (dirname(imagePath) === rootFolder) return extRank
  if (dirname(imagePath) === psdDir) return 100 + extRank
  return 200 + relative(rootFolder, imagePath).split(/[\\/]/).length * 10 + extRank
}

function imageExtRank(filePath: string): number {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
      return 0
    case '.jpeg':
      return 1
    case '.png':
      return 2
    case '.webp':
      return 3
    case '.gif':
      return 4
    case '.bmp':
      return 5
    case '.avif':
      return 6
    case '.jfif':
      return 7
    default:
      return 9
  }
}
