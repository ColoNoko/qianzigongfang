// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isTextEntryTarget, shouldToggleAddModeByTab } from '../keyboard-target'

describe('isTextEntryTarget · 这一下键盘该不该被全局快捷键接管', () => {
  it('输入框 / 多行框 ⇒ 不管（否则在缩放输入框里按方向键会翻页）', () => {
    expect(isTextEntryTarget(document.createElement('input'))).toBe(true)
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true)
  })

  it('内容可编辑元素 ⇒ 不管', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, 'isContentEditable', { value: true })
    expect(isTextEntryTarget(div)).toBe(true)
  })

  it('普通元素 / 按钮 ⇒ 管（快捷键照常工作）', () => {
    expect(isTextEntryTarget(document.createElement('div'))).toBe(false)
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false)
  })

  it('大小写不敏感；null / undefined 一律当"管"（全局监听拿不到 target 的场合）', () => {
    expect(isTextEntryTarget(document.createElement('INPUT'))).toBe(true)
    expect(isTextEntryTarget(null)).toBe(false)
    expect(isTextEntryTarget(undefined)).toBe(false)
  })
})

/**
 * 「新增框」的 Tab 入口（第 5 批 5d-2）。
 *
 * 口径 A（用户拍板）：**只认"焦点在原图栏内"**。判据的锚点是**图片那张可聚焦层**
 * （`tabindex="0"` 的手势层）—— 见 `keyboard-target.ts` 里那段"真机更正"：
 * 光判"在容器内"是不够的，真机上点图之后焦点根本不在栏内，
 * 而判"在容器内"又会把"焦点在某条译文行上"也算进去（那正是"按两下 Tab 才生效"的来历）。
 */
describe('shouldToggleAddModeByTab · 这一下 Tab 该不该切「新增框」', () => {
  /** 造"图片那张可聚焦层 + 栏内别的控件"的结构。 */
  function pane(): { layer: HTMLElement; rowButton: HTMLButtonElement } {
    const root = document.createElement('div')
    const layer = document.createElement('div')
    const rowButton = document.createElement('button')
    root.appendChild(layer)
    root.appendChild(rowButton)
    document.body.appendChild(root)
    return { layer, rowButton }
  }

  function tabEvent(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, ...init })
    Object.defineProperty(event, 'target', { value: target })
    return event
  }

  it('焦点就在图上（锚点自身）、无修饰键 ⇒ 切', () => {
    const { layer } = pane()
    expect(shouldToggleAddModeByTab(tabEvent(layer), layer)).toBe(true)
  })

  it('焦点在**栏内别的地方**（右栏那条行按钮的同类控件）⇒ 不切 —— 让 Tab 正常移焦', () => {
    const { layer, rowButton } = pane()
    // ⚠️ 这一条就是真机那个坑：判"在容器内"的话它会是 true，于是焦点被焊住出不来。
    expect(shouldToggleAddModeByTab(tabEvent(rowButton), layer)).toBe(false)
    expect(shouldToggleAddModeByTab(tabEvent(rowButton), rowButton.parentElement)).toBe(false)
  })

  it('焦点在编辑器输入框里 ⇒ 不切（否则正文里按 Tab 会去开新增框）', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    expect(shouldToggleAddModeByTab(tabEvent(input), input)).toBe(false)
  })

  it('带修饰键（Ctrl / Meta / Alt / Shift）⇒ 不切（Shift+Tab 是反向移焦）', () => {
    const { layer } = pane()
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true }
    ]) {
      expect(shouldToggleAddModeByTab(tabEvent(layer, init), layer)).toBe(false)
    }
  })

  it('别的键 / 没有锚点 ⇒ 不切', () => {
    const { layer } = pane()
    const enter = new KeyboardEvent('keydown', { key: 'Enter' })
    Object.defineProperty(enter, 'target', { value: layer })
    expect(shouldToggleAddModeByTab(enter, layer)).toBe(false)
    expect(shouldToggleAddModeByTab(tabEvent(layer), null)).toBe(false)
  })
})
