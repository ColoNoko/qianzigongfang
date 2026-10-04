// @vitest-environment jsdom
/**
 * 对照视图页头的截图检查。
 *
 * 为什么单独立一块：2026-09-23 修了一个真机 bug —— 「在对照视图里根本没法规标记当前这张」。
 * 修法是给页头加「标记X / 标记未X」两个按钮，于是页头从 2 个按钮变成 4 个。
 * **两个新按钮不能被挤掉、也不该把原来的「去X / 退出预览」挤变形** —— 这是光看单测看不出来的。
 *
 * 前置与产出口径同 panel-harness：先 `electron-vite build` 出 CSS，再跑
 * `vitest run --config vitest.visual.config.ts`。
 */
import { beforeEach, describe, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import CompareViewer from '@renderer/components/CompareViewer.vue'
import { shoot } from './panel-harness'
import type { WorkMode } from '@shared/types'

// PsdWorkerPool 必须换成假货：jsdom 里没有 Worker。
const { mockParsePsd, mockDestroy } = vi.hoisted(() => ({
  mockParsePsd: vi.fn(),
  mockDestroy: vi.fn()
}))

vi.mock('@renderer/workers/psd-pool', () => ({
  PsdWorkerPool: vi.fn(function (this: unknown) {
    return { parsePsd: mockParsePsd, destroy: mockDestroy }
  })
}))

const ImageViewerStub = {
  name: 'ImageViewer',
  props: ['src'],
  template: '<div class="image-viewer-stub" :data-src="String(src)"></div>'
}

beforeEach(() => {
  mockParsePsd.mockReset()
  mockDestroy.mockReset()
  ;(window as unknown as { comicType: unknown }).comicType = {
    readFileDataURL: vi.fn(() => Promise.resolve('data:image/jpeg;base64,jpg-test')),
    readFileBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8)))
  }
  // jsdom 没有 canvas，组件里的 bitmapToUrl() 需要这两个。
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D
  ) as never
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,psd-render') as never
})

function headerHtml(mode: WorkMode): string {
  const wrapper = mount(CompareViewer, {
    props: {
      jpgPath: '/漫画/第10話/012.jpg',
      psdPath: '/漫画/第10話/012.psd',
      folderPath: '/漫画/第10話',
      visible: true,
      mode
    },
    global: { stubs: { ImageViewer: ImageViewerStub } }
  })
  const html = wrapper.html()
  wrapper.unmount()
  return html
}

describe('visual: 对照视图页头', () => {
  it('每个模式一块，确认标记按钮在、且没把原有按钮挤变形', async () => {
    const panels = (['typeset', 'supervised'] as WorkMode[]).map((mode) => ({
      label: mode === 'typeset' ? '嵌字模式' : '监修模式',
      html: headerHtml(mode),
      width: 1000,
      height: '200px'
    }))

    await shoot({ name: 'compare-viewer-header', panels })
  })
})
