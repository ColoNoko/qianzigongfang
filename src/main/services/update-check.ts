/**
 * 主进程：检查更新（2026-10-04）。
 *
 * **只读网络，其它什么都不做** —— 不下载、不替换、不重启、不写任何文件
 * （`__tests__/update-check.spec.ts` 有一条源码契约锁盯着这一点）。
 * 用户数据在 exe 旁边的 `app/data`，更新流程碰它就是灾难，所以这一版干脆
 * 把"写盘"这件事整个排除在外：要更新，人去点下载页。
 *
 * 三条规矩：
 *   ① **绝不抛错** —— 断网/超时/500/垃圾 JSON 一律变成 `failed` 状态；
 *      检查更新失败不是用户的问题，不许把异常冒到界面上；
 *   ② **必须超时** —— 不能让设置页转圈转到天荒地老；
 *   ③ 拿不到就说拿不到 —— `reason` 给一句能读的原文，界面只拿它当内部说明。
 */
import { parseUpdateManifest, UPDATE_MANIFEST_URL, type UpdateManifest } from '@shared/update'

/** 默认超时：够慢网络拉一个小 JSON，又不至于让用户等得心焦。 */
const DEFAULT_TIMEOUT_MS = 8000

export type UpdateCheckResult =
  | { status: 'update-available'; currentVersion: string; manifest: UpdateManifest }
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'failed'; currentVersion: string; reason: string }

export interface CheckForUpdateOptions {
  /** 当前版本（主进程传 `app.getVersion()`；测试直接给）。 */
  currentVersion: string
  /** 注入用的 fetch（默认由调用方给 Electron 的 `net.fetch`）—— 便于单测与离线运行。 */
  fetchImpl: typeof fetch
  /** 超时上限（毫秒）。 */
  timeoutMs?: number
}

/**
 * 拉清单 + 比对版本。**永远 resolve**，不 resolve 之外的任何东西。
 */
export async function checkForUpdate(options: CheckForUpdateOptions): Promise<UpdateCheckResult> {
  const { currentVersion, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(UPDATE_MANIFEST_URL, {
      signal: controller.signal,
      // 别让中间层拿旧清单糊弄：检查更新的意义就在于"现在有没有新版"
      headers: { 'cache-control': 'no-cache' }
    })
    if (!response.ok) {
      return { status: 'failed', currentVersion, reason: `HTTP ${response.status}` }
    }

    const manifest = parseUpdateManifest(await response.json())
    if (!manifest) {
      return { status: 'failed', currentVersion, reason: '清单格式不对（已忽略）' }
    }

    // 对比逻辑在 shared（纯函数、有单测）；这里只决定"报什么状态"
    const { isNewerVersion } = await import('@shared/update')
    return isNewerVersion(manifest.version, currentVersion)
      ? { status: 'update-available', currentVersion, manifest }
      : { status: 'up-to-date', currentVersion }
  } catch (error) {
    return {
      status: 'failed',
      currentVersion,
      reason: error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timer)
  }
}
