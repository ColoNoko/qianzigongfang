import type { OpenPathResult } from '@shared/ipc-api'

/**
 * 把 `shell.openPath()` 的结果翻译成**我们能显示**的错误码（2026-10-01 第一批 A4）。
 *
 * 为什么单独抽一个纯函数：`main/ipc/handlers.ts` 没有测试台（一 `import` 就是 electron 全量），
 * 而"失败原因怎么分类、原话保不保留"恰恰是最该被锁住的一段 —— 抽出来就能单测。
 *
 * ── 下面这些结论**都是真机实测的**（2026-10-01，用 electron.exe 直接调 shell.openPath）──
 *
 * | 目标 | 返回 |
 * |---|---|
 * | 存在的无关联文件（`.foo`） | `""` ← **成功**：Windows 弹「打开方式」让用户自己选 |
 * | 不存在的路径 | `"Failed to open path"` |
 * | 关联残缺的真实 `.psd` | `"Failed to open path"` |
 *
 * 所以：
 *   ① 系统原文**只有一句** `"Failed to open path"` —— 既不含 `does not exist`、也不含
 *      `no application is associated`。**光看这句话分不出原因**，必须让主进程补一个事实
 *      （文件在不在）才能判准；这就是本函数为什么要收第二个参数。
 *   ② 老代码那句 `result.includes('does not exist')` 是**死分支**（实测原文里没有这句），
 *      于是 `E_NOT_FOUND` 从来没被返回过 —— 这次一并修掉。
 *   ③ `E_NO_DEFAULT_APP` 在 Windows 上**不可判定**：真的"没关联"时系统会弹「打开方式」并返回成功，
 *      不会给我们一个"没有默认应用"的错误。所以本函数**不返回**这个码（原因见上面那张表），
 *      渲染层那段文案暂时用不上 —— 这是已知限制，不是我们忘了接。
 *
 * 无论哪条路：**系统原话一定原样塞进 `message`**，别再像以前那样吞掉 ——
 * "点了没反应又查不出原因"的根子就是这里。
 */
export function describeOpenPathResult(rawMessage: string, fileExists: boolean): OpenPathResult {
  if (rawMessage === '') return { ok: true }
  if (!fileExists) {
    return { ok: false, code: 'E_NOT_FOUND', message: rawMessage }
  }
  return { ok: false, code: 'E_OPEN_FAILED', message: rawMessage }
}
