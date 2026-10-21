import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { ChildProjectScan } from '@shared/types'

/**
 * 章节"内容指纹"（2026-10-05 从 0.4.0 移植）。
 *
 * 取 `imageFiles + txtFiles` 的（路径、大小、mtime）做 sha256 —— **不含 PSD**：
 * 译文导入只改 PSD，而原图 / TXT 变了同样意味着"这一话的内容变了"，
 * 目录监听拿它判断"到底变没变"，而不是任何文件动一下都全量重扫。
 *
 * ⚠️ 结果会带进"文件不可用"的信息（`unavailable` + 原因）：文件刚被删 / 网络盘
 * 掉线时指纹必然和上一次不同 —— 这正是调用方想要的"变了，去重扫"信号。
 * 本函数**不修改** `scan`（不往 `errors` 里塞东西）。
 */
/** 指纹内核：对给定文件列表取（路径、大小、mtime）的 sha256（去重 + 排序，与顺序无关）。 */
async function computeFileSetFingerprint(
  files: readonly string[],
  root?: string,
  legacyRoot?: string
): Promise<string> {
  const paths = [...new Set(files)].sort()
  const hash = createHash('sha256')
  for (let offset = 0; offset < paths.length; offset += 16) {
    const versions = await Promise.all(
      paths.slice(offset, offset + 16).map(async (file) => {
        try {
          const value = await stat(file)
          const name = root
            ? legacyRoot
              ? resolve(legacyRoot, relative(root, file))
              : relative(root, file).replace(/\\/g, '/')
            : file
          return [name, value.size, value.mtimeMs]
        } catch (error) {
          return [file, 'unavailable', error instanceof Error ? error.message : String(error)]
        }
      })
    )
    hash.update(JSON.stringify(versions))
  }
  return hash.digest('hex')
}

/** 原图 + TXT 的指纹（目录监听的"内容变了没"判据；**不含 PSD**，语义别改）。 */
export function computeSourceRevision(scan: ChildProjectScan): Promise<string> {
  return computeFileSetFingerprint([...(scan.imageFiles ?? []), ...scan.txtFiles])
}

/**
 * **全部**文件（PSD + 原图 + TXT）的指纹（2026-10-05，R1）—— 只给"改名认领"比对用。
 *
 * ⚠️ 为什么必须含 PSD：只有 PSD 的话（没有原图/TXT）在 `computeSourceRevision` 里
 * 会退化成"空集合的 sha256"（同一个常量）⇒ 两个只有 PSD 的话会被误判成"同一份"。
 */
// root 使用章节相对路径；legacyRoot 仅用于匹配旧版存储的绝对路径指纹。
export function computeIdentityFingerprint(
  scan: ChildProjectScan,
  root?: string,
  legacyRoot?: string
): Promise<string> {
  return computeFileSetFingerprint(
    [
      ...scan.jpgPairs.filter((pair) => !pair.previewOnly).map((pair) => pair.psd.absPath),
      ...(scan.imageFiles ?? []),
      ...scan.txtFiles
    ],
    root,
    legacyRoot
  )
}
