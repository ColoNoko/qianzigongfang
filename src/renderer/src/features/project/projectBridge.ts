/**
 * 「工作台」页的 IPC 适配层（P7 之四，2026-10-05）。
 *
 * 搬走 `views/Project.vue` 里最后 **3 处** `window.comicType`：
 * 「最近打开过的话」的读与写，以及"在系统里打开这一话的文件夹"。
 * 搬完之后 `views/` 里就再没有一处直接调 IPC 了（分层尺子见 §13 第 20 条）。
 *
 * 规矩与 `features/import/importBridge.ts` 一致 —— 但**有一处刻意不同**：
 * 那边对可选通道加了"守卫 + 中性返回"（因为原代码本来就有那道守卫）；
 * 这边的三处原代码**没有**守卫、而是各自包在 `try/catch` 里，
 * 所以这里也**不加守卫** —— 加了会把"后台缺通道"从"被 catch 住"变成"静默什么都不做"，
 * 那是改行为。调用方的 `try/catch` 原样保留。
 */
import type { OpenPathResult } from '@shared/ipc-api'

/** 「最近打开过的话」在键值表里的 key（与旧的散写处保持同一个字符串）。 */
const RECENT_PROJECT_IDS_KEY = 'recentProjectIds'

/** 读最近打开过的话。读取失败由调用方决定怎么处理（原样往上传）。 */
export function readRecentProjectIds(): Promise<unknown> {
  return window.comicType.storeGet(RECENT_PROJECT_IDS_KEY)
}

/** 写最近打开过的话（最多 3 条，由调用方裁好再传进来）。 */
export function writeRecentProjectIds(ids: string[]): Promise<void> {
  return window.comicType.storeSet(RECENT_PROJECT_IDS_KEY, ids)
}

/** 在系统里打开一个路径（这里用于"打开这一话的文件夹"）。 */
export function openFolderInSystem(path: string): Promise<OpenPathResult> {
  return window.comicType.openPath(path)
}
