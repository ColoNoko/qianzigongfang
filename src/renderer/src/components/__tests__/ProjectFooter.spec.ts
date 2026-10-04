// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectFooter from '../ProjectFooter.vue'
import type { ChapterProgress } from '@shared/types'

describe('ProjectFooter', () => {
  it('renders "嵌字进度 3/7" when progress has done=3 total=7', () => {
    const progress: ChapterProgress = { done: 3, total: 7, pct: 42.86 }
    const wrapper = mount(ProjectFooter, { props: { progress } })
    expect(wrapper.text()).toBe('嵌字进度 3/7')
  })

  it('renders "无文件" when progress has pct=null (no files)', () => {
    const progress: ChapterProgress = { done: 0, total: 0, pct: null }
    const wrapper = mount(ProjectFooter, { props: { progress } })
    expect(wrapper.text()).toBe('无文件')
  })
})
