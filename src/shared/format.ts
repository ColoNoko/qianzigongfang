/**
 * 界面上的时间 / 体积格式化（2026-10-01 重构 P1）—— 唯一一处。
 *
 * 收之前的样子：`new Date(at).toLocaleString('zh-CN', { hour12: false })` 在 4 个文件里各写一遍
 * （设置页的备份列表、标记台账、从备份还原、诊断面板），`(bytes / 1048576).toFixed(1)` 在 2 处各写一遍。
 *
 * ⚠️ 这两个函数的输出**必须逐字不变** —— 界面上到处是截图与断言，差一个空格都算回归。
 *    `shared/__tests__/format.spec.ts` 锁的就是"与改前的写法逐字一致"。
 * ⚠️ `formatDateTime` 的结果**随本机时区变**（`toLocaleString` 的性质），所以测试里比的是
 *    "与同一表达式的结果相等"，而不是写死一个绝对时间串。
 */

/** `2026/9/30 17:24:28` 这种（zh-CN、24 小时制）。 */
export function formatDateTime(at: number): string {
  return new Date(at).toLocaleString('zh-CN', { hour12: false })
}

/** 字节 → MB，保留一位小数。**不带单位**：单位由调用方自己拼，各处写法保持不变。 */
export function formatMegabytes(bytes: number): string {
  return (bytes / 1048576).toFixed(1)
}
