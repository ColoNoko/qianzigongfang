// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import LabelPlusPreview from '../LabelPlusPreview.vue'

describe('LabelPlus native preview view', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads pages, scrolls down to the next page and closes on double-click', async () => {
    const getSession = vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      mode: 'source',
      title: '原图预览',
      initialIndex: 0,
      items: [
        { labelImageName: '1.png', sourceFileName: '1.jpg' },
        { labelImageName: '2.png', sourceFileName: '2.jpg' }
      ]
    })
    const getPage = vi.fn().mockImplementation((_sessionId: string, index: number) =>
      Promise.resolve({
        index,
        total: 2,
        labelImageName: `${index + 1}.png`,
        sourceFileName: `${index + 1}.jpg`,
        dataUrl: 'data:image/png;base64,AA==',
        warnings: []
      })
    )
    const closeCurrentWindow = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      getLabelPlusPreviewSession: getSession,
      getLabelPlusPreviewPage: getPage,
      closeCurrentWindow
    } as unknown as typeof window.comicType

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/labelplus-preview/:sessionId',
          component: LabelPlusPreview
        }
      ]
    })
    await router.push('/labelplus-preview/session-1')
    await router.isReady()
    const wrapper = mount(LabelPlusPreview, { global: { plugins: [router] } })
    await flushPromises()

    expect(getPage).toHaveBeenCalledWith('session-1', 0)
    await wrapper.get('[data-testid="labelplus-preview-window"]').trigger('wheel', { deltaY: 120 })
    await flushPromises()
    expect(getPage).toHaveBeenLastCalledWith('session-1', 1)
    await wrapper.get('[data-testid="labelplus-preview-window"]').trigger('dblclick')
    expect(closeCurrentWindow).toHaveBeenCalledTimes(1)
  })
})
