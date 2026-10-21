// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
beforeEach(() => setActivePinia(createPinia()))
import { mount } from '@vue/test-utils'
import PreviewThumbStrip, { type StripItem } from '../PreviewThumbStrip.vue'

/**
 * 缩略图条 = 看图软件的"胶片"。
 * 这里锁三件事：**点哪张报哪张**、**当前这张有高亮**、**没有缩略图时不是空白**
 * （最后一条尤其重要：网格还没轮到那一页时，用户至少要看得到页码，否则会以为条坏了）。
 */
function items(): StripItem[] {
  return [
    { id: '/c/001.psd', filename: '001.psd', pageNumber: 1, thumbUrl: 'data:image/png;base64,a' },
    { id: '/c/002.psd', filename: '002.psd', pageNumber: 2, thumbUrl: null },
    { id: '/c/003.psd', filename: '003.psd', pageNumber: 3, thumbUrl: 'data:image/png;base64,c' }
  ]
}

function mountStrip(activeId = '/c/001.psd') {
  return mount(PreviewThumbStrip, { props: { items: items(), activeId } })
}

describe('PreviewThumbStrip', () => {
  it('每张图一个小方块，文件名进 title，页码角标照旧显示', () => {
    const wrapper = mountStrip()
    const boxes = wrapper.findAll('[data-testid="viewer-thumb-track"] button')
    expect(boxes).toHaveLength(3)
    expect(boxes[0].attributes('title')).toBe('001.psd')
    expect(boxes[0].text()).toContain('1')
    expect(boxes[2].text()).toContain('3')
  })

  it('点任意方块 → emit pick，带的是那张图的路径键（与翻页用的键同一个）', async () => {
    const wrapper = mountStrip()
    await wrapper.findAll('[data-testid="viewer-thumb-track"] button')[2].trigger('click')

    expect(wrapper.emitted('pick')).toEqual([['/c/003.psd']])
  })

  it('当前看的这一张有高亮描边（其余没有）', () => {
    const wrapper = mountStrip('/c/002.psd')
    const boxes = wrapper.findAll('[data-testid="viewer-thumb-track"] button')

    expect(boxes.map((box) => box.attributes('data-active'))).toEqual(['false', 'true', 'false'])
    expect(boxes[1].classes()).toContain('border-selected-border')
    expect(boxes[0].classes()).toContain('border-border')
    expect(boxes[1].attributes('aria-current')).toBe('true')
  })

  it('缩略图还没渲染出来时显示页码占位，而不是一个空白方块', () => {
    const wrapper = mountStrip()
    const boxes = wrapper.findAll('[data-testid="viewer-thumb-track"] button')

    expect(boxes[1].find('img').exists()).toBe(false)
    expect(boxes[1].text()).toContain('2')
    expect(boxes[0].find('img').exists()).toBe(true)
  })

  it('右侧收起图标 → emit close', async () => {
    const wrapper = mountStrip()
    await wrapper.get('[data-testid="viewer-thumb-strip-collapse"]').trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('缩略图条**自己不发任何请求**（数据全靠上一级给，这是"不重新生成"的那条契约）', () => {
    const readCache = vi.fn(() => Promise.resolve(null))
    const readDataUrl = vi.fn(() => Promise.resolve('data:image/png;base64,should-not-be-used'))
    ;(window as unknown as { comicType: unknown }).comicType = {
      readPsdThumbnailCache: readCache,
      readFileDataURL: readDataUrl
    }

    const wrapper = mountStrip()

    expect(wrapper.findAll('img').length).toBe(2)
    expect(readCache).not.toHaveBeenCalled()
    expect(readDataUrl).not.toHaveBeenCalled()
  })
})
