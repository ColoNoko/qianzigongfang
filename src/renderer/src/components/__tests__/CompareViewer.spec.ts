// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CompareViewer from '../CompareViewer.vue'

const { mockAcquire, mockRelease } = vi.hoisted(() => ({
  mockAcquire: vi.fn(),
  mockRelease: vi.fn()
}))
vi.mock('@renderer/services/previews', () => ({ previewCache: { acquire: mockAcquire } }))
beforeEach(() => {
  mockAcquire.mockReset()
  mockRelease.mockReset()
  mockAcquire.mockImplementation(async (_path: string, raster: boolean) => ({
    url: raster ? 'data:image/jpeg;base64,jpg-test' : 'data:image/png;base64,psd-render',
    width: 200,
    height: 200,
    release: mockRelease
  }))
})
// ---------------------------------------------------------------------------
// Stub ImageViewer — avoids ResizeObserver/img-load complexity in jsdom.
// ---------------------------------------------------------------------------
const ImageViewerStub = {
  name: 'ImageViewer',
  props: ['src', 'pan'],
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
  })

  it('Test 1: visible=true, jpgPath set → left ImageViewer renders with jpg URL', async () => {
    const wrapper = mountViewer()
    await flush()

    expect(mockAcquire).toHaveBeenCalledWith('/fake/page.jpg', true, expect.any(AbortSignal))

    const viewers = wrapper.findAllComponents({ name: 'ImageViewer' })
    expect(viewers.length).toBeGreaterThanOrEqual(1)
    // Left pane ImageViewer has the jpg data URL.
    expect(viewers[0].props('src')).toBe('data:image/jpeg;base64,jpg-test')
  })

  it('Test 2: visible=true, psdPath set → acquires full PSD preview, right pane shows its URL', async () => {
    const wrapper = mountViewer()
    await flush()

    expect(mockAcquire).toHaveBeenCalledWith('/fake/page.psd', false, expect.any(AbortSignal))

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
    expect(mockAcquire).toHaveBeenCalledWith('/fake/page.png', true, expect.any(AbortSignal))
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
    expect(wrapper.find('[data-testid="compare-psd-pane-body"]').exists()).toBe(true)
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

    const button = wrapper.get('[data-testid="compare-mark-toggle"]')
    expect(button.text()).toBe('未监修')
    expect(button.attributes('aria-pressed')).toBe('false')
    await button.trigger('click')
    await wrapper.setProps({ markedDone: true })
    expect(button.text()).toBe('已监修')
    expect(button.attributes('aria-pressed')).toBe('true')
    await button.trigger('click')
    expect(wrapper.emitted('mark')).toEqual([['done'], ['pending']])
  })

  it('嵌字模式下「标记X」按钮的文案跟着换', async () => {
    const wrapper = mountViewer()
    await flush()

    expect(wrapper.get('[data-testid="compare-mark-toggle"]').text()).toBe('未嵌字')
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

    expect(mockAcquire.mock.calls.every((call) => call[1] === true)).toBe(true)
    expect(window.comicType.readFileBuffer).not.toHaveBeenCalled()
    // 原图仍然加载，且整屏只有这一栏
    expect(mockAcquire).toHaveBeenCalledWith('/fake/page.jpg', true, expect.any(AbortSignal))
    expect(wrapper.find('.image-viewer-stub').exists()).toBe(true)
    expect(wrapper.text()).toContain('图片预览')
    expect(wrapper.text()).not.toContain('PSD')
  })

  it('imageOnly=false（默认）仍然是双栏对照，照常解析 PSD', async () => {
    const wrapper = mountViewer()
    await flush()

    expect(mockAcquire).toHaveBeenCalledWith('/fake/page.psd', false, expect.any(AbortSignal))
    expect(wrapper.text()).toContain('对照视图')
    expect(wrapper.find('[data-testid="compare-psd-pane-body"]').exists()).toBe(true)
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

it('releases previews and cancels pending work on page change and unmount', async () => {
  mockComicType()
  const wrapper = mountViewer()
  await flush()
  const signal = mockAcquire.mock.calls[0][2] as AbortSignal
  await wrapper.setProps({ psdPath: '/fake/next.psd' })
  await flush()
  expect(signal.aborted).toBe(true)
  expect(mockRelease).toHaveBeenCalledTimes(2)
  wrapper.unmount()
  expect(mockRelease).toHaveBeenCalledTimes(4)
})

describe('对照平移联动', () => {
  it('翻页与切换模式恢复默认缩放和平移', async () => {
    mockComicType()
    const wrapper = mountViewer()
    await flush()
    for (const props of [{ psdPath: '/fake/next.psd' }, { mode: 'translated' as const }]) {
      await wrapper.get('[data-testid="compare-zoom-in"]').trigger('click')
      wrapper.findAllComponents({ name: 'ImageViewer' })[0].vm.$emit('update:pan', { x: .1, y: .2 })
      await flush()
      await wrapper.setProps(props)
      await flush()
      expect(wrapper.get('[data-testid="compare-zoom-percent"]').text()).toBe('100%')
      expect(wrapper.findAllComponents({ name: 'ImageViewer' })[0].props('pan')).toEqual({ x: 0, y: 0 })
    }
    wrapper.unmount()
  })
  it('任一画布的归一化平移同步到另一栏，复位同时清零', async () => {
    mockComicType()
    const wrapper = mountViewer()
    await flush()
    await wrapper.get('[data-testid="compare-zoom-in"]').trigger('click')
    const viewers = wrapper.findAllComponents({ name: 'ImageViewer' })
    viewers[0].vm.$emit('update:pan', { x: .08, y: -.1 })
    await flush()
    expect(viewers[1].props('pan')).toEqual({ x: .08, y: -.1 })
    viewers[1].vm.$emit('update:pan', { x: -.02, y: .05 })
    await flush()
    expect(viewers[0].props('pan')).toEqual({ x: -.02, y: .05 })
    await wrapper.get('[data-testid="compare-zoom-out"]').trigger('click')
    expect(viewers[0].props('pan')).toEqual({ x: 0, y: 0 })
    wrapper.unmount()
  })
})

it('keeps the editing anchor fixed after the bubble animates', async () => {
  mockComicType()
  const wrapper = mount(CompareViewer, {
    props: {visible:true,jpgPath:'/fake/page.jpg',psdPath:'/fake/page.psd',translation:{loading:false,result:null,entry:{fileName:'page.jpg',labels:[{index:1,group:'框内',text:'译文',position:{unit:'normalized',x:.5,y:.5}}]},groups:['框内'],dirty:false,changedCount:0,saving:false,notice:'',changedIndices:[],positionOverrides:{},groupOverrides:{},mode:'translate',reviews:{},reviewCount:0,canUndoSaved:false,addFrameMode:false}},
    global:{stubs:{ImageViewer:ImageViewerStub,TranslationPane:{name:'TranslationPane',props:['editorAnchor'],template:'<div />'}}}
  })
  await flush()
  const bubble=document.createElement('button')
  let bounds=new DOMRect(100,100,32,32)
  bubble.getBoundingClientRect=()=>bounds
  wrapper.findComponent({name:'CompareImagePane'}).vm.$emit('edit',1,bubble)
  await flush()
  const anchor=wrapper.findComponent({name:'TranslationPane'}).props('editorAnchor')
  expect(anchor.getBoundingClientRect().x).toBe(100)
  bounds=new DOMRect(96,96,40,40)
  expect(anchor.getBoundingClientRect().x).toBe(100)
  expect(anchor.getBoundingClientRect().width).toBe(32)
  wrapper.unmount()
})
