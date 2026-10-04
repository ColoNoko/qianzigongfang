// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { FontListResult, SystemFontInfo } from '@shared/ipc-api'
import FontManager from '../FontManager.vue'
import { useToastStore } from '../../stores/toast'
import { FONT_IDENTIFY_SITE } from '@shared/external-url'

const fonts: SystemFontInfo[] = [
  {
    id: 'system-font',
    family: 'Microsoft YaHei',
    style: 'Regular',
    postScriptName: 'MicrosoftYaHei',
    displayName: 'Microsoft YaHei Regular',
    fileName: 'msyh.ttc',
    filePath: 'C:\\Windows\\Fonts\\msyh.ttc',
    format: 'TTC',
    source: 'system',
    managed: false,
    languages: ['chinese', 'latin']
  },
  {
    id: 'managed-font',
    family: 'Comic Letter',
    style: 'Bold',
    postScriptName: 'ComicLetter-Bold',
    displayName: 'Comic Letter Bold',
    fileName: 'ComicLetter-Bold.ttf',
    filePath: 'C:\\Users\\test\\AppData\\Local\\Microsoft\\Windows\\Fonts\\ComicLetter-Bold.ttf',
    format: 'TTF',
    source: 'managed',
    managed: true,
    languages: ['latin'],
    installedAt: 1
  },
  {
    id: 'user-font',
    family: 'User Font',
    style: 'Regular',
    postScriptName: 'UserFont-Regular',
    displayName: 'User Font Regular',
    fileName: 'UserFont.ttf',
    filePath: 'C:\\Users\\test\\AppData\\Local\\Microsoft\\Windows\\Fonts\\UserFont.ttf',
    format: 'TTF',
    source: 'user',
    managed: false,
    languages: ['japanese', 'latin']
  }
]

function fontResult(nextFonts = fonts): FontListResult {
  return { supported: true, fonts: nextFonts, scannedAt: Date.now() }
}

function setupApi() {
  const fontList = vi.fn().mockResolvedValue(fontResult())
  const fontInstall = vi.fn().mockResolvedValue({
    canceled: false,
    installed: [fonts[1]],
    failed: []
  })
  const fontUninstall = vi.fn().mockResolvedValue({
    ok: true,
    message: '已卸载 Comic Letter Bold'
  })
  const fontUninstallMany = vi.fn().mockResolvedValue({
    succeeded: ['managed-font', 'user-font'],
    failed: []
  })
  const openExternal = vi.fn().mockResolvedValue({ ok: true })
  window.comicType = {
    fontList,
    fontInstall,
    fontUninstall,
    fontUninstallMany,
    openExternal
  } as unknown as typeof window.comicType
  return { fontList, fontInstall, fontUninstall, fontUninstallMany, openExternal }
}

function mountFontManager() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return {
    wrapper: mount(FontManager, { global: { plugins: [pinia] } }),
    toast: useToastStore(pinia)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('FontManager', () => {
  it('only schedules a five-minute refresh while the page component is active', async () => {
    setupApi()
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const clearSpy = vi.spyOn(window, 'clearInterval')
    const { wrapper } = mountFontManager()
    await flushPromises()

    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000)
    wrapper.unmount()
    expect(clearSpy).toHaveBeenCalled()
  })

  it('lists fonts, searches by name and only exposes uninstall for non-system fonts', async () => {
    setupApi()
    const { wrapper } = mountFontManager()
    await flushPromises()

    expect(wrapper.findAll('article[data-testid^="font-card-"]')).toHaveLength(3)
    expect(wrapper.find('[data-testid="font-uninstall-system-font"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="font-uninstall-managed-font"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="font-uninstall-user-font"]').exists()).toBe(true)

    await wrapper.get('[data-testid="font-search"]').setValue('comic')
    expect(wrapper.find('[data-testid="font-card-system-font"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="font-card-managed-font"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('installs fonts and switches to the app-managed filter', async () => {
    const { fontInstall, fontList } = setupApi()
    const { wrapper, toast } = mountFontManager()
    await flushPromises()

    await wrapper.get('[data-testid="font-install"]').trigger('click')
    await flushPromises()

    expect(fontInstall).toHaveBeenCalledOnce()
    expect(fontList).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="font-filter-managed"]').classes()).toContain('bg-accent')
    expect(toast.toasts.some((item) => item.message === '已安装 1 个字体')).toBe(true)

    wrapper.unmount()
  })

  it('confirms and uninstalls an app-managed font', async () => {
    const { fontUninstall } = setupApi()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { wrapper, toast } = mountFontManager()
    await flushPromises()

    await wrapper.get('[data-testid="font-uninstall-managed-font"]').trigger('click')
    await flushPromises()

    expect(fontUninstall).toHaveBeenCalledWith('managed-font')
    expect(toast.toasts.some((item) => item.message === '已卸载 Comic Letter Bold')).toBe(true)

    wrapper.unmount()
  })

  it('changes card density and applies bounded preview controls', async () => {
    setupApi()
    const { wrapper } = mountFontManager()
    await flushPromises()

    await wrapper.get('[data-testid="font-card-size-medium"]').trigger('click')
    expect(wrapper.get('[data-testid="font-list"] > div').classes()).toContain('grid-cols-3')
    expect(wrapper.get('[data-testid="font-card-system-font"]').classes()).toContain('h-48')

    await wrapper.get('[data-testid="font-preview-weight"]').setValue('500')
    await wrapper.get('[data-testid="font-preview-bold"]').trigger('click')
    await wrapper.get('[data-testid="font-preview-italic"]').trigger('click')
    await wrapper.get('[data-testid="font-preview-vertical"]').trigger('click')

    const sample = wrapper.get('[data-testid="font-preview-sample-system-font"]')
    expect(sample.attributes('style')).toContain('font-weight: 700')
    expect(sample.attributes('style')).toContain('font-style: italic')
    expect(sample.attributes('style')).toContain('writing-mode: vertical-rl')

    wrapper.unmount()
  })

  it('loads fonts in batches of 50, 100, or all', async () => {
    const manyFonts = Array.from({ length: 120 }, (_, index): SystemFontInfo => ({
      ...fonts[0],
      id: `font-${index}`,
      family: `Font ${index}`
    }))
    const api = setupApi()
    api.fontList.mockResolvedValue(fontResult(manyFonts))
    const { wrapper } = mountFontManager()
    await flushPromises()

    expect(wrapper.findAll('article[data-testid^="font-card-"]')).toHaveLength(50)
    await wrapper.get('[data-testid="font-load-batch"]').setValue('100')
    expect(wrapper.findAll('article[data-testid^="font-card-"]')).toHaveLength(100)
    await wrapper.get('[data-testid="font-load-batch"]').setValue('all')
    expect(wrapper.findAll('article[data-testid^="font-card-"]')).toHaveLength(120)

    wrapper.unmount()
  })

  it('filters fonts by summarized Unicode language tags', async () => {
    setupApi()
    const { wrapper } = mountFontManager()
    await flushPromises()

    await wrapper.get('[data-testid="font-language-filter-trigger"]').trigger('click')
    await wrapper.get('[data-testid="font-language-filter-option-japanese"]').trigger('click')

    expect(wrapper.find('[data-testid="font-card-user-font"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="font-card-system-font"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="font-card-managed-font"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="font-filter-all"]').text()).toBe('全部 1')
    expect(wrapper.get('[data-testid="font-filter-system"]').text()).toBe('系统 0')
    expect(wrapper.get('[data-testid="font-filter-user"]').text()).toBe('用户 1')
    expect(wrapper.get('[data-testid="font-filter-managed"]').text()).toBe('本应用 0')

    await wrapper.get('[data-testid="font-filter-system"]').trigger('click')
    expect(wrapper.findAll('article[data-testid^="font-card-"]')).toHaveLength(0)

    wrapper.unmount()
  })

  it('keeps the active language filter when manually refreshing the font inventory', async () => {
    const api = setupApi()
    const refreshedJapaneseFont: SystemFontInfo = {
      ...fonts[2],
      id: 'new-japanese-font',
      family: 'New Japanese Font'
    }
    api.fontList
      .mockResolvedValueOnce(fontResult(fonts))
      .mockResolvedValueOnce(fontResult([fonts[0], refreshedJapaneseFont]))
    const { wrapper, toast } = mountFontManager()
    await flushPromises()

    await wrapper.get('[data-testid="font-language-filter-trigger"]').trigger('click')
    await wrapper.get('[data-testid="font-language-filter-option-japanese"]').trigger('click')
    expect(wrapper.find('[data-testid="font-card-user-font"]').exists()).toBe(true)

    await wrapper.get('[data-testid="font-refresh"]').trigger('click')
    await flushPromises()

    expect(api.fontList).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="font-card-system-font"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="font-card-new-japanese-font"]').exists()).toBe(true)
    expect(toast.toasts.some((item) => item.message.includes('字体列表已刷新'))).toBe(true)

    wrapper.unmount()
  })

  it('batch-selects removable fonts without including protected system fonts', async () => {
    const { fontUninstallMany } = setupApi()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { wrapper, toast } = mountFontManager()
    await flushPromises()

    await wrapper.get('[data-testid="font-selection-enter"]').trigger('click')
    await wrapper.get('[data-testid="font-selection-all"]').trigger('click')
    expect(wrapper.get('[data-testid="font-selection-uninstall"]').text()).toContain('(2)')

    await wrapper.get('[data-testid="font-selection-uninstall"]').trigger('click')
    await flushPromises()

    expect(fontUninstallMany).toHaveBeenCalledWith(['managed-font', 'user-font'])
    expect(toast.toasts.some((item) => item.message === '已卸载 2 个字体')).toBe(true)

    wrapper.unmount()
  })

  /**
   * 字体页的「识字网」入口（用户 2026-09-27 要求）：点一下用系统默认浏览器打开
   * 那个网站。**默认浏览器**意味着这条要经过主进程的 `shell.openExternal`
   * （白名单在 `shared/external-url.ts`，另有单测），渲染侧只负责把地址传对。
   */
  it('点「识字网」→ 让主进程用默认浏览器打开那个站', async () => {
    const { openExternal } = setupApi()
    const { wrapper } = mountFontManager()
    await flushPromises()

    const button = wrapper.get('[data-testid="font-identify-site"]')
    expect(button.text()).toContain('识字网')
    // 说清"会跳出程序"，免得被当成程序内页面
    expect(button.attributes('title')).toContain('浏览器')

    await button.trigger('click')
    await flushPromises()

    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(FONT_IDENTIFY_SITE)
    wrapper.unmount()
  })

  it('浏览器打不开时给一条提示，不静默什么都不发生', async () => {
    const { openExternal } = setupApi()
    openExternal.mockResolvedValue({ ok: false, code: 'E_OPEN_FAILED', message: '没有默认浏览器' })
    const { wrapper, toast } = mountFontManager()
    await flushPromises()

    await wrapper.get('[data-testid="font-identify-site"]').trigger('click')
    await flushPromises()

    expect(toast.toasts.some((item) => item.message.includes('没能打开浏览器'))).toBe(true)
    wrapper.unmount()
  })
})
