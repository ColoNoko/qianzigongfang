/**
 * 字体管理那组通道的渲染侧适配层（P7 之五，2026-10-05）。
 *
 * 主进程侧对应的是 `services/font-manager.ts` 那一组；
 * 渲染侧只有「字体」这一页在用，所以单独一个域。
 *
 * ⚠️ 函数名**刻意与主进程侧的服务同名**（`listSystemFonts` / `installUserFonts` /
 * `uninstallUserFont` / `uninstallUserFonts`）—— 不只是好看：`FontManager.vue` 里
 * 本来就有同名的本地函数 `installFonts()` / `uninstallFont(font)`，第一次我起名 `installFonts`
 * 直接撞名，vue-tsc 当场报 TS2440，而且第 333 行那句 `await installFonts()` **变成了调用它自己**
 * （无限递归）—— 改名之后才干净。**桥的导出名要避开视图里的本地名。**
 */
import type {
  FontActionResult,
  FontBatchActionResult,
  FontInstallResult,
  FontListResult
} from '@shared/ipc-api'

/** 系统字体清单（非 Windows 会返回 `supported: false`）。 */
export function listSystemFonts(): Promise<FontListResult> {
  return window.comicType.fontList()
}

/** 打开"安装字体"的文件选择框并安装。取消返回 `canceled: true`。 */
export function installUserFonts(): Promise<FontInstallResult> {
  return window.comicType.fontInstall()
}

/** 卸载一个用户字体。 */
export function uninstallUserFont(fontId: string): Promise<FontActionResult> {
  return window.comicType.fontUninstall(fontId)
}

/** 批量卸载。 */
export function uninstallUserFonts(fontIds: string[]): Promise<FontBatchActionResult> {
  return window.comicType.fontUninstallMany(fontIds)
}
