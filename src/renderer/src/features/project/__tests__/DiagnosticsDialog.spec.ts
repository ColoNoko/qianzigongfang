// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DiagnosticsDialog from '../DiagnosticsDialog.vue'

/**
 * 诊断面板（D2）。
 *
 * 它存在的意义是"出问题时用户自己能先看一眼"，所以锁三件事：
 * ① 最常被问到的几个事实都在（版本/库大小/标记行数/备份）；
 * ② 日志尾部真的显示出来（而不是让人去文件夹里翻）；
 * ③ 「复制诊断信息」把那段文本交给剪贴板，剪贴板不可用时**明确说**复制失败。
 */
const SNAPSHOT = {
  appVersion: '0.4.0',
  electronVersion: '39.8.10',
  platform: 'win32 x64',
  dataDirectory: 'D:\\app\\data',
  databasePath: 'D:\\app\\data\\database\\qianzi-gongfang.sqlite',
  databaseBytes: 3_300_000,
  logPath: 'D:\\app\\data\\logs\\psd-manager.log',
  logBytes: 12 * 1024 * 1024,
  backupCount: 3,
  newestBackupAt: 1790520930000,
  childCount: 204,
  recordCount: 3281,
  markCounts: { typeset: 1628, translated: 26, proofread: 973, supervised: 1044 }
}

function mockComicType(options?: { clipboard?: boolean }): { openPath: ReturnType<typeof vi.fn> } {
  const openPath = vi.fn(() => Promise.resolve({ ok: true }))
  ;(window as unknown as { comicType: unknown }).comicType = {
    diagnosticsSnapshot: vi.fn(() => Promise.resolve(SNAPSHOT)),
    readLogTail: vi.fn(() => Promise.resolve('2026-09-28 INFO [psd-thumb] 渲染完成\n最后一行')),
    openPath
  }
  if (options?.clipboard !== false) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      configurable: true
    })
  }
  return { openPath }
}

async function mountDialog() {
  const wrapper = mount(DiagnosticsDialog, { props: { open: true } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('DiagnosticsDialog', () => {
  it('把最常被问到的几个事实都显示出来（版本 / 库大小 / 标记行数 / 备份）', async () => {
    mockComicType()
    const wrapper = await mountDialog()

    expect(wrapper.get('[data-testid="diagnostics-version"]').text()).toContain('0.4.0')
    expect(wrapper.get('[data-testid="diagnostics-database"]').text()).toContain('3.1 MB')
    expect(wrapper.get('[data-testid="diagnostics-log"]').text()).toContain('12.0 MB')
    expect(wrapper.get('[data-testid="diagnostics-marks"]').text()).toContain('3281 行')
    expect(wrapper.get('[data-testid="diagnostics-marks"]').text()).toContain('监修 1044')
    expect(wrapper.get('[data-testid="diagnostics-body"]').text()).toContain('3 份')
  })

  it('日志尾部直接显示出来（不用去文件夹里翻）', async () => {
    mockComicType()
    const wrapper = await mountDialog()

    expect(wrapper.get('[data-testid="diagnostics-log-tail"]').text()).toContain('psd-thumb')
    expect(wrapper.get('[data-testid="diagnostics-log-tail"]').text()).toContain('最后一行')
  })

  it('「复制诊断信息」把摘要交给剪贴板；剪贴板不可用时要明说失败', async () => {
    mockComicType()
    const wrapper = await mountDialog()

    await wrapper.get('[data-testid="diagnostics-copy"]').trigger('click')
    await flushPromises()

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(copied).toContain('汉化工坊 0.4.0')
    expect(copied).toContain('标记记录：204 话 / 3281 行')
    expect(wrapper.emitted('toast')![0][0]).toMatchObject({ type: 'success' })

    // 剪贴板挂掉 → 明确提示，不装作成功
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
      configurable: true
    })
    await wrapper.get('[data-testid="diagnostics-copy"]').trigger('click')
    await flushPromises()
    const toasts = wrapper.emitted('toast') as Array<[{ type: string; message: string }]>
    expect(toasts[1][0].type).toBe('warning')
    expect(toasts[1][0].message).toContain('复制失败')
  })

  it('「打开日志文件」调 openPath 打开日志路径', async () => {
    const { openPath } = mockComicType()
    const wrapper = await mountDialog()

    await wrapper.get('[data-testid="diagnostics-open-log"]').trigger('click')
    await flushPromises()

    expect(openPath).toHaveBeenCalledWith(SNAPSHOT.logPath)
  })

  it('读不到日志时给一句人话，而不是空白（面板本身照常打开）', async () => {
    mockComicType()
    ;(window.comicType.readLogTail as ReturnType<typeof vi.fn>).mockResolvedValue('')
    const wrapper = await mountDialog()

    expect(wrapper.get('[data-testid="diagnostics-log-tail"]').text()).toContain('读不到')
  })
})
