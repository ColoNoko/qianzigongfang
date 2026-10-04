/**
 * 「检查更新」的口径（2026-10-04）。
 *
 * **这一版只做"发现新版本 + 引导去下载"**（作者拍板的 C3 方案）：
 * 不下载、不替换、不重启 —— 也就不需要签名、不会被杀软拦。
 * 纯函数、无副作用、不碰文件系统；网络那一半在主进程
 * （`main/services/update-check.ts`），这里只管"怎么比、怎么认"。
 *
 * ⚠️ 地址只有**这一处**定义。换成别的仓/别的域名时改这里即可，
 *    `update.spec.ts` 有锁盯着它们必须是 https 的 Gitee 地址。
 */

/** 公开仓（门面）—— 源码公开、发行包放 Releases。 */
const PUBLIC_REPO = 'https://gitee.com/Luo-yuan-z/qianzi-gongfang'

/**
 * 版本清单地址（Gitee 原始文件，跟着 `main` 分支走）。
 * ⚠️ 为什么放仓库里而不是 Releases 附件：Gitee 的 Release 附件直链**会变**，
 *    而"raw 文件"的地址稳定；清单里再指向真正的下载地址。
 */
export const UPDATE_MANIFEST_URL = `${PUBLIC_REPO}/raw/main/latest.json`

/** 下载页（清单里没给 url 时的兜底，也是"去下载"最坏情况的落点）。 */
export const UPDATE_DOWNLOAD_PAGE_URL = `${PUBLIC_REPO}/releases`

/** 远端版本清单的形状（`latest.json`）。 */
export interface UpdateManifest {
  /** 必须长得像版本号（`1.2.3` / `v1.2.3`）。 */
  version: string
  /** 更新说明（给人看的一两句话）。 */
  notes: string
  /** 下载地址：**必须 https**（http / file / javascript 一律不认）。 */
  url: string
  /** 可选：产物 sha256（校验用；这一版只显示不校验）。 */
  sha256?: string
  /** 可选：产物字节数。 */
  size?: number
}

/** `v1.2.3` / `1.2.3 / 1.2` → `[1,2,3]`；非数字段当 0（`1.0.0-beta` ≈ 1.0.0）。 */
function versionSegments(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((segment) => {
      const match = segment.match(/^\d+/)
      return match ? Number.parseInt(match[0], 10) : 0
    })
}

/**
 * 比较两个版本号：a > b 返回正数、相等 0、a < b 负数。
 *
 * ⚠️ **按段比数字**，不是比字符串：`1.0.10` 比 `1.0.9` 新（字符串比会判反，
 * 这是版本比较最经典的坑，`update.spec.ts` 单锁一条）。
 * 段数不同时短的那边补 0：`1.0` == `1.0.0`。
 */
export function compareVersions(a: string, b: string): number {
  const left = versionSegments(a)
  const right = versionSegments(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/** 远端版本是否**确实**比当前新（相同/更低都不算）。 */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

/** 只认 https 的下载地址（`file://` / `javascript:` 这种一律当脏数据）。 */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 校验远端清单。
 *
 * 任何不对劲（不是对象、缺字段、版本号不像版本、地址不是 https）→ **null**，
 * 调用方当"没有更新"处理。宁可漏报一次更新，也不能让界面上冒出
 * "发现新版本 vundefined" 或者一个能点出任意协议的按钮。
 */
export function parseUpdateManifest(raw: unknown): UpdateManifest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>

  const version = value.version
  const notes = value.notes
  const url = value.url
  if (typeof version !== 'string' || !/^v?\d+(\.\d+)*$/.test(version.trim())) return null
  if (typeof notes !== 'string') return null
  if (typeof url !== 'string' || !isHttpsUrl(url)) return null

  const manifest: UpdateManifest = { version: version.trim(), notes, url }
  if (typeof value.sha256 === 'string' && value.sha256.length > 0) manifest.sha256 = value.sha256
  if (typeof value.size === 'number' && Number.isFinite(value.size)) manifest.size = value.size
  return manifest
}
