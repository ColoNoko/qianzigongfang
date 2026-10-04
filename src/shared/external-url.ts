/**
 * 外部网址的"白名单"规则 + 项目里用到的固定外链。
 *
 * 为什么要单独一个纯函数：渲染进程能把任意字符串交给主进程去 `shell.openExternal`，
 * 所以**放行规则必须在主进程侧、并且是个能被单测盯住的纯函数** ——
 * 只放行 `http` / `https`，挡掉 `file://`（读本地文件）、`javascript:`、
 * 以及各种畸形字符串。做法与 `shared/ipc-guard.ts` 同源（纯函数 + 单测）。
 *
 * 注意：这里是"协议白名单"而不是"域名白名单" —— 以后再加别的外链
 * （帮助文档、npmmirror 之类）不用改这个文件。
 */

/** 识字网（字体识别与字体下载）。字体页上那个「识字网」按钮就指向它。 */
export const FONT_IDENTIFY_SITE = 'https://www.qiuziti.com/'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * 把一个候选字符串规范化成可打开的外链；不合格返回 `null`。
 *
 * - 两端空白先去掉（用户从别处粘贴常常带空格）
 * - 必须能被 `URL` 解析，且协议在 `http` / `https` 之内
 * - 返回 `URL.toString()`（协议与主机名会被规范化，例如 `HTTP://X` → `http://x/`）
 */
export function normalizeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null
  return parsed.toString()
}
