// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { describeOpenPathResult } from '../open-path-failure'

/**
 * 打开文件失败的分类（2026-10-01 第一批 A4）。
 *
 * 这段逻辑以前写在 `main/ipc/handlers.ts` 里，而那个文件没有测试台（一 import 就是 electron 全量）；
 * 更要命的是它判的是 `result.includes('does not exist')` —— 2026-10-01 用 electron.exe 真机实测，
 * `shell.openPath` 的原文**只有一句 `"Failed to open path"`**，那句话永远不出现，
 * 所以 `E_NOT_FOUND` 分支从来没被返回过。抽成纯函数 + 这几条锁，就是防它再退化。
 */
describe('describeOpenPathResult', () => {
  it('空串 = 打开成功（实测：无关联文件会弹「打开方式」并返回空串）', () => {
    expect(describeOpenPathResult('', true)).toEqual({ ok: true })
    expect(describeOpenPathResult('', false)).toEqual({ ok: true })
  })

  it('打不开 + 文件真的不在 → E_NOT_FOUND', () => {
    expect(describeOpenPathResult('Failed to open path', false)).toEqual({
      ok: false,
      code: 'E_NOT_FOUND',
      message: 'Failed to open path'
    })
  })

  it('打不开 + 文件在 → E_OPEN_FAILED，且**系统原话原样保留**（不许吞）', () => {
    expect(describeOpenPathResult('Failed to open path', true)).toEqual({
      ok: false,
      code: 'E_OPEN_FAILED',
      message: 'Failed to open path'
    })
  })

  it('不返回 E_NO_DEFAULT_APP —— Windows 上「没有默认应用」不以错误回报，判定不了就不假装能判定', () => {
    // 实测：真正没有关联的 .foo 文件，shell.openPath 返回 ""（系统弹「打开方式」让用户选）。
    // 所以这个码在 Windows 上没有可靠的来源；真要用它得另想办法。
    for (const exists of [true, false]) {
      expect(describeOpenPathResult('Failed to open path', exists).ok).toBe(false)
      expect(describeOpenPathResult('Failed to open path', exists)).not.toMatchObject({
        code: 'E_NO_DEFAULT_APP'
      })
    }
  })
})
