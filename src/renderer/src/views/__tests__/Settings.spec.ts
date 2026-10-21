// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
config.global.stubs.teleport = true
config.global.renderStubDefaultSlot = true
enableAutoUnmount(afterEach)
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from '@renderer/stores/toast'

// Stub matchMedia so the theme store's resolvedTheme getter works in jsdom.
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

function setupComicType(): {
  storeGet: ReturnType<typeof vi.fn>
  storeSet: ReturnType<typeof vi.fn>
  importLegacyJson: ReturnType<typeof vi.fn>
} {
  const storeGet = vi.fn().mockResolvedValue(undefined)
  const storeSet = vi.fn().mockResolvedValue(undefined)
  const importLegacyJson = vi.fn().mockResolvedValue({
    canceled: false,
    importedFiles: 1,
    skippedFiles: 0,
    projectsAdded: 2,
    memoryProjectsImported: 1,
    fontRecordsImported: 3,
    importedSettings: 1,
    warnings: []
  })
  window.comicType = {
    storeGet,
    storeSet,
    projectGetTree: vi.fn().mockResolvedValue([]),
    importLegacyJson
  } as unknown as typeof window.comicType
  return { storeGet, storeSet, importLegacyJson }
}

let SettingsComponent: (typeof import('../Settings.vue'))['default']

async function loadComponent() {
  SettingsComponent = (await import('../Settings.vue')).default
}

async function mountSettings() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(SettingsComponent, {
    attachTo: document.body,
    global: { plugins: [pinia] }
  })
  return { wrapper, pinia }
}

beforeEach(async () => {
  await loadComponent()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-mode')
  document.documentElement.removeAttribute('style')
  stubMatchMedia()
})

describe('Settings', () => {
  it('custom colors stay a draft until saved', async () => {
    const { storeSet } = setupComicType()
    const { wrapper } = await mountSettings()
    await flushPromises()
    const open = async () => {
      await wrapper.findAll('button').find(b => b.text() === '自定义…')!.trigger('click')
      await flushPromises()
    }
    await open()
    wrapper.findAllComponents({ name: 'ControlInput' }).find(c => c.attributes('aria-label') === '色相')!.vm.$emit('input', { target: { value: '145' } })
    await flushPromises()
    expect(storeSet).not.toHaveBeenCalledWith('theme.colors', expect.anything())
    await wrapper.findAll('button').find(b => b.text() === '取消')!.trigger('click')
    await open()
    expect(wrapper.findAllComponents({ name: 'ControlInput' }).find(c => c.attributes('aria-label') === '色相')!.props('value')).toBe(262)
    wrapper.findAllComponents({ name: 'ControlInput' }).find(c => c.attributes('aria-label') === '色相')!.vm.$emit('input', { target: { value: '145' } })
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === '保存')!.trigger('click')
    await flushPromises()
    expect(storeSet).toHaveBeenCalledWith('theme.colors', { hue: 145, saturation: 58, neutralSaturation: 8 })
  })

  it('limits default duties to two and exposes their priority', async () => {
    setupComicType()
    const { wrapper } = await mountSettings()
    await flushPromises()
    expect(wrapper.find('[aria-label="双职责优先级"]').exists()).toBe(false)
    await wrapper.get('[aria-label="新漫画默认职责"] button[value="translated"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="双职责优先级"]').exists()).toBe(true)
    expect((wrapper.get('[aria-label="新漫画默认职责"] button[value="proofread"]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.get('[aria-label="新漫画默认职责"] button[value="translated"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="双职责优先级"]').exists()).toBe(false)
  })

  it('offers a follow-system appearance mode and persists it', async () => {
    const { storeSet } = setupComicType()
    const { wrapper } = await mountSettings()

    await wrapper.get('[data-testid="theme-mode-system"]').trigger('click')

    expect(document.documentElement.dataset.themeMode).toBe('system')
    expect(storeSet).toHaveBeenCalledWith('theme', 'system')
  })

  it("clicking '大' radio calls storeSet with 'ui.thumbSize' and '大'", async () => {
    const { storeSet } = setupComicType()
    const { wrapper } = await mountSettings()

    const radio = wrapper.find('[aria-label="全局缩略图大小"] button[value="大"]')
    expect(radio.exists()).toBe(true)
    await radio.trigger('click')

    expect(storeSet).toHaveBeenCalledWith('ui.thumbSize', '大')
  })

  it('switches child projects to descending order and persists it', async () => {
    const { storeSet } = setupComicType()
    const { wrapper } = await mountSettings()

    const radio = wrapper.get('[aria-label="集数排序"] button[value="descending"]')
    await radio.trigger('click')

    expect(storeSet).toHaveBeenCalledWith('ui.childSortOrder', 'descending')
  })

  it("default thumbSize selection is '中'", async () => {
    setupComicType()
    const { wrapper } = await mountSettings()
    await flushPromises()

    const midRadio = wrapper.find('[aria-label="全局缩略图大小"] button[value="中"]')
    expect(midRadio.attributes('aria-pressed')).toBe('true')
  })

  it('imports automatically recognized legacy JSON and reports the result', async () => {
    const { importLegacyJson } = setupComicType()
    const { wrapper, pinia } = await mountSettings()

    await wrapper.get('[data-testid="import-legacy-json"]').trigger('click')
    await flushPromises()

    expect(importLegacyJson).toHaveBeenCalledOnce()
    const toast = useToastStore(pinia)
    expect(toast.toasts.some((item) => item.message.includes('新增 2 个项目'))).toBe(true)
  })
})

/**
 * 数据安全（第十四轮）：备份 / 从备份还原标记 / 标记记录入口。
 *
 * 这一节的每个按钮都对应"真出事时能不能救回来"，所以连"点了到底调了哪个 IPC"一起锁。
 */
describe('Settings 数据安全', () => {
  const backup = {
    file: 'qianzi-gongfang-20260928-000000-000-manual.sqlite',
    path: 'D:\\app\\data\\backups\\qianzi-gongfang-20260928-000000-000-manual.sqlite',
    at: 1790520000000,
    bytes: 3_200_000,
    reason: 'manual',
    sha256: 'a'.repeat(64),
    rows: { project_memory_files: 3281, project_memory: 204 }
  }

  /**
   * 造 N 份备份（第 0 份最新）—— 第二十三轮「卡片只摆最新 3 条、其余进弹窗」用。
   * 每份给一个**不同的 reason**，这样行内按钮的 testid（`db-backup-restore-<reason>`）不重名，
   * 测试能指名道姓点"第 4 条那份"。
   */
  interface BackupFixture {
    file: string
    path: string
    at: number
    bytes: number
    reason: string
    sha256: string
    rows: Record<string, number>
  }

  function makeBackups(count: number): BackupFixture[] {
    const reasons = ['manual', 'delivery', 'auto', 'before-restore', 'unknown']
    return Array.from({ length: count }, (_, index) => {
      const reason = reasons[index % reasons.length]
      const file = `qianzi-gongfang-2026092${index}-000000-000-${reason}.sqlite`
      return {
        file,
        path: `D:\\app\\data\\backups\\${file}`,
        at: 1790520000000 - index * 3_600_000,
        bytes: 3_200_000 - index * 100_000,
        reason,
        sha256: String(index).repeat(64).slice(0, 64),
        rows: { project_memory_files: 3281 - index, project_memory: 204 }
      }
    })
  }

  function setupSafetyBridge(overrides?: {
    list?: unknown[]
    preview?: unknown
    create?: unknown
  }): { dbBackupCreate: ReturnType<typeof vi.fn>; dbBackupRestorePreview: ReturnType<typeof vi.fn>; openPath: ReturnType<typeof vi.fn> } {
    const dbBackupCreate = vi.fn(() =>
      Promise.resolve(overrides?.create ?? backup)
    )
    const dbBackupRestorePreview = vi.fn(() =>
      Promise.resolve(
        overrides?.preview ?? {
          file: backup.file,
          at: backup.at,
          changingFiles: 3,
          missingInBackup: 0,
          missingInCurrent: 0,
          children: [
            {
              childId: 'c1',
              folderPath: 'E:\\漫画\\第10話',
              changingCount: 3,
              sample: ['012.psd  监修 ✓→✗']
            }
          ]
        }
      )
    )
    const openPath = vi.fn(() => Promise.resolve({ ok: true }))
    window.comicType = {
      storeGet: vi.fn().mockResolvedValue(undefined),
      storeSet: vi.fn().mockResolvedValue(undefined),
      projectGetTree: vi.fn().mockResolvedValue([]),
      dbBackupList: vi.fn(() => Promise.resolve(overrides?.list ?? [backup])),
      dbBackupCreate,
      dbBackupRestorePreview,
      dbBackupRestoreApply: vi.fn(() =>
        Promise.resolve({ revertedFiles: 3, childIds: ['c1'], operation: null })
      ),
      openPath,
      diagnosticsSnapshot: vi.fn(() =>
        Promise.resolve({
          appVersion: '0.4.0',
          electronVersion: '39.8.10',
          platform: 'win32 x64',
          dataDirectory: 'D:\\app\\data',
          databasePath: 'D:\\app\\data\\database\\qianzi-gongfang.sqlite',
          databaseBytes: 3_300_000,
          logPath: 'D:\\app\\data\\logs\\psd-manager.log',
          logBytes: 1024,
          backupCount: 1,
          newestBackupAt: backup.at,
          childCount: 1,
          recordCount: 10,
          markCounts: { typeset: 10, translated: 0, proofread: 0, supervised: 0 }
        })
      ),
      readLogTail: vi.fn(() => Promise.resolve('日志一行'))
    } as unknown as typeof window.comicType
    return { dbBackupCreate, dbBackupRestorePreview, openPath }
  }

  it('backup management remains accessible with no backups', async () => {
    setupSafetyBridge({ list: [] })
    const { wrapper } = await mountSettings()
    await flushPromises()
    await wrapper.get('[data-testid="db-backup-open-all"]').trigger('click')
    expect(wrapper.get('[data-testid="db-backup-empty"]').text()).toContain('还没有备份')
  })

  /**
   * 2026-09-30 真机事故：交付脚本写的 sidecar 没有 rows，模板里 `item.rows[...]` 直接取属性
   * → 整页 TypeError、设置页全白（连数据安全那一节都找不到）。
   * 锁：条目缺 rows 也要能渲染，行数显示 0，其它字段照常。
   */
  it('备份条目缺 rows 时（交付脚本写的 sidecar）页面照样能开，不整页崩', async () => {
    // 逐字复刻 deliver-windows.mjs 写出来的那份 sidecar：就是没有 rows
    const deliveryLike = {
      file: backup.file,
      path: backup.path,
      at: backup.at,
      bytes: backup.bytes,
      reason: 'delivery',
      sha256: backup.sha256
    }
    setupSafetyBridge({ list: [deliveryLike] })
    const { wrapper } = await mountSettings()
    await flushPromises()

    // 整页真的渲染出来了（出事时这一节根本不存在）
    expect(wrapper.find('[data-testid="settings-data-safety-section"]').exists()).toBe(true)
    await wrapper.get('[data-testid="db-backup-open-all"]').trigger('click')
    const list = wrapper.get('[data-testid="db-backup-list"]').text()
    // 行数拿不到就显示 0，不许把整页带崩
    expect(list).toContain('0 条标记记录')
    // 其余字段照旧：来源还认得出是"交付前"
    expect(list).toContain('交付前')
  })

  it('「立即备份」调 dbBackupCreate(manual) 并刷新列表', async () => {
    const { dbBackupCreate } = setupSafetyBridge()
    const { wrapper } = await mountSettings()
    await flushPromises()

    await wrapper.get('[data-testid="db-backup-now"]').trigger('click')
    await flushPromises()

    expect(dbBackupCreate).toHaveBeenCalledWith('manual')
    expect(wrapper.get('[data-testid="db-backup-message"]').text()).toContain('已备份')
  })

  it('「还原标记」先给人看差异（会变几行、哪几话），确认按钮才可用', async () => {
    const { dbBackupRestorePreview } = setupSafetyBridge()
    const { wrapper } = await mountSettings()
    await flushPromises()

    await wrapper.get('[data-testid="db-backup-open-all"]').trigger('click')
    await wrapper.get('[data-testid="db-backup-restore-manual"]').trigger('click')
    await flushPromises()

    expect(dbBackupRestorePreview).toHaveBeenCalledWith(backup.path)
    const dialog = wrapper.get('[data-testid="restore-marks-dialog"]')
    expect(dialog.text()).toContain('会把')
    expect(dialog.text()).toContain('012.psd  监修 ✓→✗')
    expect(
      (wrapper.get('[data-testid="restore-marks-apply"]').element as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('management opens all backups without filling the settings page', async () => {
    setupSafetyBridge({ list: makeBackups(8) })
    const { wrapper } = await mountSettings()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="db-backup-item"]')).toHaveLength(0)
    await wrapper.get('[data-testid="db-backup-open-all"]').trigger('click')
    expect(wrapper.get('[data-testid="db-backup-manager-dialog"]').text()).toContain('共 8 份')
    expect(wrapper.findAll('[data-testid="db-backup-manager-list"] [data-testid="db-backup-item"]')).toHaveLength(8)
  })

  it('弹窗里的「还原标记」还是走既有还原确认窗（不另起一条链路）', async () => {
    const eight = makeBackups(8)
    const { dbBackupRestorePreview } = setupSafetyBridge({ list: eight })
    const { wrapper } = await mountSettings()
    await flushPromises()

    await wrapper.get('[data-testid="db-backup-open-all"]').trigger('click')
    // 第 4 条（before-restore）只在弹窗里有 —— 卡片里那 3 条不含它
    await wrapper
      .get(
        '[data-testid="db-backup-manager-list"] [data-testid="db-backup-restore-before-restore"]'
      )
      .trigger('click')
    await flushPromises()

    expect(dbBackupRestorePreview).toHaveBeenCalledWith(eight[3].path)
    expect(wrapper.find('[data-testid="restore-marks-dialog"]').exists()).toBe(true)
  })

  it('「启动时自动备份」开关落库 ui.autoBackup', async () => {
    setupSafetyBridge()
    const { wrapper } = await mountSettings()
    await flushPromises()
    const storeSet = window.comicType.storeSet as ReturnType<typeof vi.fn>

    await wrapper.get('[data-testid="auto-backup-toggle"]').trigger('click')

    expect(storeSet).toHaveBeenCalledWith('ui.autoBackup', false)
  })

  it('「诊断」按钮打开诊断面板（D2）', async () => {
    setupSafetyBridge()
    const { wrapper } = await mountSettings()
    await flushPromises()

    expect(wrapper.find('[data-testid="diagnostics-dialog"]').exists()).toBe(false)
    await wrapper.get('[data-testid="diagnostics-open"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="diagnostics-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="diagnostics-version"]').text()).toContain('0.4.0')
  })

  it('「标记记录」按钮打开台账对话框', async () => {
    setupSafetyBridge()
    const { wrapper } = await mountSettings()
    await flushPromises()

    await wrapper.get('[data-testid="mark-history-open"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="mark-history-dialog"]').exists()).toBe(true)
  })
})
