// @vitest-environment jsdom
/**
 * 截图检查：字体页（`views/FontManager.vue`）。
 *
 * 这个页面此前**没有截图面板**，所以「识字网」这类新增控件没人"看过"。
 * 面板截的是**页面上半部**（页头 + 搜索/预览卡 + 筛选与动作那一行）——
 * 「识字网」就在那一行里，旁边是「多选卸载」和右端的「显示 x / y」。
 *
 * 注意：整页很高（下面还有几百张字体卡），面板高度只取到动作行下方一点，
 * 足够核对"按钮在这一行的位置、与隔壁按钮是否同档"。
 */
import { describe, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { FontListResult, SystemFontInfo } from '@shared/ipc-api'
import FontManager from '@renderer/views/FontManager.vue'
import { shoot } from './panel-harness'

function mockFonts(): SystemFontInfo[] {
  const base = {
    postScriptName: 'ToolboxHeiGB18030-Ultra',
    displayName: '[工具箱]黑体-简繁 Ultra',
    fileName: 'toolbox-HeiGB18030-Ultra.ttf',
    format: 'TTF' as const,
    languages: ['chinese' as const, 'latin' as const]
  }
  return [
    {
      ...base,
      id: 'managed-font',
      family: '[工具箱]黑体-简繁',
      style: 'Ultra',
      filePath: 'C:\\Users\\test\\AppData\\Local\\Microsoft\\Windows\\Fonts\\toolbox-HeiGB18030-Ultra.ttf',
      source: 'managed',
      managed: true,
      installedAt: 1
    },
    {
      ...base,
      id: 'system-font',
      family: '[工具箱]有圆体-简繁',
      style: 'Bold',
      postScriptName: 'toolboxYouYuanF-Bold',
      displayName: '[工具箱]有圆体-简繁 Bold',
      fileName: 'toolboxYouYuanF-Bold.ttf',
      filePath: 'C:\\WINDOWS\\Fonts\\toolboxYouYuanF-Bold.ttf',
      source: 'system',
      managed: false
    }
  ]
}

async function renderFontManager(): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)

  const result: FontListResult = { supported: true, fonts: mockFonts(), scannedAt: Date.now() }
  window.comicType = {
    fontList: vi.fn().mockResolvedValue(result),
    openExternal: vi.fn().mockResolvedValue({ ok: true })
  } as unknown as typeof window.comicType

  const wrapper = mount(FontManager, { global: { plugins: [pinia] } })
  await flushPromises()
  const html = wrapper.html()
  wrapper.unmount()
  return html
}

describe('visual: 字体页', () => {
  it('renders the header, the search card and the row holding 识字网', async () => {
    await shoot({
      name: 'font-manager',
      panels: [{ label: '字体页上半部（含「识字网」那一行）', html: await renderFontManager(), width: 1160, height: '420px' }]
    })
  })
})
