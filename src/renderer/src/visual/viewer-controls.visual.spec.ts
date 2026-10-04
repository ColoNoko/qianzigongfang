// @vitest-environment jsdom
/**
 * 看图三件套（缩略图条 · 播放按钮 · 缩放控件）的截图检查。
 *
 * 为什么必须截图：单测只能证明"控件在、事件对"，证明不了**它们长什么样、有没有被挤变形**。
 * 这一组盯三处：
 *   ① 预览状态（只有 JPG 的那种章节）：右下角控件组 + 底部胶片条同时在场；
 *   ② 对照状态（双栏）：同一组控件压在右下角，且没把「原图 / PSD」两栏挤坏；
 *   ③ 真实工作台页脚：用户红框那一行现在有两个按钮，胶片条展开时盖在画面底部
 *      （**不是**把画面挤上去的那一版）。
 *
 * 前置与产出口径同 panel-harness：先 `electron-vite build` 出 CSS，再跑
 * `vitest run --config vitest.visual.config.ts`。产出在
 * `<工作区>/temp/visual/viewer-controls/{dark,light}.png`。
 */
import { beforeEach, describe, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CompareViewer from '@renderer/components/CompareViewer.vue'
import PreviewThumbStrip, { type StripItem } from '@renderer/components/PreviewThumbStrip.vue'
import { shoot } from './panel-harness'

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

// 路由 mock：真实工作台那一面板要用。
const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { params: { parentTitle: '', childId: '' } }
}))
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ push: vi.fn() })
}))

import Project from '@renderer/views/Project.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import type { JpgPsdPair, ParentProject } from '@shared/types'

/**
 * ImageViewer 换成"纯色块 + 两个字"——照第十一轮引导图例的规矩：
 * 截图里要判断的是**控件与布局**，不是图片本身；真图片还会把 PSD worker 拖进来。
 */
const ImageViewerStub = {
  name: 'ImageViewer',
  props: ['src'],
  template:
    '<div class="flex h-full w-full items-center justify-center bg-media-bg text-sm text-text-tertiary">画面</div>'
}

/** 假缩略图：一张灰底白页的小 SVG（比一块纯灰更容易看出"哪张是哪张"）。 */
function pageThumb(n: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="120">` +
    `<rect width="88" height="120" fill="#d9d9e3"/>` +
    `<rect x="9" y="9" width="70" height="102" fill="#ffffff"/>` +
    `<text x="44" y="68" font-size="22" text-anchor="middle" fill="#9aa0b4">${n}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function stripItems(count = 14): StripItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `/漫画/第10話/${String(index + 1).padStart(3, '0')}.psd`,
    filename: `${String(index + 1).padStart(3, '0')}.psd`,
    pageNumber: index + 1,
    // 一半有图、一半占位：正好把"网格还没轮到那一页"的样子也拍进去。
    thumbUrl: index % 2 === 0 ? pageThumb(index + 1) : null
  }))
}

/**
 * 等 IPC / 解析这些微任务落定，再取 HTML。
 *
 * 不等的话拍到的是**首帧**：左栏"无同名图片"、右栏"PSD解析中…"
 * —— 那样这一组截图就白拍了（要看的正是"有图之后控件长什么样"）。
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  const { nextTick } = await import('vue')
  await nextTick()
  await nextTick()
  await nextTick()
}

/** 取 CompareViewer 的原始 HTML（定位上下文由调用方套，见下面两个 mountXxxPanel）。 */
async function compareHtmlOf(options: { imageOnly: boolean; thumbStripOpen: boolean }): Promise<string> {
  mockParsePsd.mockResolvedValue({
    width: 200,
    height: 200,
    close: vi.fn()
  } as unknown as ImageBitmap)
  const wrapper = mount(CompareViewer, {
    props: {
      jpgPath: '/漫画/第10話/008.jpg',
      psdPath: options.imageOnly ? '/漫画/第10話/008.jpg' : '/漫画/第10話/008.psd',
      folderPath: '/漫画/第10話',
      visible: true,
      imageOnly: options.imageOnly,
      thumbStripOpen: options.thumbStripOpen
    },
    global: { stubs: { ImageViewer: ImageViewerStub } }
  })
  await settle()
  const html = wrapper.html()
  wrapper.unmount()
  return html
}

async function stripHtml(): Promise<string> {
  const wrapper = mount(PreviewThumbStrip, {
    props: { items: stripItems(), activeId: '/漫画/第10話/008.psd' }
  })
  await settle()
  const html = wrapper.html()
  wrapper.unmount()
  return html
}

/**
 * 面板必须自带定位上下文（`relative`）：缩略图条是 `absolute bottom-0`，
 * 少了它就会飘到整张截图页的最底部 —— 上一版就踩过，面板里空空如也。
 */
function panelBox(inner: string, heightClass = 'h-full'): string {
  return `<div class="relative ${heightClass} w-full overflow-hidden">${inner}</div>`
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockParsePsd.mockReset()
  mockDestroy.mockReset()
  ;(window as unknown as { comicType: unknown }).comicType = {
    readFileDataURL: vi.fn(() => Promise.resolve('data:image/jpeg;base64,jpg-test')),
    readFileBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
    storeGet: vi.fn(() => Promise.resolve([])),
    storeSet: vi.fn(() => Promise.resolve(undefined)),
    projectGetTree: vi.fn(() => Promise.resolve([])),
    projectSaveProgress: vi.fn(() => Promise.resolve(undefined)),
    scanChildProject: vi.fn(() =>
      Promise.resolve({ jpgPairs: [], txtFiles: [], errors: [] })
    ),
    listDir: vi.fn(() => Promise.resolve([])),
    stat: vi.fn(() => Promise.resolve(null)),
    openPath: vi.fn(() => Promise.resolve({ ok: true })),
    writeLog: vi.fn(() => Promise.resolve(undefined))
  }
  // jsdom 没有 canvas，组件里的 bitmapToUrl() 需要这两个。
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({ drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })) }) as unknown as CanvasRenderingContext2D
  ) as never
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,psd-render') as never
})

/** 真实工作台的页脚那一面板：打开预览 + 展开胶片条，拍用户红框那条区域。 */
async function mountWorkbenchPanel(): Promise<string> {
  const pairs: JpgPsdPair[] = Array.from({ length: 28 }, (_, index) => ({
    jpgPath: `/漫画/第10話/${String(index + 1).padStart(3, '0')}.jpg`,
    psd: {
      absPath: `/漫画/第10話/${String(index + 1).padStart(3, '0')}.psd`,
      mtimeMs: 1,
      ctimeMs: 1,
      status: 'pending'
    }
  }))
  mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
  const store = useProjectWorkspace()
  const parents: ParentProject[] = [
    {
      id: 'p1',
      title: 'ドラゴンボール',
      lastMtimeMs: 2000,
      children: [
        {
          id: 'c1',
          parentTitle: 'ドラゴンボール',
          folderPath: '/漫画/第10話',
          chapterNumber: '第10話',
          projectTitle: 'vol1',
          lastMtimeMs: 1000
        }
      ]
    }
  ]
  store.parents = parents
  ;(window.comicType as unknown as { scanChildProject: unknown }).scanChildProject = vi.fn(() =>
    Promise.resolve({ jpgPairs: pairs, txtFiles: [], errors: [] })
  )

  const wrapper = mount(Project, {
    global: {
      stubs: {
        'router-link': { template: '<a><slot /></a>', props: ['to'] },
        ProjectSidebar: { name: 'ProjectSidebar', template: '<div class="w-full"></div>' },
        ProjectThumbList: {
          name: 'ProjectThumbList',
          props: ['pairs'],
          emits: ['compare', 'thumbnails'],
          template: '<div class="h-full w-full bg-app-bg"></div>'
        },
        ProjectFooter: {
          name: 'ProjectFooter',
          props: ['progress', 'mode'],
          template: '<div class="flex h-6 w-full items-center text-xs text-text-secondary">翻译进度 4/28</div>'
        },
        ProjectFormModal: { name: 'ProjectFormModal', template: '<div></div>' },
        // 真 ImageViewer 会在 jsdom 里建 ResizeObserver（这里没有）→ 用纯色块替身。
        ImageViewer: ImageViewerStub
      }
    }
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()

  // 打开预览（对着第 8 张）→ 展开胶片条。
  wrapper.findComponent({ name: 'ProjectThumbList' }).vm.$emit('compare', pairs[7])
  await wrapper.vm.$nextTick()
  // 上报一批缩略图，让胶片条里有真图（走的是"网格上报"那条真实路径）。
  const urls: Record<string, string> = {}
  pairs.forEach((pair, index) => {
    if (index % 3 !== 2) urls[pair.psd.absPath] = pageThumb(index + 1)
  })
  wrapper.findComponent({ name: 'ProjectThumbList' }).vm.$emit('thumbnails', urls)
  await wrapper.vm.$nextTick()
  await wrapper.get('[data-testid="viewer-thumb-strip-toggle"]').trigger('click')
  await wrapper.vm.$nextTick()

  const html = wrapper.html()
  wrapper.unmount()
  return html
}

describe('visual: 看图三件套（缩略图条 / 播放 / 缩放）', () => {
  it('预览状态、对照状态、胶片条本体、真实页脚 —— 四块面板', async () => {
    const strip = await stripHtml()
    // 预览状态：真机就是这样 —— 胶片条盖在画面底部，缩放控件往上让位。
    const previewHtml = panelBox(
      (await compareHtmlOf({ imageOnly: true, thumbStripOpen: true })) + strip
    )
    const comparePanelHtml = panelBox(await compareHtmlOf({ imageOnly: false, thumbStripOpen: false }))

    await shoot({
      name: 'viewer-controls',
      panels: [
        { label: '预览状态（右下角缩放控件 + 底部胶片条）', html: previewHtml, width: 980, height: '560px' },
        { label: '对照状态（同一组控件压在右下角）', html: comparePanelHtml, width: 980, height: '560px' },
        { label: '胶片条本体（一半有图、一半页码占位）', html: panelBox(strip, 'h-[72px]'), width: 980, height: '120px' },
        { label: '真实工作台：页脚两个按钮 + 展开的胶片条', html: panelBox(await mountWorkbenchPanel()), width: 1160, height: '560px' }
      ]
    })
  })
})
