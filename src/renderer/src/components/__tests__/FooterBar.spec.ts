// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import FooterBar from '../FooterBar.vue'
import type { ChapterProgress } from '@shared/types'

describe('FooterBar', () => {
  it('renders "嵌字进度 <n>/<m>" when pct > 0', () => {
    const progress: ChapterProgress = { done: 3, total: 7, pct: 42.86 }
    const wrapper = mount(FooterBar, { props: { progress } })
    expect(wrapper.text()).toBe('嵌字进度 3/7')
  })

  it('renders "无文件" when pct === null (no files)', () => {
    const progress: ChapterProgress = { done: 0, total: 0, pct: null }
    const wrapper = mount(FooterBar, { props: { progress } })
    expect(wrapper.text()).toBe('无文件')
  })

  it('renders verbatim text with 0 done when pct === 0', () => {
    const progress: ChapterProgress = { done: 0, total: 4, pct: 0 }
    const wrapper = mount(FooterBar, { props: { progress } })
    expect(wrapper.text()).toBe('嵌字进度 0/4')
  })

  it('sets the theme-coloured fill width to pct% when pct > 0', () => {
    const progress: ChapterProgress = { done: 3, total: 7, pct: 42.86 }
    const wrapper = mount(FooterBar, { props: { progress } })
    // 文字位于轨道外，填充使用 Progress 组件的主题主色。
    const fill = wrapper.find('[role="progressbar"]')
    expect(fill.exists()).toBe(true)
    expect(fill.attributes('aria-valuenow')).toBe('42.86')
  })

  it('renders as a parent-contained bar rather than a global fixed footer', () => {
    const progress: ChapterProgress = { done: 1, total: 2, pct: 50 }
    const wrapper = mount(FooterBar, { props: { progress } })
    const rootClasses = wrapper.classes()
    // 意图不变：这条条永远由父容器定位，绝不能变成全屏 fixed 页脚。
    // 定位上下文从根元素挪到了里面的轨道（根元素现在是"标签 + 轨道"的 flex 行）。
    expect(rootClasses).not.toContain('fixed')
    expect(rootClasses).toContain('h-full')
    expect(rootClasses).toContain('w-full')
    expect(wrapper.find('.relative').exists()).toBe(true)
  })

  it('labels the bar with the active work mode', () => {
    const progress: ChapterProgress = { done: 2, total: 5, pct: 40 }
    const wrapper = mount(FooterBar, { props: { progress, mode: 'translated' } })
    expect(wrapper.text()).toBe('翻译进度 2/5')
  })

  it('labels proofread and supervised modes too', () => {
    const progress: ChapterProgress = { done: 1, total: 3, pct: 33.33 }
    expect(mount(FooterBar, { props: { progress, mode: 'proofread' } }).text()).toBe('校对进度 1/3')
    expect(mount(FooterBar, { props: { progress, mode: 'supervised' } }).text()).toBe(
      '监修进度 1/3'
    )
  })

  it('keeps the "无文件" fallback in every mode', () => {
    const progress: ChapterProgress = { done: 0, total: 0, pct: null }
    const wrapper = mount(FooterBar, { props: { progress, mode: 'translated' } })
    expect(wrapper.text()).toBe('无文件')
  })
})
