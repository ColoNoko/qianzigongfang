// @vitest-environment jsdom
/**
 * 设置页「检查更新」（2026-10-04）。
 *
 * 界面三态 + 一条底线：
 *   · 已是最新 → 明确说"已是最新"，不给任何按钮；
 *   · 发现新版 → 显示版本号 + 更新说明 + 「去下载」（点了走既有 `openExternal` 通道）；
 *   · 检查失败 → **静默**（说一句"检查失败，稍后再试"就够，不弹错、不阻断设置页）。
 *
 * ⚠️ 这条底线值得单独说：**界面不许自己拼下载地址** —— 地址只能来自清单
 * （远端可控的数据），否则以后有人改一行就变成"打开任意 URL"。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Settings from '../Settings.vue'
import { useToastStore } from '@renderer/stores/toast'

function stubMatchMedia(): void {
  const mql = {
    matches: false,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn()
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
}

async function mountSettings(checkResult: unknown) {
  stubMatchMedia()
  const api = {
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined),
    importLegacyJson: vi.fn().mockResolvedValue({ canceled: true, added: 0, skipped: 0 }),
    pickDirectory: vi.fn().mockResolvedValue(null),
    pickToolFile: vi.fn().mockResolvedValue(null),
    launchTool: vi.fn().mockResolvedValue({ ok: true }),
    confirmPsFallback: vi.fn().mockResolvedValue({ confirmed: false, dontAskAgain: false }),
    dbBackupList: vi.fn().mockResolvedValue([]),
    diagnosticsSnapshot: vi.fn().mockResolvedValue({ appVersion: '0.0.0' }),
    readLogTail: vi.fn().mockResolvedValue(''),
    openExternal: vi.fn().mockResolvedValue({ ok: true }),
    checkForUpdate: vi.fn().mockResolvedValue(checkResult),
    writeLog: vi.fn().mockResolvedValue(undefined)
  }
  window.comicType = api as unknown as typeof window.comicType

  const pinia = createPinia()
  setActivePinia(pinia)
  useToastStore()
  const wrapper = mount(Settings, { global: { plugins: [pinia] } })
  await flushPromises()
  return { wrapper, api }
}

/** 点「检查更新」并等异步落定。 */
async function clickCheck(wrapper: Awaited<ReturnType<typeof mountSettings>>['wrapper']) {
  await wrapper.get('[data-testid="update-check"]').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('设置页「检查更新」', () => {
  it('初始状态：有「检查更新」按钮，还不显示任何结论', async () => {
    const { wrapper } = await mountSettings({ status: 'up-to-date', currentVersion: '0.0.0' })
    expect(wrapper.find('[data-testid="update-check"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="update-status"]').exists()).toBe(false)
  })

  it('已是最新 → 说清楚，且**没有**「去下载」按钮', async () => {
    const { wrapper } = await mountSettings({ status: 'up-to-date', currentVersion: '1.0.0' })
    await clickCheck(wrapper)

    expect(wrapper.get('[data-testid="update-status"]').text()).toContain('已是最新')
    expect(wrapper.find('[data-testid="update-download"]').exists()).toBe(false)
  })

  it('发现新版 → 显示版本号 + 说明 + 「去下载」', async () => {
    const { wrapper } = await mountSettings({
      status: 'update-available',
      currentVersion: '1.0.0',
      manifest: {
        version: '1.0.1',
        notes: '修了几个小问题',
        url: 'https://gitee.com/Luo-yuan-z/qianzi-gongfang/releases/download/v1.0.1/x.zip'
      }
    })
    await clickCheck(wrapper)

    const status = wrapper.get('[data-testid="update-status"]').text()
    expect(status).toContain('1.0.1')
    expect(status).toContain('修了几个小问题')
    expect(wrapper.find('[data-testid="update-download"]').exists()).toBe(true)
  })

  it('点「去下载」→ 走既有的 openExternal 通道，地址**来自清单**', async () => {
    const url = 'https://gitee.com/Luo-yuan-z/qianzi-gongfang/releases/download/v1.0.1/x.zip'
    const { wrapper, api } = await mountSettings({
      status: 'update-available',
      currentVersion: '1.0.0',
      manifest: { version: '1.0.1', notes: '说明', url }
    })
    await clickCheck(wrapper)

    await wrapper.get('[data-testid="update-download"]').trigger('click')
    await flushPromises()

    expect(api.openExternal).toHaveBeenCalledWith(url)
  })

  it('检查失败 → 静默：给一句人话，不抛错、不阻断页面', async () => {
    const { wrapper } = await mountSettings({
      status: 'failed',
      currentVersion: '1.0.0',
      reason: 'getaddrinfo ENOTFOUND gitee.com'
    })
    await clickCheck(wrapper)

    const status = wrapper.get('[data-testid="update-status"]').text()
    expect(status).toContain('检查失败')
    // 设置页其余部分照常可用
    expect(wrapper.find('[data-testid="settings-about-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="update-download"]').exists()).toBe(false)
  })
})
