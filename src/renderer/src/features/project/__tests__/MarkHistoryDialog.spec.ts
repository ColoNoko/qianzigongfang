// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MarkHistoryDialog from '../MarkHistoryDialog.vue'
import { emptyModeStatus, type MarkAuditOperation } from '@shared/mark-audit'

/**
 * 标记台账对话框：这一版"数据兜底"的可见面。
 *
 * 盯四件事：① 列表说得清（时间/动作/影响面）；② 明细能展开成"谁变成了什么"；
 * ③ 「还原到这一步之前」只对**可撤销且还没被撤销过**的操作出现；
 * ④ 还原真的把 opId 发给主进程，并把"哪几话变了"报给宿主去重算统计。
 */
function operation(partial?: Partial<MarkAuditOperation>): MarkAuditOperation {
  return {
    opId: 'op-1',
    at: 1790520000000,
    kind: 'mark',
    source: 'sidebar-batch',
    mode: 'supervised',
    targetStatus: 'done',
    children: [
      {
        childId: 'c1',
        folderPath: 'E:\\漫画\\第10話',
        entries: [
          {
            pathKey: 'k1',
            path: 'E:\\漫画\\第10話\\012.psd',
            mtimeMs: 5,
            beforeModes: emptyModeStatus(),
            afterModes: { ...emptyModeStatus(), supervised: true },
            beforeTimestamps: {},
            afterTimestamps: { supervised: 1000 }
          }
        ]
      }
    ],
    fileCount: 1,
    skippedCount: 2,
    ...partial
  }
}

function mockComicType(list: MarkAuditOperation[], undoResult?: unknown): void {
  const bridge = {
    memoryListMarkAudit: vi.fn(() => Promise.resolve(list)),
    memoryUndoMark: vi.fn(() =>
      Promise.resolve(undoResult ?? { revertedFiles: 1, childIds: [], operation: null })
    ),
    // 撤销之后 store 会把受影响话的统计重算并落库 —— 这条路径要的 IPC 也一并给上。
    projectSaveProgress: vi.fn(() => Promise.resolve(undefined)),
    storeSet: vi.fn(() => Promise.resolve(undefined)),
    storeGet: vi.fn(() => Promise.resolve([]))
  }
  ;(window as unknown as { comicType: unknown }).comicType = bridge
}

async function mountDialog(props?: { childId?: string }) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(MarkHistoryDialog, {
    props: { open: true, ...props },
    global: { plugins: [pinia] }
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('MarkHistoryDialog', () => {
  it('列表按文案+时间渲染，并标出影响面', async () => {
    mockComicType([operation()])
    const wrapper = await mountDialog()

    const items = wrapper.findAll('[data-testid="mark-history-item"]')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('标记「监修」1 个文件（1 话）')
  })

  it('展开明细：逐文件说清"哪个模式变了"，并报出"没动的有几个"', async () => {
    mockComicType([operation()])
    const wrapper = await mountDialog()

    expect(wrapper.find('[data-testid="mark-history-detail"]').exists()).toBe(false)
    await wrapper.get('[data-testid="mark-history-expand-op-1"]').trigger('click')

    const detail = wrapper.get('[data-testid="mark-history-detail"]')
    expect(detail.text()).toContain('012.psd  监修 ✗→✓')
    expect(detail.text()).toContain('另有 2 个本来就是目标状态')
  })

  it('「还原到这一步之前」只出现在可撤销、且还没被撤销过的操作上', async () => {
    mockComicType([
      operation({ opId: 'op-undo', kind: 'undo', refOpId: 'op-1', targetStatus: undefined }),
      operation({ opId: 'op-migrate', kind: 'migrate' }),
      operation({ opId: 'op-1' })
    ])
    const wrapper = await mountDialog()

    expect(wrapper.find('[data-testid="mark-history-undo-op-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mark-history-undo-op-undo"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mark-history-undo-op-migrate"]').exists()).toBe(false)
    // op-1 已经被 op-undo 撤销过 → 打上「已撤销」并隐藏按钮
    expect(wrapper.find('[data-testid="mark-history-undone-tag"]').exists()).toBe(true)
  })

  it('可撤销的操作点一下就发 opId 给主进程，并把"哪几话变了"报给宿主', async () => {
    mockComicType([operation({ opId: 'op-9' })], {
      revertedFiles: 3,
      childIds: ['c1', 'c2'],
      operation: null
    })
    const wrapper = await mountDialog()

    await wrapper.get('[data-testid="mark-history-undo-op-9"]').trigger('click')
    await flushPromises()

    expect(window.comicType.memoryUndoMark).toHaveBeenCalledWith('op-9')
    expect(wrapper.emitted('changed')![0]).toEqual([['c1', 'c2']])
    const toasts = wrapper.emitted('toast') as Array<[{ message: string }]>
    expect(String(toasts[0][0].message)).toContain('已还原 3 个文件')
  })

  it('「只看当前话」把与当前话无关的记录滤掉', async () => {
    mockComicType([
      operation({ opId: 'op-other', children: [{ childId: 'zz', folderPath: 'E:\\x', entries: [] }] }),
      operation({ opId: 'op-mine' })
    ])
    const wrapper = await mountDialog({ childId: 'c1' })

    expect(wrapper.findAll('[data-testid="mark-history-item"]')).toHaveLength(2)
    await wrapper.get('[data-testid="mark-history-only-current"]').setValue(true)

    const items = wrapper.findAll('[data-testid="mark-history-item"]')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('标记「监修」')
  })

  it('空台账给一句人话，而不是一片空白', async () => {
    mockComicType([])
    const wrapper = await mountDialog()

    expect(wrapper.get('[data-testid="mark-history-list"]').text()).toContain('还没有任何标记记录')
  })
})
