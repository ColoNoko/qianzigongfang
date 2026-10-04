// @vitest-environment node
/**
 * 主进程侧的「检查更新」（2026-10-04）。
 *
 * 三条红线（都在这份锁里）：
 *   ① **绝不抛错**：断网、超时、500、垃圾 JSON —— 一律变成 `failed` 状态，不许把异常
 *      冒到 IPC 上（那会让设置页弹一坨报错，而"检查更新失败"根本不是用户的问题）；
 *   ② **绝不写文件**：这一版只"发现 + 引导下载"，任何写盘都意味着越界了
 *      （用户数据在 exe 旁边的 `app/data`，更新流程碰它就是灾难）；
 *   ③ **超时要真的超时**：不能让设置页转圈转到天荒地老。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate } from '../update-check'

const MANIFEST_URL = 'https://gitee.com/Luo-yuan-z/qianzi-gongfang/raw/main/latest.json'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body
  } as unknown as Response
}

const manifest = {
  version: '1.0.1',
  notes: '修了几个小问题',
  url: 'https://gitee.com/Luo-yuan-z/qianzi-gongfang/releases/download/v1.0.1/x.zip'
}

describe('checkForUpdate', () => {
  it('远端更高 → update-available，并带上当前版本', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(manifest))
    const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl })

    expect(result.status).toBe('update-available')
    expect(result.currentVersion).toBe('1.0.0')
    if (result.status === 'update-available') expect(result.manifest.version).toBe('1.0.1')
    expect(fetchImpl).toHaveBeenCalledWith(MANIFEST_URL, expect.anything())
  })

  it('远端相同或更低 → up-to-date（不许提示"有新版"）', async () => {
    const same = await checkForUpdate({
      currentVersion: '1.0.1',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(manifest))
    })
    expect(same.status).toBe('up-to-date')

    const older = await checkForUpdate({
      currentVersion: '2.0.0',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(manifest))
    })
    expect(older.status).toBe('up-to-date')
  })

  it('断网（fetch 直接抛）→ failed，**不抛异常**', async () => {
    const result = await checkForUpdate({
      currentVersion: '1.0.0',
      fetchImpl: vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND gitee.com'))
    })
    expect(result.status).toBe('failed')
    expect(result.currentVersion).toBe('1.0.0')
    if (result.status === 'failed') expect(result.reason).toContain('ENOTFOUND')
  })

  it('HTTP 500 → failed（拿不到清单就当没有更新）', async () => {
    const result = await checkForUpdate({
      currentVersion: '1.0.0',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({}, false, 500))
    })
    expect(result.status).toBe('failed')
  })

  it('垃圾 / 半截 JSON → failed（不许出现"发现新版本 vundefined"）', async () => {
    const result = await checkForUpdate({
      currentVersion: '1.0.0',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ hello: 'world' }))
    })
    expect(result.status).toBe('failed')
  })

  it('超时 → failed（带超时上限，不许一直转圈）', async () => {
    // 模拟"永不返回"：只有 abort 信号能把它结束掉
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const result = await checkForUpdate({
      currentVersion: '1.0.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20
    })
    expect(result.status).toBe('failed')
  })

  it('**绝不写文件**：这个模块不许 import 任何写盘 API（源码契约锁）', () => {
    const source = readFileSync(resolve(__dirname, '../update-check.ts'), 'utf8')
    // 允许出现的只有网络与纯逻辑；写盘相关一律不许
    for (const forbidden of ['node:fs', "from 'fs'", 'writeFile', 'mkdir', 'rm(', 'storeSet']) {
      expect(source, `update-check 里出现了 ${forbidden} —— 更新流程不许碰文件`).not.toContain(
        forbidden
      )
    }
  })
})
