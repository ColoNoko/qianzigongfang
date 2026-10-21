// @vitest-environment jsdom
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
})
