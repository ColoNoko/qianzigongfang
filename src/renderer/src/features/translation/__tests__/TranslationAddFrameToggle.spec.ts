// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TranslationAddFrameToggle from '../TranslationAddFrameToggle.vue'

/**
 * 「新增框」页头开关（第 5 批 5d-2，2026-10-07）。
 *
 * 三条不许退的既有保证（都是前面几批真机踩出来的）：
 * ① **默认关** —— 用户拍板；开着的时候左键点图会**写数据**，默认值错一次就是误写。
 * ② **图标化 24px**，不许把 `h-7`(28px) 的页头行撑高（第 4 批刚修完"切模式整行跳 12px"）。
 * ③ 开着的时候**看得出来**（否则用户不知道自己正处在"点一下就写"的状态）。
 */
describe('页头「新增框」开关', () => {
  function mountToggle(addFrameMode = false) {
    return mount(TranslationAddFrameToggle, { props: { addFrameMode } })
  }

  it('默认关：不传 prop 时就是关着的，且 `data-active="false"`', () => {
    const wrapper = mount(TranslationAddFrameToggle)
    expect(
      wrapper.get('[data-testid="translation-add-frame-toggle"]').attributes('data-active')
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="translation-add-frame-toggle"]').attributes('aria-pressed')
    ).toBe('false')
  })

  it('点一下 ⇒ emit `update:addFrameMode` true（从关到开）', async () => {
    const wrapper = mountToggle(false)
    await wrapper.get('[data-testid="translation-add-frame-toggle"]').trigger('click')
    expect(wrapper.emitted('update:addFrameMode')).toEqual([[true]])
  })

  it('开着再点 ⇒ emit false（能关回去，不是单向开关）', async () => {
    const wrapper = mountToggle(true)
    await wrapper.get('[data-testid="translation-add-frame-toggle"]').trigger('click')
    expect(wrapper.emitted('update:addFrameMode')).toEqual([[false]])
  })

  it('工具按钮有图标和无障碍名字', () => {
    const wrapper = mountToggle(false)
    const button = wrapper.get('[data-testid="translation-add-frame-toggle"]')
    // 图标化 ⇒ 里面是 svg，不是文字
    expect(button.find('svg').exists()).toBe(true)
    expect(button.attributes('aria-label')).toBeTruthy()
  })

  it('开着时是有状态的（`data-active` 与 title 都变），关着时也能看出是一个开关', () => {
    const on = mountToggle(true)
    expect(on.get('[data-testid="translation-add-frame-toggle"]').attributes('data-active')).toBe(
      'true'
    )
    const off = mountToggle(false)
    expect(off.get('[data-testid="translation-add-frame-toggle"]').attributes('data-active')).toBe(
      'false'
    )
    expect(off.get('[data-testid="translation-add-frame-toggle"]').attributes('title')).toBeTruthy()
  })
})
