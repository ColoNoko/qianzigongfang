// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ProjectThumbList from '../ProjectThumbList.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import type { JpgPsdPair, TypesetStatus, WorkMode } from '@shared/types'

import { getThumbnailService, resetThumbnailService } from '@renderer/services/thumbnails'
import { afterEach } from 'vitest'
const { loader } = vi.hoisted(() => ({ loader: vi.fn() }))
vi.mock('@renderer/services/thumbnails', async (original) => {
  const actual = await original<typeof import('@renderer/services/thumbnails')>()
  let service: InstanceType<typeof actual.ThumbnailService> | undefined
  return {
    ...actual,
    getThumbnailService: () => (service ??= new actual.ThumbnailService(loader)),
    resetThumbnailService: () => {
      service?.destroy()
      service = undefined
    }
  }
})
afterEach(resetThumbnailService)
// Stub ThumbGrid to avoid virtual-scroll complexity; render items + emit events.
const ThumbGridStub = {
  name: 'ThumbGrid',
  props: ['items', 'thumbSize', 'load'],
  emits: ['dblclick', 'action', 'mark', 'selectionChange', 'visible'],
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
      {
        type: 'warning',
        message: '尚未配置翻译工具，请先在「设置 → 外部工具」里指定可执行文件路径'
      }
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
})

describe('shared viewport thumbnails', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    loader.mockReset().mockResolvedValue('cached-url')
  })
  it('only requests visible/nearby pages and reports shared URLs', async () => {
    const pairs = Array.from({ length: 20 }, (_, i) => makePair(String(i)))
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    expect(loader).not.toHaveBeenCalled()
    wrapper
      .findComponent({ name: 'ThumbGrid' })
      .vm.$emit('visible', [pairs[0].psd.absPath], [pairs[1].psd.absPath])
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(wrapper.find('.stub-thumb').text()).toBe('cached-url'))
    expect(wrapper.emitted('thumbnails')!.at(-1)![0]).toEqual({
      '/fake/0.psd': 'cached-url',
      '/fake/1.psd': 'cached-url'
    })
    wrapper.unmount()
  })
  it('reuses a ready page after remount and reloads changed file revisions', async () => {
    const pair = makePair('one')
    const mountList = () =>
      mount(ProjectThumbList, {
        props: { pairs: [pair], folderPath: '/fake' },
        global: { stubs: { ThumbGrid: ThumbGridStub } }
      })
    const first = mountList()
    first.findComponent({ name: 'ThumbGrid' }).vm.$emit('visible', [pair.psd.absPath], [])
    await vi.waitFor(() => expect(getThumbnailService().state(pair).status).toBe('ready'))
    first.unmount()
    const second = mountList()
    second.findComponent({ name: 'ThumbGrid' }).vm.$emit('visible', [pair.psd.absPath], [])
    await nextTick()
    expect(loader).toHaveBeenCalledTimes(1)
    await second.setProps({ pairs: [{ ...pair, psd: { ...pair.psd, mtimeMs: 2 } }] })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
    second.unmount()
  })
})
