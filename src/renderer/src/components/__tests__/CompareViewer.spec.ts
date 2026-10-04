// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CompareViewer from '../CompareViewer.vue'

// ---------------------------------------------------------------------------
// Mock PsdWorkerPool — hoisted so the mock is in place before component import.
// ---------------------------------------------------------------------------
const { mockParsePsd, mockDestroy } = vi.hoisted(() => ({
  mockParsePsd: vi.fn(),
  mockDestroy: vi.fn()
}))

vi.mock('@renderer/workers/psd-pool', () => ({
  // Regular function (not arrow) so `new PsdWorkerPool()` works —
  // arrow functions lack [[Construct]].
  PsdWorkerPool: vi.fn(function (this: unknown) {
    return {
      parsePsd: mockParsePsd,
      destroy: mockDestroy
    }
  })
}))

// ---------------------------------------------------------------------------
// Stub ImageViewer — avoids ResizeObserver/img-load complexity in jsdom.
// ---------------------------------------------------------------------------
const ImageViewerStub = {
  name: 'ImageViewer',
  props: ['src'],
  template: '<div class="image-viewer-stub" :data-src="String(src)"></div>'
}

// ---------------------------------------------------------------------------
// Mock window.comicType IPC bridge
// ---------------------------------------------------------------------------
function mockComicType(opts?: {
  dataUrl?: string
  buffer?: ArrayBuffer
  scanChildProject?: ReturnType<typeof vi.fn>
}): void {
  const targetWindow = window as unknown as { comicType: unknown }
  targetWindow.comicType = {
    readFileDataURL: vi.fn(() =>
      Promise.resolve(opts?.dataUrl ?? 'data:image/jpeg;base64,jpg-test')
    ),
    readFileBuffer: vi.fn(() => Promise.resolve(opts?.buffer ?? new ArrayBuffer(8))),
    scanChildProject: opts?.scanChildProject
  }
}

// jsdom does not implement canvas — stub getContext + toDataURL so the
// component's bitmapToUrl() works in tests.
function mockCanvas(dataUrl = 'data:image/png;base64,psd-render'): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D
  ) as any
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => dataUrl)
}

const mockBitmap = {
  width: 200,
  height: 200,
  close: vi.fn()
} as unknown as ImageBitmap

// ---------------------------------------------------------------------------
// Helper: mount with standard stubs
// ---------------------------------------------------------------------------
function mountViewer(
  propsOverrides?: Partial<{
    jpgPath: string | undefined
    psdPath: string
    folderPath: string | undefined
    visible: boolean
    imageOnly: boolean
    mode: 'typeset' | 'translated' | 'proofread' | 'supervised'
    playing: boolean
    thumbStripOpen: boolean
    advanceAfterMark: boolean
  }>
) {
  return mount(CompareViewer, {
    props: {
      jpgPath: '/fake/page.jpg',
      psdPath: '/fake/page.psd',
      visible: true,
      ...propsOverrides
    },
    global: { stubs: { ImageViewer: ImageViewerStub } }
  })
}

// Flush all pending microtasks (IPC mocks + parsePsd + bitmapToUrl).
async function flush(): Promise<void> {
  await nextTick()
  await nextTick()
  await nextTick()
}

describe('CompareViewer', () => {
  beforeEach(() => {
    mockComicType()
    mockCanvas()
    mockParsePsd.mockReset()
    mockDestroy.mockReset()
    mockParsePsd.mockResolvedValue(mockBitmap)
  })

  it('Test 1: visible=true, jpgPath set → left ImageViewer renders with jpg URL', async () => {
    const wrapper = mountViewer()
    await flush()

    expect(window.comicType.readFileDataURL).toHaveBeenCalledWith('/fake/page.jpg')

    const viewers = wrapper.findAllComponents({ name: 'ImageViewer' })
    expect(viewers.length).toBeGreaterThanOrEqual(1)
    // Left pane ImageViewer has the jpg data URL.
    expect(viewers[0].props('src')).toBe('data:image/jpeg;base64,jpg-test')
  })

  it('Test 2: visible=true, psdPath set → calls readFileBuffer + parsePsd, right pane shows ImageBitmap', async () => {
    const wrapper = mountViewer()
    await flush()

    expect(window.comicType.readFileBuffer).toHaveBeenCalledWith('/fake/page.psd')
    expect(mockParsePsd).toHaveBeenCalledTimes(1)
    expect(mockParsePsd).toHaveBeenCalledWith(expect.any(ArrayBuffer))

    // Two ImageViewers: left (jpg) + right (psd).
    const viewers = wrapper.findAllComponents({ name: 'ImageViewer' })
    expect(viewers).toHaveLength(2)
    // Right pane received the converted bitmap data URL.
    expect(viewers[1].props('src')).toBe('data:image/png;base64,psd-render')
  })

  it('shows no matching image placeholder when jpgPath is missing and rescan finds nothing', async () => {
    mockComicType({
      scanChildProject: vi.fn().mockResolvedValue({ jpgPairs: [], txtFiles: [], errors: [] })
    })
    const wrapper = mountViewer({ jpgPath: undefined })
    await flush()

    const viewers = wrapper.findAllComponents({ name: 'ImageViewer' })
    expect(viewers).toHaveLength(1)
    expect(viewers[0].props('src')).toBe('data:image/png;base64,psd-render')
    expect(wrapper.text()).toContain('无同名图片')
  })

  it('rescans the project folder to recover a missing same-name image path', async () => {
    mockComicType({
      scanChildProject: vi.fn().mockResolvedValue({
        jpgPairs: [
          {
            psd: { absPath: '/fake/nested/page.psd', mtimeMs: 1, ctimeMs: 1, status: 'pending' }
          }
        ],
        imageFiles: ['/fake/page.png'],
        txtFiles: [],
        errors: []
      })
    })
    const wrapper = mountViewer({ jpgPath: undefined, folderPath: '/fake' })
    await flush()

    expect(window.comicType.scanChildProject).toHaveBeenCalledWith('/fake')
    expect(window.comicType.readFileDataURL).toHaveBeenCalledWith('/fake/page.png')
    const viewers = wrapper.findAllComponents({ name: 'ImageViewer' })
    expect(viewers).toHaveLength(2)
    expect(viewers[0].props('src')).toBe('data:image/jpeg;base64,jpg-test')
    expect(viewers[1].props('src')).toBe('data:image/png;base64,psd-render')
  })

  it('shows the current PSD file name in the header', async () => {
    const wrapper = mountViewer({ psdPath: 'C:\\comic\\page_001.psd' })
    await flush()

    expect(wrapper.text()).toContain('page_001.psd')
  })

  it('shows 原图/PSD labels and click "退出预览" emits close', async () => {
    const wrapper = mountViewer()
    await flush()

    expect(wrapper.text()).toContain('原图')
    expect(wrapper.text()).toContain('PSD')
    const closeBtn = wrapper.findAll('button').find((b) => b.text() === '退出预览')
    expect(closeBtn).toBeTruthy()
    await closeBtn!.trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(wrapper.emitted('close')!.length).toBe(1)
  })

  it('click "去嵌字" → emits openPsd', async () => {
    const wrapper = mountViewer()
    await flush()

    const openBtn = wrapper.findAll('button').find((b) => b.text() === '去嵌字')
    expect(openBtn).toBeTruthy()
    await openBtn!.trigger('click')

    expect(wrapper.emitted('openPsd')).toBeTruthy()
  })

  /**
   * 在对照视图里也能标记 —— 这里有它自己的「标记X」，作用于**当前显示的这张**。
   * 只靠工具栏是不够的：翻页翻到第 5 页时，工具栏标的还是最初双击的那一张。
   */
  it('「标记X」按钮按当前模式取文案，并把 done / pending 发出去', async () => {
    const wrapper = mountViewer({ mode: 'supervised' })
    await flush()

    const doneBtn = wrapper.get('[data-testid="compare-mark-done"]')
    const pendingBtn = wrapper.get('[data-testid="compare-mark-pending"]')
    expect(doneBtn.text()).toBe('标记监修')
    expect(pendingBtn.text()).toBe('标记未监修')

    await doneBtn.trigger('click')
    await pendingBtn.trigger('click')

    expect(wrapper.emitted('mark')).toEqual([['done'], ['pending']])
  })

  it('嵌字模式下「标记X」按钮的文案跟着换', async () => {
    const wrapper = mountViewer()
    await flush()

    expect(wrapper.get('[data-testid="compare-mark-done"]').text()).toBe('标记嵌字')
    expect(wrapper.get('[data-testid="compare-mark-pending"]').text()).toBe('标记未嵌字')
  })

  it('arrow keys and wheel emit previous/next', async () => {
    const wrapper = mountViewer()
    await flush()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await wrapper.find('[data-testid="compare-viewer"]').trigger('wheel', { deltaY: 100 })

    expect(wrapper.emitted('next')).toBeTruthy()
    expect(wrapper.emitted('previous')).toBeTruthy()
  })

  it('Test 4: press ESC → emits close', async () => {
    const wrapper = mountViewer()
    await flush()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(wrapper.emitted('close')!.length).toBe(1)
  })

  it('Test 5: visible=false → component is hidden and no IPC calls made', () => {
    const wrapper = mountViewer({ visible: false })

    // Root element not rendered (v-if).
    expect(wrapper.find('[data-testid="compare-viewer"]').exists()).toBe(false)

    // No IPC calls when hidden.
    expect(window.comicType.readFileDataURL).not.toHaveBeenCalled()
    expect(window.comicType.readFileBuffer).not.toHaveBeenCalled()
  })

  it('imageOnly：只显示原图，绝不解析 PSD（只有图片的章节）', async () => {
    // `previewOnly` entries carry the image path in `psdPath`; parsing it would
    // waste a worker and show “PSD解析失败”. See ProjectThumbList.handleDblclick.
    const wrapper = mountViewer({ imageOnly: true, psdPath: '/fake/only-images/001.jpg' })
    await flush()

    expect(mockParsePsd).not.toHaveBeenCalled()
    expect(window.comicType.readFileBuffer).not.toHaveBeenCalled()
    // 原图仍然加载，且整屏只有这一栏
    expect(window.comicType.readFileDataURL).toHaveBeenCalledWith('/fake/page.jpg')
    expect(wrapper.find('.image-viewer-stub').exists()).toBe(true)
    expect(wrapper.text()).toContain('图片预览')
    expect(wrapper.text()).not.toContain('PSD')
  })

  it('imageOnly=false（默认）仍然是双栏对照，照常解析 PSD', async () => {
    mockParsePsd.mockResolvedValue(mockBitmap)
    const wrapper = mountViewer()
    await flush()

    expect(mockParsePsd).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('对照视图')
    expect(wrapper.text()).toContain('PSD')
  })
})

/**
 * 看图三件套 · 需求三（缩放控件）+ 播放的两个挂钩。
 *
 * 这里盯的是"一个数字"：按钮、输入框、两栏的滚轮改的都是同一个倍数
 * —— 各自为政正是需求里点名要避免的。
 */
describe('CompareViewer 缩放控件与播放挂钩', () => {
  it('预览状态与对照状态都有同一组控件，默认 100%（适应窗口）', async () => {
    const imageOnly = mountViewer({ imageOnly: true, psdPath: '/fake/only/001.jpg' })
    await flush()
    expect(imageOnly.find('[data-testid="compare-zoom-controls"]').exists()).toBe(true)
    expect(imageOnly.get('[data-testid="compare-zoom-percent"]').text()).toBe('100%')

    const compare = mountViewer()
    await flush()
    expect(compare.find('[data-testid="compare-zoom-controls"]').exists()).toBe(true)
    expect(compare.get('[data-testid="compare-zoom-percent"]').text()).toBe('100%')
  })

  it('＋ / － 改的是同一个数字：两栏拿到的倍数完全一致', async () => {
    const wrapper = mountViewer()
    await flush()

    await wrapper.get('[data-testid="compare-zoom-in"]').trigger('click')
    expect(wrapper.get('[data-testid="compare-zoom-percent"]').text()).toBe('125%')

    const viewers = wrapper.findAllComponents({ name: 'ImageViewer' })
    expect(viewers).toHaveLength(2)
    expect(viewers[0].attributes('zoom-ratio')).toBe('1.25')
    expect(viewers[1].attributes('zoom-ratio')).toBe('1.25')

    await wrapper.get('[data-testid="compare-zoom-out"]').trigger('click')
    expect(wrapper.get('[data-testid="compare-zoom-percent"]').text()).toBe('100%')
  })

  it('某一栏的滚轮缩放（update:zoomRatio）也是同一个数字，另一栏跟着走', async () => {
    const wrapper = mountViewer()
    await flush()

    const viewers = wrapper.findAllComponents({ name: 'ImageViewer' })
    viewers[0].vm.$emit('update:zoomRatio', 2.5)
    await flush()

    expect(wrapper.get('[data-testid="compare-zoom-percent"]').text()).toBe('250%')
    const after = wrapper.findAllComponents({ name: 'ImageViewer' })
    expect(after[1].attributes('zoom-ratio')).toBe('2.5')
  })

  it('点数字能直接输入；输入 100 复位；看不懂的输入保持原值', async () => {
    const wrapper = mountViewer()
    await flush()
    await wrapper.get('[data-testid="compare-zoom-in"]').trigger('click')

    await wrapper.get('[data-testid="compare-zoom-percent"]').trigger('click')
    const input = wrapper.get('[data-testid="compare-zoom-input"]')
    expect((input.element as HTMLInputElement).value).toBe('125')

    await input.setValue('250')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.get('[data-testid="compare-zoom-percent"]').text()).toBe('250%')

    await wrapper.get('[data-testid="compare-zoom-percent"]').trigger('click')
    await wrapper.get('[data-testid="compare-zoom-input"]').setValue('abc')
    await wrapper.get('[data-testid="compare-zoom-input"]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.get('[data-testid="compare-zoom-percent"]').text()).toBe('250%')

    await wrapper.get('[data-testid="compare-zoom-percent"]').trigger('click')
    await wrapper.get('[data-testid="compare-zoom-input"]').setValue('100')
    await wrapper.get('[data-testid="compare-zoom-input"]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.get('[data-testid="compare-zoom-percent"]').text()).toBe('100%')
  })

  it('输入超过上限被夹到 2000%（认得出但超范围 → 夹取，不拒绝）', async () => {
    const wrapper = mountViewer()
    await flush()

    await wrapper.get('[data-testid="compare-zoom-percent"]').trigger('click')
    await wrapper.get('[data-testid="compare-zoom-input"]').setValue('9999')
    await wrapper.get('[data-testid="compare-zoom-input"]').trigger('keydown', { key: 'Enter' })

    expect(wrapper.get('[data-testid="compare-zoom-percent"]').text()).toBe('2000%')
  })

  it('「适应窗口」按钮 = 回默认（与双击画面同一件事）', async () => {
    const wrapper = mountViewer()
    await flush()
    await wrapper.get('[data-testid="compare-zoom-in"]').trigger('click')
    await wrapper.get('[data-testid="compare-zoom-in"]').trigger('click')
    expect(wrapper.get('[data-testid="compare-zoom-percent"]').text()).toBe('156%')

    await wrapper.get('[data-testid="compare-zoom-fit"]').trigger('click')
    expect(wrapper.get('[data-testid="compare-zoom-percent"]').text()).toBe('100%')
  })

  it('缩略图条展开时控件组往上让位（不被压住）', async () => {
    const wrapper = mountViewer({ thumbStripOpen: true })
    await flush()

    // 胶片条总高 104 + 12 的间隙 = 116。方块尺寸一变这个数字就得跟着变，
    // 所以它取自 PreviewThumbStrip 导出的常量，而不是两处各写一个魔法数字。
    expect(wrapper.get('[data-testid="compare-zoom-controls"]').attributes('style')).toContain(
      'bottom: 116px'
    )
  })

  it('播放中按 Esc → 只停播放、不关窗；没在播放时仍然关窗', async () => {
    const playing = mountViewer({ playing: true })
    await flush()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(playing.emitted('stopPlayback')).toBeTruthy()
    expect(playing.emitted('close')).toBeFalsy()

    const idle = mountViewer()
    await flush()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(idle.emitted('close')).toBeTruthy()
    expect(idle.emitted('stopPlayback')).toBeFalsy()
  })

  it('两栏都落定之后报一次 ready（页脚的播放节拍用它计时）', async () => {
    const wrapper = mountViewer()
    await flush()

    expect(wrapper.emitted('ready')).toBeTruthy()
    expect(wrapper.emitted('ready')!.length).toBe(1)
  })

  it('只有图片的章节（预览状态）也会报 ready —— 播放同样要能走', async () => {
    const wrapper = mountViewer({ imageOnly: true, psdPath: '/fake/only/001.jpg' })
    await flush()

    expect(wrapper.emitted('ready')).toBeTruthy()
    expect(wrapper.emitted('ready')!.length).toBe(1)
  })

  it('不可见时一个 ready 都不发（没打开就别惊动页脚）', async () => {
    const wrapper = mountViewer({ visible: false })
    await flush()

    expect(wrapper.emitted('ready')).toBeFalsy()
  })
})

/**
 * C3：页头那枚「标记后下一张」开关。
 *
 * 它只是**显示**设置里的当前值，点击把新值交给宿主（`update:advanceAfterMark`）——
 * 真正的翻页由 Project.vue 负责（那样"标完翻页"才和"播放翻页"共用同一套顺序逻辑）。
 */
describe('CompareViewer 标记后下一张', () => {
  it('默认关；点击发出 update:advanceAfterMark=true', async () => {
    const wrapper = mountViewer()
    await flush()

    const toggle = wrapper.get('[data-testid="compare-advance-toggle"]')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.attributes('title')).toContain('关')

    await toggle.trigger('click')
    expect(wrapper.emitted('update:advanceAfterMark')).toEqual([[true]])
  })

  it('开着时显示为激活，再点一下发 false', async () => {
    const wrapper = mountViewer({ advanceAfterMark: true })
    await flush()

    const toggle = wrapper.get('[data-testid="compare-advance-toggle"]')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(toggle.attributes('title')).toContain('开')
    expect(toggle.classes()).toContain('text-accent')

    await toggle.trigger('click')
    expect(wrapper.emitted('update:advanceAfterMark')).toEqual([[false]])
  })
})
