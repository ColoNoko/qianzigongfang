// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 启动期兜底的**源码守卫**（2026-09-30 审查 high）。
 *
 * `main/index.ts` 全项目没有测试台（它一 import 就是 electron 全量），但这条缺陷的
 * 代价很大：库打不开（数据目录不可写 / 库损坏 / 被杀软锁住）时，`await getDatabase()`
 * 直接 reject，回调里后面的 `registerHandlers()` 与建窗口都不执行；而因为窗口从未
 * 创建过，`window-all-closed` 永不触发 —— 表现是"双击没反应 + 任务管理器里留一个
 * 占着库锁的进程"，全 main 目录连一个 `showErrorBox` 都没有。
 *
 * 所以这里用纯文本守卫盯住三件事：① 那句 `await getDatabase()` 必须在 try 里；
 * ② 失败路径要弹框（showErrorBox）；③ 弹完要退出（app.exit(1)）。
 * 与 `qianzi-runner.jsx` 的语法守卫同一类做法：运行时测不到、但必须别退化的东西。
 */
const SOURCE = readFileSync(resolve(__dirname, '../index.ts'), 'utf8')

describe('主进程启动期兜底', () => {
  it('await getDatabase() 被 try 包住（不能裸奔）', () => {
    expect(SOURCE).toMatch(/try\s*\{[^}]*await getDatabase\(\)/s)
  })

  it('失败时弹框并退出，而不是无声挂起', () => {
    expect(SOURCE).toContain('showErrorBox')
    expect(SOURCE).toMatch(/app\.exit\(1\)/)
  })

  it('whenReady 链上还有一层 catch 兜底', () => {
    // 库里那句只是第一道；建窗口等后续步骤失败同样不该"静默留一个空进程"。
    // 两处都走同一个报告函数（定义 1 次 + 调用 ≥2 次）。
    const uses = SOURCE.match(/reportFatalStartupError/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(3)
  })
})
