// @vitest-environment jsdom
/**
 * 设置页的截图检查（第十七轮）。
 *
 * 这一轮是**纯界面**改动，单测只能证明"控件还在、事件还对"，证明不了
 * "子功能名和说明分得开""三件小设置真的在一行"。所以：
 *   ① 整页（看层级、分组、密度）② 三件小设置那一行（看有没有挤成两行 / 标题被压）
 * 前置与产出口径同 panel-harness：先 `electron-vite build` 出 CSS。
 */
import { beforeEach, describe, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { shoot } from './panel-harness'

let SettingsComponent: (typeof import('@renderer/views/Settings.vue'))['default']

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

beforeEach(() => {
  setActivePinia(createPinia())
  stubMatchMedia()
  ;(window as unknown as { comicType: unknown }).comicType = {
    storeGet: vi.fn(() => Promise.resolve(undefined)),
    storeSet: vi.fn(() => Promise.resolve(undefined)),
    projectGetTree: vi.fn(() => Promise.resolve([])),
    writeLog: vi.fn(() => Promise.resolve(undefined)),
    openPath: vi.fn(() => Promise.resolve({ ok: true })),
    dbBackupList: vi.fn(() =>
      Promise.resolve([
        {
          file: 'qianzi-gongfang-20260930-121355-auto.sqlite',
          path: 'D:\\app\\data\\backups\\qianzi-gongfang-20260930-121355-auto.sqlite',
          at: 1790746435000,
          bytes: 2_500_000,
          reason: 'auto',
          sha256: 'a'.repeat(64),
          rows: { project_memory_files: 3321, project_memory: 205 }
        },
        {
          file: 'qianzi-gongfang-20260929-233545-auto.sqlite',
          path: 'D:\\app\\data\\backups\\qianzi-gongfang-20260929-233545-auto.sqlite',
          at: 1790653545000,
          bytes: 2_500_000,
          reason: 'auto',
          sha256: 'b'.repeat(64),
          rows: { project_memory_files: 3321, project_memory: 205 }
        }
      ])
    ),
    dbBackupCreate: vi.fn(),
    diagnosticsSnapshot: vi.fn(),
    readLogTail: vi.fn(() => Promise.resolve(''))
  }
})

async function settingsHtml(selector?: string): Promise<string> {
  SettingsComponent = (await import('@renderer/views/Settings.vue')).default
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(SettingsComponent, { global: { plugins: [pinia] } })
  await flushPromises()
  const html = selector ? wrapper.get(selector).html() : wrapper.html()
  wrapper.unmount()
  return html
}

describe('visual: 设置页', () => {
  it('整页与设置分组', async () => {
    await shoot({
      name: 'settings',
      panels: [
        { label: '设置页整页（分组 / 三级层级 / 密度）', html: await settingsHtml(), width: 900, height: '1800px' },
        {
          label: '外观与看图：统一设置行',
          html: await settingsHtml('#settings-appearance'),
          width: 900,
          height: '480px'
        },
        {
          label: '项目习惯：默认职责与章节处理',
          html: await settingsHtml('#settings-workflow'),
          width: 900,
          height: '480px'
        },
        {
          label: '页尾：版本与检查更新',
          html: await settingsHtml('[data-testid="settings-about-section"]'),
          width: 560,
          height: '330px'
        }
      ]
    })
  })
})
