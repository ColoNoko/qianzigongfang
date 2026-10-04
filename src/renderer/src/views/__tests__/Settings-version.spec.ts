// @vitest-environment jsdom
/**
 * 「版本号唯一化」（2026-10-04）。
 *
 * 起因：版本号原来散在**四处** —— `package.json` / `Settings.vue` 里的 `APP_VERSION`
 * 字面量 / 这条测试里的 `toContain('1.0.0')` / 交接文档。改版本时漏掉任何一处，
 * 结果都很难看：界面显示旧版本，或者测试莫名其妙变红。
 *
 * 现在只有**一处**真源：`package.json` 的 `version` —— 构建期由 vite 的 `define`
 * 注入成全局 `__APP_VERSION__`（`electron.vite.config.ts` 与三个 vitest 配置同步注入）。
 *
 * 两条锁：
 *   ① 界面显示的版本 === `package.json` 里那个（读真实文件，不抄常量）；
 *   ② 「不许再硬编码」：源码里不许出现版本号字面量 —— 这条是**源码契约锁**，
 *      与「CSS 契约锁」同一手法（jsdom 量不出"将来有人又写死一个"这类问题）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Settings from '../Settings.vue'
import { useToastStore } from '@renderer/stores/toast'

const PACKAGE_VERSION = (
  JSON.parse(readFileSync(resolve(__dirname, '../../../../../package.json'), 'utf8')) as {
    version: string
  }
).version

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

async function mountSettings() {
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
    diagnosticsSnapshot: vi.fn().mockResolvedValue({ appVersion: PACKAGE_VERSION }),
    readLogTail: vi.fn().mockResolvedValue(''),
    checkForUpdate: vi.fn().mockResolvedValue({ status: 'up-to-date', currentVersion: PACKAGE_VERSION }),
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('版本号唯一化（2026-10-04）', () => {
  it('设置页显示的版本 === package.json 里的版本（读真实文件，不抄常量）', async () => {
    const { wrapper } = await mountSettings()
    expect(wrapper.get('[data-testid="about-version"]').text()).toBe(PACKAGE_VERSION)
  })

  /**
   * 源码契约锁：`Settings.vue` 里**不许出现任何** `x.y.z` 字面量，版本只能来自 `__APP_VERSION__`。
   *
   * ⚠️ 为什么只扫这一个文件、不扫测试文件：测试里 `appVersion: '0.4.0'` 那种是**诊断面板的夹具**，
   * 与被显示的版本号无关；把它们一起扫会变成"为了过锁而改夹具"（第一版就是这么假红的）。
   * 真正要守的东西已经被上面那条锁咬住了：**界面显示的版本必须等于 package.json 里的版本**。
   */
  it('Settings.vue 里不许出现版本号字面量，版本只能来自 __APP_VERSION__', () => {
    const file = 'src/renderer/src/views/Settings.vue'
    const source = readFileSync(resolve(__dirname, '../../../../../', file), 'utf8')
    // 注释里允许写（说明性文字），代码里不允许
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code, `${file} 里出现了硬编码的版本号 —— 应该用 __APP_VERSION__`).not.toMatch(
      /\b\d+\.\d+\.\d+\b/
    )
    expect(code, '版本号必须绑定 __APP_VERSION__').toContain('const APP_VERSION = __APP_VERSION__')
  })
})
