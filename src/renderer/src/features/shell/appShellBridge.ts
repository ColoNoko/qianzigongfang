/**
 * 「应用外壳」那组通道的渲染侧适配层（P7 之五，2026-10-05）。
 *
 * 域名刻意与主进程侧**同名对齐** —— 那边 P5 拆出来的就是 `src/main/ipc/app-shell.ts`
 * （对话框 / 打开 / 启动 / 更新检查）。两边同一套分域，找人找事都按同一个词走。
 *
 * 为什么单独一个文件而不是各页各写一份：`openExternal` 与 `openPath` 被
 * **三个** view 用到（设置 / 字体 / 预览窗）。§13 第 21 条：同一条规则只允许一处实现 ——
 * 三个薄包装各写一遍，就是三份"哪天改通道名要一起改"的债。
 *
 * 规矩与另外两个桥一致：**薄直通、调用时读 `window.comicType`、不额外加守卫**
 * （这几处的原代码都没有 `typeof ... !== 'function'` 守卫，各自包在 `try/catch` 里）。
 */
import type { OpenPathResult, StatSnap, ToolFileKind, UpdateCheckResult } from '@shared/ipc-api'

/** 用系统默认程序打开一个 URL（白名单在主进程侧执行）。 */
export function openExternalUrl(url: string): Promise<OpenPathResult> {
  return window.comicType.openExternal(url)
}

/** 用系统默认程序打开一个路径（文件或文件夹）。 */
export function openPathInSystem(path: string): Promise<OpenPathResult> {
  return window.comicType.openPath(path)
}

/** 选一个外部工具文件（可执行程序 / PS 脚本）。取消返回 `null`。 */
export function pickToolFile(kind: ToolFileKind): Promise<string | null> {
  return window.comicType.pickToolFile(kind)
}

/** 取一个路径的快照（用来判断"派生出来的 Photoshop 路径是否真的存在"）。 */
export function statPath(absPath: string): Promise<StatSnap> {
  return window.comicType.stat(absPath)
}

/** 检查更新（只读网络；失败一律变成 `failed` 状态，不抛）。 */
export function checkForUpdate(): Promise<UpdateCheckResult> {
  return window.comicType.checkForUpdate()
}

/** 关掉预览窗自己的那个窗口。 */
export function closeCurrentWindow(): Promise<void> {
  return window.comicType.closeCurrentWindow()
}
