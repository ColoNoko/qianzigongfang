import { open, rename, link, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

/**
 * PSD 等生成产物的**安全发布**（2026-10-05 从并行分支 T6 移植）。
 *
 * 解决两个真实问题：
 *   1. **写一半失败截断原文件** —— 以前直接 `writeFile(outputPath, buffer)`，
 *      磁盘满/进程被杀会把上一份能用的 PSD 变成半截；现在先写**同目录**的独占临时文件
 *      （`wx` 独占创建 + fsync + 关闭），成功后才发布：覆盖模式 `rename` 原子替换，
 *      不覆盖模式 `link` 硬链接创建（目标已存在 ⇒ `EEXIST`，跳过而不是覆盖）。
 *      任何一步失败都清掉暂存文件，**原文件保持原样**。
 *   2. **检查后被人抢先写入的竞争** —— 以前"先 stat 判断不存在再写"在两次操作之间有窗口；
 *      现在"创建即判定"，同一目标的并发发布只允许一个成功。
 *
 * 返回 false = 不覆盖模式下目标已存在（调用方按"跳过"记账）。
 */
export async function publishOutput(
  path: string,
  bytes: Uint8Array,
  overwrite: boolean
): Promise<boolean> {
  const temporary = join(dirname(path), `.qianzi-output-${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (overwrite) await rename(temporary, path)
    else {
      try {
        await link(temporary, path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw error
      }
    }
    return true
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}
