// @vitest-environment jsdom
/**
 * 「修改扫描目录」弹窗（2026-10-05，需求二）—— 纯展示，只画 + emit。
 *
 * 与 `SelfCheckDialog` 同一套分工：规则与 IPC 在 `useSourceRootEditor` 里，这里只负责画。
 * 于是这一片锁只管三件**用户看得见**的事：
 *   ① "当前扫描目录"与"修改后"必须**同时**摆在眼前（用户要能对着确认）；
 *   ② 候选层的勾选与"一层都不勾就是用这个目录本身"要说清楚（需求二第 4 条）；
 *   ③ 冲突（目录里住着**别的作品**的话）要红字**点名那一部**，并给一个显式的"我知道"。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SourceRootDialog from '../SourceRootDialog.vue'
import type { SourceRootEdit } from '../useSourceRootEditor'

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    visible: true,
    busy: false,
    parentTitle: '老师的人偶',
    mode: 'manual' as const,
    directory: '',
    layers: [],
    layerError: '',
    selectedLayerPaths: [],
    acknowledged: false,
    currentRoots: ['D:\\漫画库\\嵌字\\老师的人偶（米饭'],
    currentIsRemembered: false,
    currentCandidateCount: 2,
    currentMessage: '',
    conflicts: [],
    canSave: false,
    plan: { kind: 'invalid', reason: 'no-directory' } as SourceRootEdit,
    ...overrides
  }
}

function render(overrides: Record<string, unknown> = {}) {
  return mount(SourceRootDialog, { props: baseProps(overrides) })
}

describe('SourceRootDialog：当前 vs 修改后', () => {
  it('"当前扫描目录"列出根，并说明来源（自动推导 / 你指定过）', () => {
    const auto = render()
    expect(auto.find('[data-testid="source-root-current"]').text()).toContain('自动推导')
    expect(auto.find('[data-testid="source-root-current"]').text()).toContain(
      'D:\\漫画库\\嵌字\\老师的人偶（米饭'
    )

    const remembered = render({
      currentIsRemembered: true,
      currentRoots: ['E:\\搬砖\\无', 'E:\\搬砖\\有']
    })
    expect(remembered.find('[data-testid="source-root-current"]').text()).toContain('指定')
    expect(remembered.find('[data-testid="source-root-current"]').text()).toContain('E:\\搬砖\\有')
  })

  it('"修改后"列出将要写的根（对着上面确认用）', () => {
    const wrapper = render({
      directory: 'E:\\搬砖',
      selectedLayerPaths: ['E:\\搬砖\\无', 'E:\\搬砖\\有'],
      plan: { kind: 'roots', roots: ['E:\\搬砖\\无', 'E:\\搬砖\\有'] } as SourceRootEdit,
      canSave: true
    })

    const after = wrapper.find('[data-testid="source-root-after"]')
    expect(after.text()).toContain('E:\\搬砖\\无')
    expect(after.text()).toContain('E:\\搬砖\\有')
  })

  it('选了"恢复自动推导" ⇒ 修改后写明"清掉记住的目录"，不列根', () => {
    const wrapper = render({
      mode: 'auto',
      plan: { kind: 'auto' } as SourceRootEdit,
      currentIsRemembered: true,
      canSave: true
    })
    expect(wrapper.find('[data-testid="source-root-after"]').text()).toContain('自动推导')
  })

  it('还没选目录 ⇒ 修改后明说"还没选"，不给一个空的假象', () => {
    const wrapper = render()
    expect(wrapper.find('[data-testid="source-root-after"]').text()).toContain('还没选')
  })
})

describe('SourceRootDialog：候选层与"哪一层是各话所在的那一层"', () => {
  const layers = [
    { name: '无', isDirectory: true, absPath: 'E:\\搬砖\\无' },
    { name: '有', isDirectory: true, absPath: 'E:\\搬砖\\有' }
  ]

  it('列出候选层，勾选状态跟着传入的选中集合走', () => {
    const wrapper = render({
      directory: 'E:\\搬砖',
      layers,
      selectedLayerPaths: ['E:\\搬砖\\无']
    })

    const boxes = wrapper.findAll('[data-testid="source-root-layer"]')
    expect(boxes).toHaveLength(2)
    expect((boxes[0].element as HTMLInputElement).checked).toBe(true)
    expect((boxes[1].element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('无')
    expect(wrapper.text()).toContain('有')
  })

  it('勾一层就 emit 那一层的路径（父级负责翻转）', async () => {
    const wrapper = render({ directory: 'E:\\搬砖', layers })
    await wrapper.findAll('[data-testid="source-root-layer"]')[1].setValue(true)
    expect(wrapper.emitted('toggleLayer')?.[0]).toEqual(['E:\\搬砖\\有'])
  })

  it('明写"一层都不勾 = 就用这个目录本身"（需求二第 4 条的那句话）', () => {
    const wrapper = render({ directory: 'E:\\搬砖', layers })
    expect(wrapper.find('[data-testid="source-root-layers"]').text()).toContain('这个目录本身')
  })

  it('目录读不到时给提示，但保存这条路还在（不是死胡同）', () => {
    const wrapper = render({
      directory: 'E:\\搬砖',
      layerError: '读不到这个目录',
      plan: { kind: 'roots', roots: ['E:\\搬砖'] } as SourceRootEdit,
      canSave: true
    })
    expect(wrapper.text()).toContain('读不到这个目录')
    expect(wrapper.find('[data-testid="source-root-save"]').attributes('disabled')).toBeUndefined()
  })
})

describe('SourceRootDialog：目录里住着别的作品时', () => {
  const conflicted = {
    directory: 'D:\\漫画库\\嵌字',
    plan: { kind: 'roots', roots: ['D:\\漫画库\\嵌字'] } as SourceRootEdit,
    conflicts: [{ root: 'D:\\漫画库\\嵌字', parentId: 'p-mama', parentTitle: '鹅妈妈' }]
  }

  it('红字**点名那一部作品**（只说"有问题"没用）', () => {
    const wrapper = render(conflicted)
    const box = wrapper.find('[data-testid="source-root-conflict"]')
    expect(box.exists()).toBe(true)
    expect(box.text()).toContain('鹅妈妈')
  })

  it('给一个显式的"我知道"开关，emit 出去（默认不勾）', async () => {
    const wrapper = render(conflicted)
    const ack = wrapper.find('[data-testid="source-root-acknowledge"]')
    expect(ack.exists()).toBe(true)
    expect((ack.element as HTMLInputElement).checked).toBe(false)

    await ack.setValue(true)
    expect(wrapper.emitted('update:acknowledged')?.[0]).toEqual([true])
  })

  it('没勾"我知道"时保存是灰的（由 canSave 决定，弹窗照实画）', () => {
    const blocked = render({ ...conflicted, canSave: false })
    expect(blocked.find('[data-testid="source-root-save"]').attributes('disabled')).toBeDefined()

    const allowed = render({ ...conflicted, acknowledged: true, canSave: true })
    expect(allowed.find('[data-testid="source-root-save"]').attributes('disabled')).toBeUndefined()
  })
})

describe('SourceRootDialog：动作与说明', () => {
  it('「恢复自动推导」只在**记住过**的时候出现', () => {
    expect(render().find('[data-testid="source-root-reset"]').exists()).toBe(false)
    expect(
      render({ currentIsRemembered: true }).find('[data-testid="source-root-reset"]').exists()
    ).toBe(true)
  })

  it('点「恢复自动推导」/「保存」/「浏览」都照实 emit', async () => {
    const wrapper = render({ currentIsRemembered: true, canSave: true })
    await wrapper.find('[data-testid="source-root-reset"]').trigger('click')
    await wrapper.find('[data-testid="source-root-save"]').trigger('click')
    await wrapper.find('[data-testid="source-root-pick"]').trigger('click')

    expect(wrapper.emitted('resetToAuto')).toBeTruthy()
    expect(wrapper.emitted('save')).toBeTruthy()
    expect(wrapper.emitted('pickDirectory')).toBeTruthy()
  })

  it('说明写清"这只影响检测新章节，不动各话自己的路径"（免得用户以为会挪文件）', () => {
    const wrapper = render()
    expect(wrapper.text()).toContain('各话')
  })

  it('路径输入框带浅色提示，且与全站 placeholder 同一套（不写死颜色）', () => {
    const wrapper = render()
    expect(
      wrapper.find('[data-testid="source-root-directory"]').attributes('placeholder')
    ).toBeTruthy()
    expect(wrapper.html()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  /**
   * 用户可见文案里**不许出现 markdown 星号** —— 它会原样渲染（本仓库的真实事故：
   * 按钮上出现 `**标记后下一张**`）。这里跟着 `Progress.spec` / `GuideDialog.spec`
   * 的既有口径走：断言**渲染出来的文字**里没有 `**`。
   */
  it('渲染出来的文字里没有 markdown 星号（加粗要用 strong，不是 **）', () => {
    const wrapper = render({
      directory: 'D:\\漫画库\\嵌字',
      plan: { kind: 'roots', roots: ['D:\\漫画库\\嵌字'] } as SourceRootEdit,
      conflicts: [{ root: 'D:\\漫画库\\嵌字', parentId: 'p-mama', parentTitle: '鹅妈妈' }],
      layers: [{ name: '无', isDirectory: true, absPath: 'D:\\漫画库\\嵌字\\无' }],
      currentIsRemembered: true,
      canSave: false
    })
    expect(wrapper.text()).not.toContain('**')
  })
})
