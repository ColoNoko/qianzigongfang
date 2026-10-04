/**
 * 开发期的 IPC 参数护栏。
 *
 * Electron 用**结构化克隆**序列化 `ipcRenderer.invoke` 的参数：Vue 的响应式代理、
 * 函数、DOM 节点都过不了，会抛 `An object could not be cloned`。问题是那条错误只在
 * 主进程侧冒出来，既看不出是哪个 channel，也看不出是哪个字段 ——
 * 2026-09-23 就为这个查了一轮（自检导入把 `ref` 里的数组直接发了出去，见 §13.2）。
 *
 * 这里做的事很简单：**转发前用平台自己的 `structuredClone` 走一遍**（和 Electron
 * 做的是同一件事），失败时抛一条点名 channel 与下标、并直接给出最常见成因的错误。
 *
 * 开关走 argv，而不是 `process.env`：本项目 `sandbox: true`，沙箱化 preload 的
 * `process` 是被裁剪过的，而 `process.argv` 这条通道**已经在打包环境里被验证可用**
 * （首帧主题 `boot-args` 就是靠它）。没必要为了一道开发期护栏去赌 `process.env` 存不存在。
 */
/**
 * 主进程在 dev 下追加到 `webPreferences.additionalArguments`；
 * preload 用它的**存在与否**决定护栏开关（打包产物里没有，等于死代码）。
 */
export const IPC_GUARD_FLAG = '--qianzi-ipc-guard'

/** argv 里带了这个 flag 才开护栏。argv 缺失/非数组一律当作"关"。 */
export function isIpcGuardEnabled(argv: readonly string[] | undefined): boolean {
  return Array.isArray(argv) && argv.includes(IPC_GUARD_FLAG)
}

/**
 * 逐个参数做一次结构化克隆。任何一个过不了就抛错，错误信息里带 channel 与下标。
 *
 * 刻意**不吞异常**：在 dev 里当场炸掉，比让它在主进程侧变成一句"某个东西不可克隆"
 * 有用得多。运行环境没有 `structuredClone` 时直接跳过（宁可漏检，不能误伤）。
 */
export function assertIpcPayloadCloneable(channel: string, args: readonly unknown[]): void {
  if (typeof structuredClone !== 'function') return

  for (let index = 0; index < args.length; index += 1) {
    try {
      structuredClone(args[index])
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `[ipc-guard] ${channel} 的第 ${index} 个参数过不了结构化克隆：${reason}\n` +
          '最常见的原因是直接把 Vue 的 ref/reactive（响应式代理）发给了 IPC —— ' +
          '先摊平成普通对象/数组再发（例如 [...arr]、JSON.parse(JSON.stringify(v))）。' +
          '详见项目内 §13「修改代码时的约定」那一节。'
      )
    }
  }
}
