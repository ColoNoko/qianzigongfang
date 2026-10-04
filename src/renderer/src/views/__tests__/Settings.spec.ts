// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
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
  it('renders thumbnail and about sections without duplicate theme controls', async () => {
    setupComicType()
    const { wrapper } = await mountSettings()

    expect(wrapper.find('[data-testid="settings-thumb-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-theme-section"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="settings-color-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-about-section"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('缩略图大小')
    expect(wrapper.text()).toContain('关于')
    // 版本号读的是构建期注入的全局（真源 = package.json）——
    // 这里**不许**写版本字面量：以前写死过，改版本必漏（见 Settings-version.spec.ts）
    expect(wrapper.text()).toContain(__APP_VERSION__)
  })

  it('updates the global hue in real time and persists the color settings', async () => {
    const { storeSet } = setupComicType()
    const { wrapper } = await mountSettings()

    const slider = wrapper.get('[data-testid="theme-hue-slider"]')
    await slider.setValue('145')

    // 出厂配色（紫雾 262/58/8）决定这条断言里的饱和度与亮度基数：
    // 拖色相滑杆只改 hue，饱和度/中性饱和度沿用当前设置。
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('hsl(145 58% 52%)')
    expect(storeSet).toHaveBeenCalledWith('theme.colors', {
      hue: 145,
      saturation: 58,
      neutralSaturation: 8
    })
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

    const radio = wrapper.find('[data-testid="thumb-radio-大"]')
    expect(radio.exists()).toBe(true)
    await radio.trigger('change')

    expect(storeSet).toHaveBeenCalledWith('ui.thumbSize', '大')
  })

  it('switches child projects to descending order and persists it', async () => {
    const { storeSet } = setupComicType()
    const { wrapper } = await mountSettings()

    const radio = wrapper.get('[data-testid="child-sort-radio-descending"]')
    await radio.trigger('change')

    expect(storeSet).toHaveBeenCalledWith('ui.childSortOrder', 'descending')
  })

  it("default thumbSize selection is '中'", async () => {
    setupComicType()
    const { wrapper } = await mountSettings()
    await flushPromises()

    const midRadio = wrapper.find('[data-testid="thumb-radio-中"]')
    expect((midRadio.element as HTMLInputElement).checked).toBe(true)
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
 * 看图三件套 · 需求二：自动播放间隔（90 秒那张脸）。
 * 设置页这一栏是"能在设置里调"这句话的落点，所以要有一条真点它的用例。
 */
describe('Settings 预览播放间隔', () => {
  it('三档都在；点「1.5 秒」会把 ui.playIntervalMs 落库', async () => {
    const { storeSet } = setupComicType()
    const { wrapper } = await mountSettings()
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-play-section"]').exists()).toBe(true)
    for (const value of [1500, 2000, 3000]) {
      expect(wrapper.find(`[data-testid="play-interval-radio-${value}"]`).exists()).toBe(true)
    }

    await wrapper.get('[data-testid="play-interval-radio-1500"]').trigger('change')

    expect(storeSet).toHaveBeenCalledWith('ui.playIntervalMs', 1500)
  })

  it('默认选中的是 2 秒', async () => {
    setupComicType()
    const { wrapper } = await mountSettings()
    await flushPromises()

    const checked = wrapper.get('[data-testid="play-interval-radio-2000"]')
      .element as HTMLInputElement
    expect(checked.checked).toBe(true)
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

  it('三样入口都在；有备份时列出时间/来源/行数，没有时给一句人话', async () => {
    setupSafetyBridge()
    const { wrapper } = await mountSettings()
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-data-safety-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="db-backup-now"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mark-history-open"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="db-backup-list"]').text()).toContain('3281 条标记记录')
  })

  it('没有备份时说明白"还没有备份"，而不是空一片', async () => {
    setupSafetyBridge({ list: [] })
    const { wrapper } = await mountSettings()
    await flushPromises()

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

  /**
   * 第二十三轮：设置页里的备份列表**只摆最新 3 条**，其余进「备份管理」弹窗。
   *
   * 为什么不是"就地展开"：保留策略是 `KEEP_BACKUPS = 20`，那块列表迟早会有 20 行
   * （每行约 44px ⇒ 约 880px），设置页会被这一块长期撑长；而同一张卡里已经有
   * 「标记记录 / 诊断 / 还原标记」三个弹窗先例 —— 弹窗是这里既有的语言。
   */
  it('卡片只摆最新 3 条 —— 其余不在设置页里铺开', async () => {
    setupSafetyBridge({ list: makeBackups(8) })
    const { wrapper } = await mountSettings()
    await flushPromises()

    expect(wrapper.findAll('[data-testid="db-backup-item"]')).toHaveLength(3)
    const cardText = wrapper.get('[data-testid="db-backup-list"]').text()
    // 最新那条在（3281），第 4 条（3278）不许出现在卡里
    expect(cardText).toContain('3281 条标记记录')
    expect(cardText).not.toContain('3278 条标记记录')
  })

  it('超过 3 条时给「全部 N 条」入口，文案带真实总数', async () => {
    setupSafetyBridge({ list: makeBackups(8) })
    const { wrapper } = await mountSettings()
    await flushPromises()

    expect(wrapper.get('[data-testid="db-backup-open-all"]').text()).toContain('8')
  })

  it('3 条以内不出现「全部 N 条」入口（没有多余的东西要点）', async () => {
    setupSafetyBridge({ list: makeBackups(3) })
    const { wrapper } = await mountSettings()
    await flushPromises()

    expect(wrapper.find('[data-testid="db-backup-open-all"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="db-backup-item"]')).toHaveLength(3)
  })

  it('点「全部 N 条」开备份管理弹窗：弹窗里是全部 N 条，卡片仍只有 3 条', async () => {
    setupSafetyBridge({ list: makeBackups(8) })
    const { wrapper } = await mountSettings()
    await flushPromises()

    await wrapper.get('[data-testid="db-backup-open-all"]').trigger('click')

    const dialog = wrapper.get('[data-testid="db-backup-manager-dialog"]')
    // 弹窗头把总数写清楚（照 MarkHistoryDialog 的"最近 N 次操作"那样）
    expect(dialog.text()).toContain('共 8 份')
    expect(
      wrapper.findAll('[data-testid="db-backup-manager-list"] [data-testid="db-backup-item"]')
    ).toHaveLength(8)
    // 卡片那一份仍然只有 3 条（行渲染是同一个组件，所以这里必须按卡片范围数，
    // 不能只按 db-backup-list 数 —— 弹窗里那个列表用的是同一个 testid）
    expect(
      wrapper.findAll('[data-testid="settings-data-safety-section"] [data-testid="db-backup-item"]')
    ).toHaveLength(3)
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

    await wrapper.get('[data-testid="auto-backup-toggle"]').setValue(false)

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
