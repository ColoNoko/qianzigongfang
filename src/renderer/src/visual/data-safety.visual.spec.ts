// @vitest-environment jsdom
/**
 * 数据安全三件套的截图检查（第十四轮）。
 *
 * 这一组盯的是"出事了看不看得懂"：
 *   ① 设置页「数据安全」节 —— 按钮、备份列表（**只摆最新 3 条** + 「全部 N 条」入口）、自动备份开关；
 *   ② 备份管理弹窗（第二十三轮）—— 全部 8 份都在这里，行渲染与卡片是同一个组件；
 *   ③ 标记记录对话框 —— 每次操作一行，展开后是逐文件的 `012.psd 监修 ✗→✓`；
 *   ④ 从备份还原 —— 先看清"会把几行改回去"，再点确认。
 *
 * 单测只能证明"控件在、事件对"，证明不了"人一眼看得懂"。
 * 前置与产出口径同 panel-harness：先 `electron-vite build` 出 CSS，再跑
 * `vitest run --config vitest.visual.config.js`。产出在 `temp/visual/data-safety/{dark,light}.png`。
 */
import { beforeEach, describe, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MarkHistoryDialog from '@renderer/features/project/MarkHistoryDialog.vue'
import RestoreMarksDialog from '@renderer/features/project/RestoreMarksDialog.vue'
import DiagnosticsDialog from '@renderer/features/project/DiagnosticsDialog.vue'
import BackupManagerDialog from '@renderer/features/settings/BackupManagerDialog.vue'
import { emptyModeStatus, type MarkAuditOperation } from '@shared/mark-audit'
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

const BACKUP = {
  file: 'qianzi-gongfang-20260928-001530-120-manual.sqlite',
  path: 'D:\\app\\data\\backups\\qianzi-gongfang-20260928-001530-120-manual.sqlite',
  at: 1790520930000,
  bytes: 3_210_000,
  reason: 'manual',
  sha256: 'a'.repeat(64),
  rows: { project_memory_files: 3281, project_memory: 204 }
}

/**
 * 八份备份（第二十三轮）：设置页那张卡只摆**最新 3 条**，其余进「备份管理」弹窗 ——
 * 所以截图用的份数必须多于 3，否则「全部 N 条」入口根本不出现、两张面板看不出差别。
 */
function backupFixture(): Array<typeof BACKUP & { reason: string }> {
  const reasons = ['manual', 'delivery', 'auto', 'before-restore', 'unknown']
  return Array.from({ length: 8 }, (_, index) => {
    const reason = reasons[index % reasons.length]
    return {
      ...BACKUP,
      file: `qianzi-gongfang-2026092${index}-001530-120-${reason}.sqlite`,
      path: `D:\\app\\data\\backups\\qianzi-gongfang-2026092${index}-001530-120-${reason}.sqlite`,
      at: BACKUP.at - index * 3600_000,
      bytes: BACKUP.bytes - index * 60_000,
      reason,
      rows: { project_memory_files: 3281 - index, project_memory: 204 }
    }
  })
}

function auditOperation(): MarkAuditOperation {
  const entry = (index: number) => ({
    pathKey: `k${index}`,
    path: `E:\\漫画\\第10話\\${String(index).padStart(3, '0')}.psd`,
    mtimeMs: 5,
    beforeModes: emptyModeStatus(),
    afterModes: { ...emptyModeStatus(), supervised: true },
    beforeTimestamps: {},
    afterTimestamps: { supervised: 1000 }
  })
  return {
    opId: 'op-1',
    at: 1790520900000,
    kind: 'mark',
    source: 'sidebar-batch',
    mode: 'supervised',
    targetStatus: 'done',
    children: [
      {
        childId: 'c1',
        folderPath: 'E:\\漫画\\第10話',
        entries: [entry(11), entry(12), entry(13)]
      },
      { childId: 'c2', folderPath: 'E:\\漫画\\第11話', entries: [entry(21)] }
    ],
    fileCount: 4,
    skippedCount: 2
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  stubMatchMedia()
  ;(window as unknown as { comicType: unknown }).comicType = {
    storeGet: vi.fn(() => Promise.resolve(undefined)),
    storeSet: vi.fn(() => Promise.resolve(undefined)),
    projectGetTree: vi.fn(() => Promise.resolve([])),
    writeLog: vi.fn(() => Promise.resolve(undefined)),
    dbBackupList: vi.fn(() => Promise.resolve(backupFixture())),
    dbBackupCreate: vi.fn(() => Promise.resolve(BACKUP)),
    dbBackupRestorePreview: vi.fn(() =>
      Promise.resolve({
        file: BACKUP.file,
        at: BACKUP.at,
        changingFiles: 4,
        missingInBackup: 2,
        missingInCurrent: 1,
        children: [
          {
            childId: 'c1',
            folderPath: 'E:\\漫画\\第10話',
            changingCount: 3,
            sample: ['011.psd  监修 ✓→✗', '012.psd  监修 ✓→✗', '013.psd  监修 ✓→✗']
          }
        ]
      })
    ),
    dbBackupRestoreApply: vi.fn(() =>
      Promise.resolve({ revertedFiles: 4, childIds: ['c1'], operation: null })
    ),
    memoryListMarkAudit: vi.fn(() => Promise.resolve([auditOperation()])),
    diagnosticsSnapshot: vi.fn(() =>
      Promise.resolve({
        appVersion: '0.4.0',
        electronVersion: '39.8.10',
        platform: 'win32 x64',
        dataDirectory: 'D:\\示例目录\\汉化工坊\\app\\data',
        databasePath: 'D:\\示例目录\\汉化工坊\\app\\data\\database\\qianzi-gongfang.sqlite',
        databaseBytes: 3_300_000,
        logPath: 'D:\\示例目录\\汉化工坊\\app\\data\\logs\\psd-manager.log',
        logBytes: 12_600_000,
        backupCount: 8,
        newestBackupAt: 1790520930000,
        childCount: 204,
        recordCount: 3281,
        markCounts: { typeset: 1628, translated: 26, proofread: 973, supervised: 1044 }
      })
    ),
    readLogTail: vi.fn(() =>
      Promise.resolve(
        [
          '2026-09-28T23:20:11.001Z INFO [psd-thumb] PSD render success {"psdPath":"E:\\\\漫画\\\\第10話\\\\012.psd","dataUrlLength":184320}',
          '2026-09-28T23:20:12.442Z INFO [project-workspace] Child project scan completed {"childId":"c1","pairCount":38}',
          '2026-09-28T23:20:15.900Z WARN [main-process] Failed to persist window bounds {"error":"disk busy"}'
        ].join('\n')
      )
    ),
    memoryUndoMark: vi.fn(() => Promise.resolve({ revertedFiles: 4, childIds: ['c1'], operation: null })),
    openPath: vi.fn(() => Promise.resolve({ ok: true }))
  }
})

async function settingsSectionHtml(): Promise<string> {
  SettingsComponent = (await import('@renderer/views/Settings.vue')).default
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(SettingsComponent, { global: { plugins: [pinia] } })
  await flushPromises()
  const html = wrapper.get('[data-testid="settings-data-safety-section"]').html()
  wrapper.unmount()
  return html
}

async function auditDialogHtml(): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(MarkHistoryDialog, {
    props: { open: true },
    global: { plugins: [pinia] }
  })
  await flushPromises()
  // 展开明细：这一组要看的就是"逐文件那几行"
  await wrapper.get('[data-testid="mark-history-expand-op-1"]').trigger('click')
  await flushPromises()
  const html = wrapper.get('[data-testid="mark-history-dialog"]').html()
  wrapper.unmount()
  return html
}

async function diagnosticsDialogHtml(): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(DiagnosticsDialog, { props: { open: true }, global: { plugins: [pinia] } })
  await flushPromises()
  const html = wrapper.get('[data-testid="diagnostics-dialog"]').html()
  wrapper.unmount()
  return html
}

async function restoreDialogHtml(): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(RestoreMarksDialog, {
    props: { open: true, backup: BACKUP },
    global: { plugins: [pinia] }
  })
  await flushPromises()
  const html = wrapper.get('[data-testid="restore-marks-dialog"]').html()
  wrapper.unmount()
  return html
}

async function backupManagerHtml(): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(BackupManagerDialog, {
    props: { items: backupFixture() },
    global: { plugins: [pinia] }
  })
  await flushPromises()
  const html = wrapper.get('[data-testid="db-backup-manager-dialog"]').html()
  wrapper.unmount()
  return html
}

describe('visual: 数据安全（备份 / 还原 / 标记记录）', () => {
  it('设置页那一节、备份管理弹窗、台账对话框、还原确认窗 —— 四块面板', async () => {
    await shoot({
      name: 'data-safety',
      panels: [
        { label: '设置 · 数据安全（只摆最新 3 条 + 「全部 8 条」入口）', html: await settingsSectionHtml(), width: 760, height: '320px' },
        { label: '备份管理弹窗（全部 8 份，可滚；行渲染与卡片同一份）', html: await backupManagerHtml(), width: 860, height: '460px' },
        { label: '标记记录（展开明细：逐文件变化）', html: await auditDialogHtml(), width: 860, height: '460px' },
        { label: '从备份还原标记（先看清会改什么）', html: await restoreDialogHtml(), width: 700, height: '420px' },
        { label: '诊断（D2：事实 + 日志尾部 + 一键复制）', html: await diagnosticsDialogHtml(), width: 860, height: '560px' }
      ]
    })
  })
})
