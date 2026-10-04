// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ProjectThumbList from '../ProjectThumbList.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import type { JpgPsdPair, TypesetStatus, WorkMode } from '@shared/types'

// Stub ThumbGrid to avoid virtual-scroll complexity; render items + emit events.
const ThumbGridStub = {
  name: 'ThumbGrid',
  props: ['items', 'thumbSize', 'load'],
  emits: ['dblclick', 'action', 'mark', 'selectionChange'],
  template: `
    <div class="thumb-grid-stub">
      <div
        v-for="item in items"
        :key="item.id"
        class="stub-card"
        @dblclick="$emit('dblclick', item.id)"
      >
        <span class="stub-filename">{{ item.filename }}</span>
        <span class="stub-thumb">{{ item.thumbUrl }}</span>
        <span class="stub-status">{{ item.status }}</span>
        <button class="stub-action" @click.stop="$emit('action', item.id)">
          去嵌字
        </button>
        <button class="stub-status-toggle" @click.stop="$emit('mark', item.id)">
          状态
        </button>
        <button class="stub-select" @click.stop="$emit('selectionChange', [item.id])">
          选择
        </button>
      </div>
    </div>
  `
}

function makePair(
  id: string,
  opts?: { jpgPath?: string; status?: TypesetStatus; modes?: Partial<Record<WorkMode, boolean>> }
): JpgPsdPair {
  return {
    jpgPath: opts?.jpgPath,
    psd: {
      absPath: `/fake/${id}.psd`,
      mtimeMs: 1700000000000,
      ctimeMs: 1700000000000,
      status: opts?.status ?? 'none',
      ...(opts?.modes
        ? {
            modes: {
              typeset: false,
              translated: false,
              proofread: false,
              supervised: false,
              ...opts.modes
            }
          }
        : {})
    }
  }
}

describe('ProjectThumbList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;(window as unknown as { comicType: unknown }).comicType = {
      readFileDataURL: vi.fn(() => Promise.resolve('data:image/jpeg;base64,test')),
      openPath: vi.fn(() => Promise.resolve({ ok: true }))
    }
  })

  it('mounts with 2 pairs and triggers readFileDataURL for each jpgPath', async () => {
    const pairs = [
      makePair('page_001', { jpgPath: '/fake/page_001.jpg' }),
      makePair('page_002', { jpgPath: '/fake/page_002.jpg' })
    ]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    // ThumbGrid stub receives 2 items
    const thumbGrid = wrapper.findComponent({ name: 'ThumbGrid' })
    expect(thumbGrid.props('items')).toHaveLength(2)

    // readFileDataURL called for both pairs
    expect(window.comicType.readFileDataURL).toHaveBeenCalledTimes(2)
    expect(window.comicType.readFileDataURL).toHaveBeenCalledWith('/fake/page_001.jpg')
    expect(window.comicType.readFileDataURL).toHaveBeenCalledWith('/fake/page_002.jpg')
  })

  it('shows only the PSD file name for Windows absolute paths', async () => {
    const pairs: JpgPsdPair[] = [
      {
        jpgPath: 'C:\\comic\\page_001.png',
        psd: {
          absPath: 'C:\\comic\\page_001.psd',
          mtimeMs: 1700000000000,
          ctimeMs: 1700000000000,
          status: 'pending'
        }
      }
    ]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: 'C:\\comic' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    expect(wrapper.find('.stub-filename').text()).toBe('page_001.psd')
  })

  it('sorts numeric filenames naturally', async () => {
    const pairs = ['10', '2', '1', '11', '3'].map((id) =>
      makePair(id, { jpgPath: `/fake/${id}.jpg`, status: 'pending' })
    )
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    expect(wrapper.findAll('.stub-filename').map((item) => item.text())).toEqual([
      '1.psd',
      '2.psd',
      '3.psd',
      '10.psd',
      '11.psd'
    ])
  })

  it('loads an image-only preview without attempting PSD parsing', async () => {
    const pair: JpgPsdPair = {
      jpgPath: '/fake/1.jpg',
      previewOnly: true,
      countsTowardProgress: true,
      psd: {
        absPath: '/fake/1.jpg',
        mtimeMs: 1,
        ctimeMs: 1,
        status: 'none'
      }
    }
    window.comicType.readFileBuffer = vi.fn()
    const wrapper = mount(ProjectThumbList, {
      props: { pairs: [pair], folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await vi.waitFor(() => expect(wrapper.find('.stub-thumb').text()).toContain('test'))

    expect(window.comicType.readFileDataURL).toHaveBeenCalledWith('/fake/1.jpg')
    expect(window.comicType.readFileBuffer).not.toHaveBeenCalled()
  })

  it('emits compare for previewOnly（只有图片、没有 PSD 的章节）as well', async () => {
    // Regression: the double-click handler used to skip `previewOnly` entries,
    // so a chapter holding only JPGs could never open the preview at all.
    const previewOnlyPair: JpgPsdPair = {
      jpgPath: '/fake/only-images/001.jpg',
      previewOnly: true,
      countsTowardProgress: true,
      psd: {
        absPath: '/fake/only-images/001.jpg',
        mtimeMs: 1700000000000,
        ctimeMs: 1700000000000,
        status: 'none'
      }
    }
    const wrapper = mount(ProjectThumbList, {
      props: { pairs: [previewOnlyPair], folderPath: '/fake/only-images' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    await wrapper.find('.stub-card').trigger('dblclick')

    const events = wrapper.emitted('compare')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([previewOnlyPair])
  })

  it('emits compare with correct pair on ThumbGrid dblclick', async () => {
    const pairs = [
      makePair('page_001', { jpgPath: '/fake/page_001.jpg' }),
      makePair('page_002', { jpgPath: '/fake/page_002.jpg' })
    ]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    const cards = wrapper.findAll('.stub-card')
    await cards[1].trigger('dblclick')

    const events = wrapper.emitted('compare')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([pairs[1]])
  })

  it('calls openPath with correct psd path on action button click', async () => {
    const pairs = [
      makePair('page_001', { jpgPath: '/fake/page_001.jpg', status: 'done' }),
      makePair('page_002', { jpgPath: '/fake/page_002.jpg', status: 'done' })
    ]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    const buttons = wrapper.findAll('.stub-action')
    await buttons[0].trigger('click')
    await nextTick()

    expect(window.comicType.openPath).toHaveBeenCalledTimes(1)
    expect(window.comicType.openPath).toHaveBeenCalledWith('/fake/page_001.psd')
  })

  it('launches the configured tool instead of the PSD in non-typeset modes', async () => {
    const launchTool = vi.fn(() => Promise.resolve({ ok: true }))
    ;(window as unknown as { comicType: Record<string, unknown> }).comicType.launchTool = launchTool
    useSettingsStore().labelPlusFxPath = '/tools/LabelPlusFX.exe'

    const pairs = [makePair('page_001', { jpgPath: '/fake/page_001.jpg', status: 'done' })]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake', mode: 'translated' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    await wrapper.find('.stub-action').trigger('click')
    await nextTick()

    expect(launchTool).toHaveBeenCalledWith('/tools/LabelPlusFX.exe')
    expect(window.comicType.openPath).not.toHaveBeenCalled()
    expect(wrapper.emitted('toast')).toBeFalsy()
  })

  it('warns instead of opening anything when no tool is configured', async () => {
    const launchTool = vi.fn(() => Promise.resolve({ ok: true }))
    ;(window as unknown as { comicType: Record<string, unknown> }).comicType.launchTool = launchTool

    const pairs = [makePair('page_001', { jpgPath: '/fake/page_001.jpg', status: 'done' })]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake', mode: 'translated' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    await wrapper.find('.stub-action').trigger('click')
    await nextTick()

    expect(launchTool).not.toHaveBeenCalled()
    expect(window.comicType.openPath).not.toHaveBeenCalled()
    expect(wrapper.emitted('toast')![0]).toEqual([
      { type: 'warning', message: '尚未配置翻译工具，请先在「设置 → 外部工具」里指定可执行文件路径' }
    ])
  })

  it('reports a failed launch as an error toast', async () => {
    const launchTool = vi.fn(() =>
      Promise.resolve({ ok: false, code: 'E_NOT_FOUND', message: '找不到 /tools/Gone.exe' })
    )
    ;(window as unknown as { comicType: Record<string, unknown> }).comicType.launchTool = launchTool
    useSettingsStore().labelPlusFxPath = '/tools/Gone.exe'

    const pairs = [makePair('page_001', { jpgPath: '/fake/page_001.jpg', status: 'pending' })]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake', mode: 'proofread' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    await wrapper.find('.stub-action').trigger('click')
    await nextTick()

    expect(wrapper.emitted('toast')![0]).toEqual([
      { type: 'error', message: '找不到 /tools/Gone.exe' }
    ])
  })

  it('emits mark with the correct pair from the status toggle', async () => {
    const pairs = [
      makePair('page_001', { jpgPath: '/fake/page_001.png', status: 'pending' }),
      makePair('page_002', { jpgPath: '/fake/page_002.png', status: 'done' })
    ]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    await wrapper.find('.stub-status-toggle').trigger('click')
    expect(wrapper.emitted('mark')![0]).toEqual([pairs[0]])
  })

  /**
   * 左下角状态点（2026-10-02）——它必须表达**当前模式**的完成状态，
   * 而不是那个只表示「嵌字」的老字段 `psd.status`。
   * 起因：监修模式下标记完一页，左下角的点纹丝不动。
   */
  it('状态点按当前模式取数：切模式看的是各自模式，不是嵌字那个老字段', async () => {
    const pairs = [
      // 嵌字已完成、监修未做 —— 两种模式下的期望恰好相反
      makePair('page_001', {
        jpgPath: '/fake/page_001.png',
        status: 'done',
        modes: { typeset: true, supervised: false }
      }),
      // 只有监修完成
      makePair('page_002', {
        jpgPath: '/fake/page_002.png',
        status: 'pending',
        modes: { supervised: true }
      })
    ]

    const typeset = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake', mode: 'typeset' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()
    expect(typeset.findAll('.stub-status').map((node) => node.text())).toEqual(['done', 'pending'])

    const supervised = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake', mode: 'supervised' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()
    expect(supervised.findAll('.stub-status').map((node) => node.text())).toEqual([
      'pending',
      'done'
    ])
  })

  it('记忆里没有 modes 的老数据：回退到老字段 psd.status（不许突然全变空心）', async () => {
    const pairs = [
      makePair('page_001', { jpgPath: '/fake/page_001.png', status: 'done' }),
      makePair('page_002', { jpgPath: '/fake/page_002.png', status: 'pending' })
    ]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake', mode: 'supervised' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    expect(wrapper.findAll('.stub-status').map((node) => node.text())).toEqual(['done', 'pending'])
  })

  it('只有图、没有 PSD 的条目仍是 none（左下角不画点，动作按钮照旧）', async () => {
    const pairs = [
      // 显式摆出"`status === 'none'` 但 `modes` 存在"这个状态：
      // 只测"`modes` 缺席所以回退"会漏掉真正的分支（变异验证当场抓到的漏洞）。
      makePair('page_001', {
        jpgPath: '/fake/page_001.png',
        status: 'none',
        modes: { supervised: false }
      }),
      makePair('page_002', {
        jpgPath: '/fake/page_002.png',
        status: 'none',
        modes: { supervised: true }
      }),
      makePair('page_003', {
        jpgPath: '/fake/page_003.png',
        status: 'done',
        modes: { supervised: true }
      })
    ]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake', mode: 'supervised' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    expect(wrapper.findAll('.stub-status').map((node) => node.text())).toEqual([
      'none',
      'none',
      'done'
    ])
  })

  it('emits selected pairs when ThumbGrid selection changes', async () => {
    const pairs = [
      makePair('page_001', { jpgPath: '/fake/page_001.png', status: 'pending' }),
      makePair('page_002', { jpgPath: '/fake/page_002.png', status: 'done' })
    ]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    await wrapper.findAll('.stub-select')[1].trigger('click')
    expect(wrapper.emitted('selectionChange')![0]).toEqual([[pairs[1]]])
  })

  it('pair without jpgPath has null thumbUrl and no readFileDataURL call', async () => {
    const pairs = [
      makePair('page_001', { jpgPath: '/fake/page_001.jpg' }),
      makePair('page_002') // no jpgPath
    ]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    const thumbGrid = wrapper.findComponent({ name: 'ThumbGrid' })
    const items = thumbGrid.props('items') as Array<{ thumbUrl: string | null }>
    expect(items[1].thumbUrl).toBeNull()

    // Only 1 call for the pair with jpgPath
    expect(window.comicType.readFileDataURL).toHaveBeenCalledTimes(1)
    expect(window.comicType.readFileDataURL).toHaveBeenCalledWith('/fake/page_001.jpg')
  })

  it('loads thumbnails when pairs arrive after initial empty mount', async () => {
    const wrapper = mount(ProjectThumbList, {
      props: { pairs: [], folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    expect(window.comicType.readFileDataURL).not.toHaveBeenCalled()

    const pairs = [
      makePair('page_001', { jpgPath: '/fake/page_001.jpg' }),
      makePair('page_002', { jpgPath: '/fake/page_002.jpg' })
    ]
    await wrapper.setProps({ pairs })
    await nextTick()

    expect(window.comicType.readFileDataURL).toHaveBeenCalledTimes(2)
    expect(window.comicType.readFileDataURL).toHaveBeenCalledWith('/fake/page_001.jpg')
    expect(window.comicType.readFileDataURL).toHaveBeenCalledWith('/fake/page_002.jpg')
  })

  it('starts at most 4 PSD thumbnail refresh jobs at once', async () => {
    window.comicType.readFileBuffer = vi.fn(() => new Promise<ArrayBuffer>(() => {}))
    const pairs = Array.from({ length: 6 }, (_, index) =>
      makePair(`page_${String(index + 1).padStart(3, '0')}`, {
        jpgPath: `/fake/page_${String(index + 1).padStart(3, '0')}.jpg`
      })
    )

    mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    expect(window.comicType.readFileBuffer).toHaveBeenCalledTimes(4)
    expect(window.comicType.readFileDataURL).not.toHaveBeenCalled()
  })

  it('uses the session PSD cache without reading the PSD again', async () => {
    window.comicType.readPsdThumbnailCache = vi
      .fn()
      .mockResolvedValue('data:image/png;base64,cached')
    window.comicType.readFileBuffer = vi.fn()

    const wrapper = mount(ProjectThumbList, {
      props: {
        pairs: [makePair('page_001', { jpgPath: '/fake/page_001.jpg' })],
        folderPath: '/fake'
      },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await vi.waitFor(() => {
      expect(wrapper.find('.stub-thumb').text()).toContain('cached')
    })

    expect(window.comicType.readPsdThumbnailCache).toHaveBeenCalledWith(
      '/fake/page_001.psd',
      1700000000000
    )
    expect(window.comicType.readFileBuffer).not.toHaveBeenCalled()
  })
})

/**
 * 缩略图条的数据契约（看图三件套 · 需求一）。
 *
 * 网格渲染好的缩略图必须**主动上报**给工作台 —— 预览 / 对照状态底部那条胶片就是靠它，
 * 所以它自己不必再去读一次图（"复用已有缓存、不重新生成"的落点就在这里）。
 */
describe('ProjectThumbList 上报缩略图清单', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;(window as unknown as { comicType: unknown }).comicType = {
      readFileDataURL: vi.fn(() => Promise.resolve('data:image/jpeg;base64,reported')),
      openPath: vi.fn(() => Promise.resolve({ ok: true }))
    }
  })

  it('渲染完缩略图后 emit thumbnails，键是 psd 路径、值是那张已渲染好的图', async () => {
    const pairs = [
      makePair('page_001', { jpgPath: '/fake/page_001.jpg' }),
      makePair('page_002', { jpgPath: '/fake/page_002.jpg' })
    ]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })

    await vi.waitFor(() => {
      const events = wrapper.emitted('thumbnails')
      expect(events).toBeTruthy()
      const latest = events![events!.length - 1][0] as Record<string, string>
      expect(Object.keys(latest).sort()).toEqual(['/fake/page_001.psd', '/fake/page_002.psd'])
      expect(latest['/fake/page_001.psd']).toBe('data:image/jpeg;base64,reported')
    })
  })

  it('一挂载就先发一份空的（工作台据此知道"这一话还没有可用缩略图"，显示页码占位）', async () => {
    const wrapper = mount(ProjectThumbList, {
      props: { pairs: [makePair('page_001', { jpgPath: '/fake/page_001.jpg' })], folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    expect(wrapper.emitted('thumbnails')![0][0]).toEqual({})
  })
})

/**
 * D1：缩略图**降采样**。
 *
 * 以前是"按 PSD 原生尺寸画成 PNG"：实测 1062×1500 的一页约 1.0–1.4 MB，转 base64 再 +33%
 * → 每页 1.3–1.9 MB 常驻内存（一话 38 页 = 50–70 MB），而卡片图片区只有 162×208。
 * 这条用例让"画到画布上的尺寸"自己说话：toDataURL 返回 `<宽>x<高>`，
 * 于是"有没有缩"一眼可查（缩过的应当是 255×360）。
 */
const { mockParsePsdThumb, mockDestroyThumbPool } = vi.hoisted(() => ({
  mockParsePsdThumb: vi.fn(),
  mockDestroyThumbPool: vi.fn()
}))

vi.mock('@renderer/workers/psd-pool', () => ({
  PsdWorkerPool: vi.fn(function (this: unknown) {
    return { parsePsd: mockParsePsdThumb, destroy: mockDestroyThumbPool }
  })
}))

describe('ProjectThumbList 缩略图降采样（D1）', () => {
  it('原生 1062×1500 → 导出与缓存都按 255×360（最长边 360）', async () => {
    setActivePinia(createPinia())
    mockParsePsdThumb.mockReset()
    mockParsePsdThumb.mockResolvedValue({
      width: 1062,
      height: 1500,
      close: vi.fn()
    } as unknown as ImageBitmap)

    // 画布假货：toDataURL 用尺寸自报家门（这样"有没有缩"能被断言抓住）。
    // getImageData 故意只给 4 个字节：越界读到 undefined ≠ 0，于是"非全透明"检查照常通过。
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () =>
        ({
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([10, 10, 10, 255]) }))
        }) as unknown as CanvasRenderingContext2D
    ) as never
    HTMLCanvasElement.prototype.toDataURL = vi.fn(function (this: HTMLCanvasElement) {
      return `data:image/png;base64,${this.width}x${this.height}`
    }) as never

    const writeCache = vi.fn(() => Promise.resolve())
    ;(window as unknown as { comicType: unknown }).comicType = {
      readFileDataURL: vi.fn(() => Promise.resolve('data:image/jpeg;base64,photo')),
      readFileBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
      readPsdThumbnailCache: vi.fn(() => Promise.resolve(null)),
      writePsdThumbnailCache: writeCache,
      openPath: vi.fn(() => Promise.resolve({ ok: true }))
    } as unknown as typeof window.comicType

    const wrapper = mount(ProjectThumbList, {
      props: {
        pairs: [makePair('page_001', { jpgPath: '/fake/page_001.jpg' })],
        folderPath: '/fake'
      },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })

    await vi.waitFor(() => {
      expect(wrapper.find('.stub-thumb').text()).toContain('255x360')
    })
    // 写进磁盘缓存的也是小图（不然下一次启动读回来的还是大图）
    expect(writeCache).toHaveBeenCalledWith(
      '/fake/page_001.psd',
      1700000000000,
      'data:image/png;base64,255x360'
    )
  })
})
