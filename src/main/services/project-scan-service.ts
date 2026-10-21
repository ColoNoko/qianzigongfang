import type { ChildProjectScan } from '@shared/types'
import { scanChildProject } from './scanner'
import { computeIdentityFingerprint, computeSourceRevision } from './scan-fingerprint'
import { ProjectScanScheduler } from './project-scan-scheduler'
import { ProjectRefreshWatch } from './project-refresh-watch'
import { recordChildContentFingerprint } from './project-repository'
import { writeLog } from './logger'

/**
 * 全项目唯一的**扫描入口**（主进程侧，2026-10-05 从 0.4.0 移植并适配）。
 *
 * 渲染层所有 `comicType:scanChildProject` 都走这里：
 *   · `ProjectScanScheduler` 负责去重 / 2 秒缓存 / 双次校验 / unstable；
 *   · `computeSourceRevision` 把"内容指纹"算进 `sourceRevision`（目录监听用它）；
 *   · `commit` 只记一行日志 —— 本项目的扫描结果由**渲染层**决定怎么用，
 *     与 0.4.0 的"主进程直接落库"不同（见调度器文件的适配边界）。
 */
export const projectScanService = new ProjectScanScheduler(
  async (path) => {
    const result = await scanChildProject(path)
    result.sourceRevision = await computeSourceRevision(result)
    // 改名认领要用的"全文件指纹"（含 PSD）——与 sourceRevision 的分工见 shared/types。
    result.contentFingerprint = await computeIdentityFingerprint(result, path)
    return result
  },
  async (path, result, current) => {
    if (!current()) return
    // 稳定扫描之后把内容指纹记到那一话上（改名认领的比对基准；R1）。
    // 记指纹失败**不许**影响这次扫描的结果 —— 它只是"以后可能有用"的快照。
    if (result.contentFingerprint) {
      try {
        await recordChildContentFingerprint(path, result.contentFingerprint)
      } catch {
        // 忽略：指纹是辅助信息
      }
    }
    void writeLog({
      level: 'info',
      scope: 'scan',
      message: `扫描稳定 ${path} status=${result.status} pairs=${result.jpgPairs.length}`
    }).catch(() => undefined)
  },
  500
)

export type { ChildProjectScan }

/**
 * 目录监听（主进程热缓存，2026-10-05）：这一话的目录一变（PS 存盘 / 增删文件），
 * 就去**重扫并刷新缓存**；渲染层照旧用"可见时轻轮询 + 焦点刷新"来取最新结果。
 * 与原版（事件推送给渲染层）的差别见 `project-refresh-watch.ts` 的头注释。
 */
export const projectScanWatch = new ProjectRefreshWatch((path) => {
  void projectScanService.request(path, false).catch(() => undefined)
})
