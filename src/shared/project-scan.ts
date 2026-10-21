import type { ChildProjectScan } from './types'

/**
 * 扫描结果**入库前**的那道闸（2026-10-05 从 0.4.0 移植）。
 *
 * 原则：扫描结果可以"不够好"（目录不在、部分读不到、文件仍在写）—— 这些状态
 * **显示给用户看没问题**，但**不许写进库**。半写状态或残缺统计一旦落库，
 * 侧栏/首页就会永久显示错误数字（本仓库 2026-09-30 就为"0 页不许入库"修过一次）。
 *
 * ⚠️ 挂在"扫描结果 → 写库"的边界上（导入 / 保存 / 自检导入），**不要**挂在显示路径上：
 * 显示路径需要的是"把能看的都摆出来 + 提示哪里不对"，而不是一刀切抛错。
 */
export function requireCompleteScan(scan: ChildProjectScan): void {
  if (scan.status === 'unavailable') {
    throw new Error('目录暂不可用，已保留上次结果；恢复连接后将自动重试')
  }
  if (scan.status === 'unstable') {
    throw new Error('文件仍在写入，已保留上次结果，稍后自动重试')
  }
  if (scan.errors.length || scan.status === 'partial') {
    throw new Error(`部分文件读取失败（${scan.errors.length} 项），已保留上次结果`)
  }
}
