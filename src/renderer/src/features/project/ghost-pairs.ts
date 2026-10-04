import type { ProjectMemory } from '@shared/ipc-api'
import type { JpgPsdPair } from '@shared/types'

/**
 * 目录不在了（被删掉 / 被改名）时，用台账里"最后一次已知"的文件记录合成这一话。
 *
 * 为什么需要它：用户经常整理本地文件，把某一话整个文件夹删掉是**日常操作**。
 * 在那之前，工作台只会是一片空白 + 一行红色报错 —— 而同一话的进度明明还在侧栏
 * 显示着 24/24（它取自数据库，不受文件系统影响）。现在改成：把台账里的每一页
 * 照原样摆出来，进度与各模式标记都按历史记录显示。
 *
 * 三条硬约束（改这个函数时别破坏）：
 *
 * 1. **只读**：这些 pair 只用于显示，绝不写回。调用方是在 `scanChild()` 抛错之后
 *    走这条路的，而那条路径从设计上就不落任何缓存 —— 见 projectWorkspace 里
 *    「0 页 + 有错误 ≠ 这一话有 0 个文件」那段注释。
 *
 * 2. `countsTowardProgress: true` **必须显式给**：`isCountablePair()` 在未显式指定时
 *    要求 `jpgPath` 非空，而台账里只有 PSD 路径。不显式打开的话这一话会被判成
 *    "0 页"，头部/底部立刻显示 0/0 —— 恰好是想避免的那种误导。
 *
 * 3. 调用方必须同时禁用**标记**与**卡片动作**：文件已不在本地，标记会往台账里写下
 *    无意义的记录，卡片动作只会报"打开失败"。
 */
export function ghostPairsFromMemory(memory: ProjectMemory | null | undefined): JpgPsdPair[] {
  if (!memory) return []

  return Object.values(memory.files)
    .map((file) => ({
      psd: {
        absPath: file.path,
        mtimeMs: file.mtimeMs,
        // 台账只记了 mtime。ctime 仅参与排序与派生编码，这一话已经不在本地，
        // 同值即可，不需要（也无法）还原真实的创建时间。
        ctimeMs: file.mtimeMs,
        status: file.status,
        modes: file.modes,
        modeTimestamps: file.modeTimestamps
      },
      countsTowardProgress: true
    }))
    .sort((a, b) => a.psd.absPath.localeCompare(b.psd.absPath))
}
