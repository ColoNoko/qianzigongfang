// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
config.global.stubs.teleport = true
config.global.renderStubDefaultSlot = true
enableAutoUnmount(afterEach)
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
    fontPreview: vi.fn().mockResolvedValue({ buffer: new ArrayBuffer(4), coverage: [[0, 65535]] }),
    fontList,
    fontInstall,
    fontUninstall,
    fontUninstallMany,
    openExternal
  } as unknown as typeof window.comicType
  return { fontList, fontInstall, fontUninstall, fontUninstallMany, openExternal }
}

function mountFontManager(mode: 'system' | 'folder' | null = 'system') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(FontManager, { global: { plugins: [pinia] } })
  if (mode) void wrapper.get(`[data-testid="font-mode-${mode}"]`).trigger('click')
  return {
    wrapper,
    toast: useToastStore(pinia)
  }
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(924)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.useFakeTimers()
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add: vi.fn(), delete: vi.fn() }
  })
  vi.stubGlobal(
    'FontFace',
    class {
      async load() {
        return this
      }
    }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
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
    expect(wrapper.get('[data-testid="font-filter-managed"]').attributes('data-state')).toBe('on')
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
    expect(wrapper.get('[data-testid="font-list"] > div').attributes('style')).toContain(
      'repeat(3, minmax(0, 1fr))'
    )
    expect(wrapper.get('[data-testid="font-card-system-font"]').classes()).toContain('h-48')

    wrapper.findAllComponents({ name: 'AppSelect' }).find(c => c.props('testId') === 'font-preview-weight')!.vm.$emit('update:modelValue', '500')
    await flushPromises()
    await wrapper.get('[data-testid="font-preview-bold"]').trigger('click')
    await wrapper.get('[data-testid="font-preview-italic"]').trigger('click')
    await wrapper.get('[data-testid="font-preview-vertical"]').trigger('click')

    const sample = wrapper.get('[data-testid="font-preview-sample-system-font"]')
    expect(sample.attributes('style')).toContain('font-weight: 700')
    expect(sample.attributes('style')).toContain('font-style: italic')
    expect(sample.attributes('style')).toContain('writing-mode: vertical-rl')

    wrapper.unmount()
  })

  it('virtualizes a thousand faces and scrolls to the final face without a load-more button', async () => {
    const { fontList } = setupApi()
    fontList.mockResolvedValue(
      fontResult(Array.from({ length: 1000 }, (_, i) => ({ ...fonts[0], id: `font-${i}` })))
    )
    const { wrapper } = mountFontManager()
    await flushPromises()
    expect(wrapper.findAll('article').length).toBeLessThan(40)
    const list = wrapper.get('[data-testid="font-list"]')
    Object.defineProperty(list.element, 'scrollTop', { value: 497 * 236, configurable: true })
    await list.trigger('scroll')
    await flushPromises()
    expect(wrapper.find('[data-testid="font-card-font-999"]').exists()).toBe(true)
    expect(wrapper.findAll('article').length).toBeLessThan(40)
    wrapper.unmount()
  })

  it('filters fonts by summarized Unicode language tags', async () => {
    setupApi()
    const { wrapper } = mountFontManager()
    await flushPromises()

    wrapper.findAllComponents({ name: 'AppSelect' }).find(c => c.props('testId') === 'font-language-filter')!.vm.$emit('update:modelValue', 'japanese')
    await flushPromises()

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

    wrapper.findAllComponents({ name: 'AppSelect' }).find(c => c.props('testId') === 'font-language-filter')!.vm.$emit('update:modelValue', 'japanese')
    await flushPromises()
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

it('starts at source selection without scanning until requested', async () => {
  const { fontList } = setupApi()
  const { wrapper } = mountFontManager(null)
  await flushPromises()
  expect(fontList).not.toHaveBeenCalled()
  await wrapper.get('[data-testid="font-mode-system"]').trigger('click')
  await flushPromises()
  expect(fontList).toHaveBeenCalledOnce()
  wrapper.unmount()
})
it('keeps the current folder after cancelling replacement and discards late results after returning', async () => {
  setupApi()
  const fontListFolder = vi
    .fn()
    .mockResolvedValue({
      ...fontResult(fonts.map((f) => ({ ...f, source: 'folder' }))),
      canceled: false,
      folderPath: 'C:/fonts'
    })
  window.comicType.fontListFolder = fontListFolder
  const { wrapper } = mountFontManager('folder')
  await flushPromises()
  expect(wrapper.text()).toContain('C:/fonts')
  fontListFolder.mockResolvedValueOnce({ ...fontResult([]), canceled: true })
  await wrapper.get('[data-testid="font-choose-another-folder"]').trigger('click')
  await flushPromises()
  expect(wrapper.findAll('article')).toHaveLength(3)
  expect(wrapper.text()).toContain('C:/fonts')
  let resolve!: (value: unknown) => void
  fontListFolder.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  await wrapper.get('[data-testid="font-refresh"]').trigger('click')
  await wrapper.get('[data-testid="font-back-to-mode"]').trigger('click')
  resolve({ ...fontResult(fonts), canceled: false, folderPath: 'C:/stale' })
  await flushPromises()
  expect(wrapper.find('[data-testid="font-mode-picker"]').exists()).toBe(true)
  expect(wrapper.findAll('article')).toHaveLength(0)
  wrapper.unmount()
})
it('compares selected protected and user fonts while keeping uninstall restricted', async () => {
  setupApi()
  const { wrapper } = mountFontManager()
  await flushPromises()
  await wrapper.get('[data-testid="font-selection-enter"]').trigger('click')
  await wrapper.get('[data-testid="font-card-system-font"]').trigger('keydown', { key: 'Enter' })
  await wrapper.get('[data-testid="font-card-managed-font"]').trigger('click')
  await wrapper.get('[data-testid="font-selection-compare"]').trigger('click')
  expect(wrapper.findAll('article')).toHaveLength(2)
  expect(wrapper.get('[data-testid="font-selection-uninstall"]').text()).toContain('(1)')
  wrapper.unmount()
})

// Confirmation UI is covered separately; preserve these business decision tests.
vi.mock('@renderer/services/confirm', () => ({ confirmAction: (message: string) => Promise.resolve(window.confirm(message)) }))
