// @vitest-environment jsdom
/**
 * 「译文对照」（P1）与「译文编辑」（P2）的截图检查。
 *
 * 为什么必须截图：单测能证明"锚点在、位置算对了、点得动"，证明不了**它长什么样**：
 * 徽章压在漫画画面上看不看得清、右栏清单挤不挤、空态说没说清、
 * 编辑框与草稿条在真样式下会不会挤成一团。
 *
 * 这一组拍十四块（P1 五块 + P2 四块 + **第 2 批五块**）：
 *   ① 宽窗的译文对照（左：原图 + 编号锚点；右：当前页译文清单）
 *   ② 双击展开编辑器（分组开关）
 *   ③ 清单细节（多分组 + 一条"未填写" + 选中态）
 *   ④ 空态：本页无译文
 *   ⑤ 空态：整话没找到可用的 txt
 *   ⑥ 读不了（后台是旧版本那条人话）
 *   ⑦ **P2 编辑态**：选中那条下方展开编辑器
 *   ⑧ **P2 未保存态**：徽标 + 改动记号 + 草稿条
 *   ⑨ **P2 冲突弹窗**：两条路（代价写在按钮上）
 *   ⑩ **第 2 批 校对档**：上原下校 + 行首铅笔 + 页头「已校：N ▾」
 *   ⑪ **第 2 批 翻译档**：校对过的条目只有铅笔 + 一行当前文本
 *   ⑫ **第 2 批 悬停理由**（平时不显示）
 *   ⑬ **第 2 批 理由编辑器**（点铅笔打开）
 *   ⑭ **第 2 批 导出菜单**
 *
 * 前置与产出口径同 panel-harness：先 `electron-vite build` 出 CSS，再跑
 * `vitest run --config vitest.visual.config.ts`。产出在
 * `<工作区>/temp/visual/translation/{dark,light}.png`。
 */
import { beforeEach, describe, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CompareViewer from '@renderer/components/CompareViewer.vue'
import TranslationConflictDialog from '@renderer/features/translation/TranslationConflictDialog.vue'
import TranslationPane from '@renderer/features/translation/TranslationPane.vue'
import { shoot } from './panel-harness'
import type { TranslationPaneModel } from '@renderer/features/translation/pane-model'

// jsdom 里没有 Worker，PSD 池必须换成假货（本组虽然不解析 PSD，但组件导入链会碰到它）。
const { mockParsePsd, mockDestroy } = vi.hoisted(() => ({
  mockParsePsd: vi.fn(),
  mockDestroy: vi.fn()
}))
vi.mock('@renderer/workers/psd-pool', () => ({
  PsdWorkerPool: vi.fn(function (this: unknown) {
    return { parsePsd: mockParsePsd, destroy: mockDestroy }
  })
}))

/**
 * 这一组要的是**锚点真的画出来**，所以替身必须渲染 overlay 插槽，
 * 并给出固定的图片摆放参数 —— 顺带画一块"漫画画面"，好看清徽章压在画面上的观感。
 */
const MetricsImageViewerStub = {
  name: 'ImageViewer',
  props: ['src'],
  template: `
    <div class="relative flex h-full w-full items-center justify-center overflow-hidden bg-media-bg">
      <div class="absolute left-1/2 top-1/2 h-[500px] w-[350px] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-border bg-white">
        <span class="absolute left-2 top-2 text-[11px] text-text-tertiary">画面</span>
      </div>
      <slot
        name="overlay"
        :natural-width="700"
        :natural-height="1000"
        :scale="0.5"
        :offset-x="0"
        :offset-y="0"
      />
    </div>`
}

function pageLabels(): Array<{
  index: number
  group: string
  text: string
  position: { unit: 'normalized'; x: number; y: number }
}> {
  return [
    {
      index: 1,
      group: '框内',
      text: '难道是我说错话了?',
      position: { unit: 'normalized', x: 0.42, y: 0.18 }
    },
    {
      index: 2,
      group: '框内',
      text: '这下咋办',
      position: { unit: 'normalized', x: 0.58, y: 0.3 }
    },
    {
      index: 3,
      group: '框内',
      text: '现在反悔 还来得及哦',
      position: { unit: 'normalized', x: 0.3, y: 0.56 }
    },
    { index: 4, group: '框外', text: '嘟囔', position: { unit: 'normalized', x: 0.16, y: 0.45 } },
    {
      index: 6,
      group: '框内',
      text: '…你们俩这是 吵架了吗?',
      position: { unit: 'normalized', x: 0.66, y: 0.72 }
    },
    { index: 8, group: '框外', text: '※倔脾气', position: { unit: 'normalized', x: 0.22, y: 0.84 } }
  ]
}

function model(overrides?: Partial<TranslationPaneModel>): TranslationPaneModel {
  return {
    loading: false,
    result: {
      status: 'ok',
      file: {
        path: '/漫画/第10話/译文.txt',
        name: '译文.txt',
        mtimeMs: 1,
        size: 1024,
        sha256: 'a'.repeat(64)
      },
      txtCount: 1,
      message: '',
      document: {
        sourcePath: '/漫画/第10話/译文.txt',
        version: { first: 1, last: 0 },
        groups: ['框内', '框外'],
        images: [],
        warnings: []
      }
    },
    entry: { fileName: '008.jpg', labels: pageLabels() },
    groups: ['框内', '框外'],
    dirty: false,
    changedCount: 0,
    saving: false,
    notice: '',
    changedIndices: [],
    positionOverrides: {},
    groupOverrides: {},
    // 第 2 批：档位 + 校对记录（默认 = 翻译档、一条校对记录都没有）
    mode: 'translate',
    reviews: {},
    reviewCount: 0,
    // 2026-10-07：本会话还有可退的保存（状态条那枚只表示有/无的小标；默认没有）
    canUndoSaved: false,
    // 第 5 批：新增框开关（默认关 = 图上一切照旧）
    addFrameMode: false,
    ...overrides
  }
}

/**
 * 第 2 批那一块要的模型：**校对档** + 两条校对记录。
 *
 * · 第 3 条：**原文与现文故意写得不一样** —— 两行一模一样的话，那张图就证明不了
 *   "上原下校"这件事（图只能用来发现"哪里不对"，前提是它得把差别画出来）；
 *   它还带理由（悬停能浮出理由）。
 * · 第 6 条：**原文为空且没有理由** ⇒ 验"翻译漏了这处"那句照写、以及"没理由就不浮层"。
 */
function reviewModel(): TranslationPaneModel {
  return model({
    mode: 'review',
    reviews: {
      3: { originalText: '现在反悔 也来不及了吧', reason: '语气太软，原文是命令句，改成肯定句' },
      6: { originalText: '', reason: '' }
    },
    reviewCount: 2
  })
}

/**
 * ⚠️ **另一条盲区，第 2 批现场查到**：`<textarea>` 的 `v-model` 值走的是 DOM **property**，
 * 而 `wrapper.html()` 走的是**序列化**（属性 + 子节点）⇒ 文本框里的字**拍不出来**，
 * 浏览器会退回显示 `placeholder`。所以"编辑器带出了原文 / 带出了旧理由"这件事
 * **只能靠用例断言 `(el as HTMLTextAreaElement).value`**（用例里就是这么做的），
 * 截图只用来证明"编辑器长什么样"。
 *
 * ⚠️ **一个已知的截图盲区（2026-10-06 查到，别再踩）**：`AppSelect` 的菜单是
 * **原生 Popover**（`popover="manual"`），而真浏览器里**没调过 `showPopover()` 的 popover
 * 就是 `display: none`**；`wrapper.html()` 只序列化 DOM、**把"它已经打开"这个状态丢了**。
 * ⇒ "打开的下拉菜单"这块面板**拍不出来**（照出来是"面板里没有菜单"）。
 *
 * 试过把它救回来：去掉序列化结果里的 `popover` 能让它显形，但 `position: fixed` 的定位基准
 * 是**视口**、换成 `absolute` 又变成**初始包含块** ⇒ 菜单会跑到别的面板上去。
 * **所以撤掉了那块面板** —— 按仓库的规矩："截图面板必须真的盖住你要保护的东西，
 * 否则那张网只是装饰。" 页码菜单的宽度改由**序列化 HTML 的内联 style 实测**来证
 * （`width: 62px` = 按钮宽；选项的 `class` 也直接断言）。
 */
async function translationPanelHtml(
  paneModel: TranslationPaneModel,
  options?: {
    activeIndex?: number | null
    openEditorFor?: number | null
    openPageMenu?: boolean
    /** 第 2 批：点那枚铅笔 ⇒ 展开理由编辑器。 */
    openReasonEditorFor?: number | null
    /** 第 2 批：点开页头那枚「已校：N ▾」⇒ 动作菜单。 */
    openExportMenu?: boolean
    /**
     * 第 5 批 5d-2：**刚新增**的那一条（瞬时高亮）。
     * 走上面那条真实路径（`CompareViewer` 的 prop）—— 不另做一套挂载。
     */
    justAddedIndex?: number | null
    /** 第 5 批 5d-2：页头那枚「新增框」开关开着没有（给 `translation` 模型用）。 */
    addFrameMode?: boolean
  }
): Promise<string> {
  const wrapper = mount(CompareViewer, {
    props: {
      jpgPath: '/漫画/第10話/008.jpg',
      psdPath: '/漫画/第10話/008.psd',
      folderPath: '/漫画/第10話',
      visible: true,
      mode: 'translated',
      translation: options?.addFrameMode
        ? ({ ...paneModel, addFrameMode: true } as TranslationPaneModel)
        : paneModel,
      justAddedIndex: options?.justAddedIndex ?? null,
      // 2026-10-06：原图那一行右端多了页码
      pageNumber: 8,
      pageCount: 14
    },
    global: { stubs: { ImageViewer: MetricsImageViewerStub } }
  })
  if (options?.activeIndex != null) {
    // 走真实交互：点右栏那一条 ⇒ 两侧一起高亮（顺便把选中态拍进去）
    await wrapper.get(`[data-testid="translation-row-${options.activeIndex}"]`).trigger('click')
  }
  if (options?.openEditorFor != null) {
    // 走真实交互：**双击**那一条 ⇒ 编辑器展开（分组开关就在里面）
    await wrapper
      .get(`[data-testid="translation-row-${options.openEditorFor}"]`)
      .trigger('dblclick')
  }
  if (options?.openReasonEditorFor != null) {
    await wrapper
      .get(`[data-testid="translation-review-icon-${options.openReasonEditorFor}"]`)
      .trigger('click')
  }
  if (options?.openExportMenu) {
    await wrapper.get('[data-testid="translation-review-export"]').trigger('click')
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
  const html = wrapper.html()
  wrapper.unmount()
  return html
}

/** 只拍右栏那一栏（细节看得清）。 */
async function paneOnlyHtml(paneModel: TranslationPaneModel): Promise<string> {
  const full = await translationPanelHtml(paneModel)
  return full
}

/**
 * **只挂译文栏本身**（不套对照视图）：用来拍"窄窗下这一栏挤不挤"。
 *
 * 为什么需要它：对照视图里的分栏默认 66/34，右栏总在 300px 以上，
 * 而真机上右栏可以被拖到**最小 240px**（`SplitPane` 的 `min-secondary-px`）——
 * 页头一行（`译文` + 档位 + `已校：N ▾`）与底部状态条（`另存…` + 撤销/放弃/保存）
 * 挤不挤，只有把这一栏单独摆出来才看得准。
 */
async function paneAloneHtml(
  paneModel: TranslationPaneModel,
  options: {
    activeIndex?: number | null
    openRowMenuFor?: number | null
    /** 把某一条的编辑器也打开（第 5 批加的：要量"菜单贴行、不被编辑器顶下去"）。 */
    openEditorFor?: number | null
    /** 第 5 批 5d-2：**刚新增**的那一条（瞬时高亮）与页头那枚开关。 */
    justAddedIndex?: number | null
    addFrameMode?: boolean
  } = {}
) {
  const activeIndex = options.activeIndex === undefined ? 3 : options.activeIndex
  const wrapper = mount(TranslationPane, {
    props: {
      loading: paneModel.loading,
      result: paneModel.result,
      entry: paneModel.entry,
      groups: paneModel.groups,
      activeIndex,
      dirty: paneModel.dirty,
      changedCount: paneModel.changedCount,
      saving: paneModel.saving,
      notice: paneModel.notice,
      changedIndices: paneModel.changedIndices,
      editingIndex: options.openEditorFor ?? null,
      groupOverrides: paneModel.groupOverrides,
      mode: paneModel.mode,
      reviews: paneModel.reviews,
      reviewCount: paneModel.reviewCount,
      // 第 5 批 5d-2：页头那枚「新增框」开关 + 瞬时高亮（默认都关）
      addFrameMode: options.addFrameMode ?? false,
      justAddedIndex: options.justAddedIndex ?? null
    }
  })
  if (options.openRowMenuFor !== undefined && options.openRowMenuFor !== null) {
    // 走真实交互：右键那一行 ⇒ 弹小菜单（它是普通元素，拍得出来）
    await wrapper
      .get(`[data-testid="translation-row-${options.openRowMenuFor}"]`)
      .trigger('contextmenu')
  }
  await wrapper.vm.$nextTick()
  const html = wrapper.html()
  wrapper.unmount()
  return html
}

function emptyResult(status: 'not-found' | 'error', message: string): TranslationPaneModel {
  return model({
    result: { status, file: null, txtCount: status === 'error' ? 0 : 3, message, document: null },
    entry: null,
    groups: []
  })
}

/**
 * 冲突弹窗那一块（P2-b）。
 *
 * ⚠️ 弹窗是 `fixed inset-0` —— 直接丢进面板会**盖住整页**（连别块面板一起）。
 * 所以外面套一层带 `transform` 的壳：`transform` 会给 `fixed` 后代建立包含块，
 * 它就老实待在面板里了。
 */
async function conflictDialogHtml(): Promise<string> {
  const wrapper = mount(TranslationConflictDialog, {
    props: {
      visible: true,
      message: '这个 txt 在你读进来之后被改过了（可能是 LabelPlusFX 存的），所以没有写入。',
      currentLabel: '盘上那份：7531 字节 · 最后修改 2026/10/6 14:32:10'
    }
  })
  await wrapper.vm.$nextTick()
  const html = wrapper.html()
  wrapper.unmount()
  return html
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockParsePsd.mockReset()
  mockDestroy.mockReset()
  mockParsePsd.mockResolvedValue({
    width: 200,
    height: 200,
    close: vi.fn()
  } as unknown as ImageBitmap)
  ;(window as unknown as { comicType: unknown }).comicType = {
    readFileDataURL: vi.fn(() => Promise.resolve('data:image/jpeg;base64,jpg-test')),
    readFileBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
    storeGet: vi.fn(() => Promise.resolve([])),
    storeSet: vi.fn(() => Promise.resolve(undefined))
  }
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D
  ) as never
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,psd-render') as never
})

describe('visual: 译文对照（P1）', () => {
  it('译文对照十四块面板：完整视图 / 编辑器展开 / 清单细节 / 两种空态 / 读不了 / P2 三态 / 第2批五态', async () => {
    const full = await translationPanelHtml(model(), { activeIndex: 3 })
    // 2026-10-06：双击展开编辑器 —— 分组开关（滑块）就在原来那个下拉的位置
    const editing = await translationPanelHtml(model(), { activeIndex: 3, openEditorFor: 3 })

    await shoot({
      name: 'translation',
      // 视口必须自己给：shoot() 的面板是一行 flex-wrap，不给就会排成一条 5900px 的长图，
      // 缩下来根本看不清（上一批就踩过"给矮了照样报成功、只是图里少一半"）。
      //
      // ⚠️ 第 2 批把这一组拆成**两张图**：14 块挤在一张里时，视口高到 2600 也**装不下**
      // （实测第 9 块就被裁掉了），而"图里少一半"照样报成功 —— 那是最坏的一种绿。
      // 所以：`translation` 装 P1/P2 那九块（5 行 ⇒ 3500 够），
      // 第 2 批那五块单独出 `translation-review`（3 行 ⇒ 2100 够）。
      viewport: { width: 2100, height: 3500 },
      scale: 1,
      panels: [
        {
          label: '译文对照（左：原图 + 编号锚点；右：本页译文清单；第 3 条选中）',
          html: `<div class="relative h-full w-full overflow-hidden">${full}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label: '双击第 3 条 → 编辑器展开：分组开关（滑块）坐在原下拉那一格，且没有「分组」二字',
          html: `<div class="relative h-full w-full overflow-hidden">${editing}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label: '清单细节（两种分组色 + "未填写"照实标出）',
          html: `<div class="relative h-full w-full overflow-hidden bg-app-bg p-4">${await paneOnlyHtml(
            model({
              entry: {
                fileName: '009.jpg',
                labels: [
                  ...pageLabels(),
                  {
                    index: 9,
                    group: '框外',
                    text: '',
                    position: { unit: 'normalized', x: 0.5, y: 0.9 }
                  }
                ]
              }
            })
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label: '空态：本页无译文',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            model({ entry: null })
          )}</div>`,
          width: 1000,
          height: '480px'
        },
        {
          label: '空态：整话没找到可用的 txt',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            emptyResult('not-found', '找到 3 份 txt，但没有一份能当 LabelPlus 文本读')
          )}</div>`,
          width: 1000,
          height: '480px'
        },
        {
          label: '读不了（后台是旧版本那条人话）',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            emptyResult(
              'error',
              '程序后台还是旧版本，请完全关闭程序后再重新启动一次（界面已更新，后台没有）'
            )
          )}</div>`,
          width: 1000,
          height: '480px'
        },
        {
          label: 'P2 编辑态：双击第 3 条 ⇒ 它下方展开编辑器（多行文本框 + 分组开关）',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            model(),
            { activeIndex: 3 }
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label: 'P2 未保存态：徽标 + 改动记号 + 状态条（撤销 / 放弃 / 保存）',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            model({ dirty: true, changedCount: 2, changedIndices: [3, 4] }),
            { activeIndex: 4 }
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label: 'P2 冲突弹窗：两条路，代价写在按钮上（没有自动合并）',
          html: `<div class="relative h-full w-full overflow-hidden" style="transform: translateZ(0)">${await conflictDialogHtml()}</div>`,
          width: 1000,
          height: '620px'
        }
      ]
    })

    // 第三张图：**只挂译文栏本身**看这一栏的长相（窄窗 / 选中态 / 三级按钮 / 断句 / 右键菜单）
    await shoot({
      name: 'translation-pane',
      viewport: { width: 1700, height: 1100 },
      scale: 2,
      panels: [
        {
          label: '窄窗 240px（右栏最小值）：状态条左边来源、右边「另存…」，一行放得下',
          html: `<div class="h-full w-full overflow-hidden">${await paneAloneHtml(model(), { activeIndex: null })}</div>`,
          width: 240,
          height: '260px'
        },
        {
          label:
            '三级按钮语言：主＝实心「保存」（只此一枚）／次＝描边「另存…撤销 放弃」／弱＝无底图标',
          html: `<div class="h-full w-full overflow-hidden">${await paneAloneHtml(
            model({ dirty: true, changedCount: 2, changedIndices: [3] }),
            { activeIndex: 4 }
          )}</div>`,
          width: 300,
          height: '260px'
        },
        {
          label:
            '第4批 · 选中态：持久选中底色 + 左缘 2px 竖条 + 字重（日间也**看得见**，不再用悬停 token）',
          html: `<div class="h-full w-full overflow-hidden">${await paneAloneHtml(model(), {
            activeIndex: 3
          })}</div>`,
          width: 300,
          height: '260px'
        },
        {
          label:
            '第4批 · 校对档：上原下校 + 行尾铅笔（写理由）—— 撤销校对改走右键菜单，✕ 按钮已删（正文因此宽 20px）',
          html: `<div class="h-full w-full overflow-hidden">${await paneAloneHtml(reviewModel(), {
            activeIndex: 3
          })}</div>`,
          width: 320,
          height: '300px'
        },
        {
          label: '第4批 · 断句还原：译文里的换行**真的换行**（编辑器 / 右栏 / 浮窗三处一致）',
          html: `<div class="h-full w-full overflow-hidden">${await paneAloneHtml(
            model({
              entry: {
                fileName: '008.jpg',
                labels: [
                  {
                    index: 1,
                    group: '框内',
                    text: '难道是我说错话了?\n（这行是同一个气泡里的第二句）',
                    position: { unit: 'normalized', x: 0.5, y: 0.2 }
                  },
                  {
                    index: 3,
                    group: '框内',
                    text: '现在反悔\n还来得及哦',
                    position: { unit: 'normalized', x: 0.3, y: 0.56 }
                  },
                  {
                    index: 4,
                    group: '框外',
                    text: '嘟囔',
                    position: { unit: 'normalized', x: 0.16, y: 0.45 }
                  }
                ]
              },
              reviews: {
                3: { originalText: '现在反悔\n已经来不及了', reason: '第二行语气要更硬' }
              },
              reviewCount: 1,
              mode: 'review'
            }),
            { activeIndex: 3 }
          )}</div>`,
          width: 320,
          height: '300px'
        },
        {
          label:
            '第5批 · 右键 + 编辑器**同时开着**：菜单贴着**那一行**出来（不再被编辑器顶到底下、鼠标不用挪远）',
          html: `<div class="h-full w-full overflow-hidden">${await paneAloneHtml(reviewModel(), {
            activeIndex: 3,
            openEditorFor: 3,
            openRowMenuFor: 3
          })}</div>`,
          width: 340,
          height: '380px'
        },
        {
          label:
            '第4批 · 右键这一行 ⇒ 两项：「撤销校对（把原文写回 txt）」／「只删记录」—— 这是撤销校对的**唯一入口**',
          html: `<div class="h-full w-full overflow-hidden">${await paneAloneHtml(reviewModel(), {
            activeIndex: 3,
            openRowMenuFor: 3
          })}</div>`,
          width: 320,
          height: '300px'
        }
      ]
    })

    // 第 2 批那五块：单独一张图（理由浮层与导出菜单都是页面里的普通元素，拍得出来）
    await shoot({
      name: 'translation-review',
      viewport: { width: 2100, height: 2100 },
      scale: 1,
      panels: [
        {
          label:
            '第2批 · 校对档：上原下校（两行 + 一条细分割线，不共用框）＋ 行首铅笔 ＋ 页头「已校：2 ▾」',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            reviewModel(),
            { activeIndex: 3 }
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label: '第2批 · 翻译档：校对过的条目**只显示铅笔 + 当前文本一行**（不展开两行）',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            model({
              reviews: {
                3: { originalText: '现在反悔 还来得及哦', reason: '语气太软，改成肯定句' }
              },
              reviewCount: 1
            }),
            { activeIndex: 3 }
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label:
            '2026-10-07 · **铅笔三态**（左：没理由＝空心线条＋无底／右：有理由＝实心＋淡紫底）。理由的全文出口只剩原生提示与点开的编辑器（悬停浮层已按用户拍板删掉）',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            model({
              mode: 'review',
              // 第 3 条**校对过但没写理由** ⇒ 铅笔该是"空心线条 + 无底"
              reviews: { 3: { originalText: '现在反悔 还来得及哦', reason: '' } },
              reviewCount: 1
            })
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label: '2026-10-07 · **铅笔第三态**：编辑中＝实心 accent 底 + 白字（点开理由编辑器）',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            reviewModel(),
            { openReasonEditorFor: 3 }
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label: '第2批 · 页头「已校：2 ▾」点开 ⇒ 动作菜单「导出校对记录…」',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            reviewModel(),
            { openExportMenu: true }
          )}</div>`,
          width: 1000,
          height: '620px'
        }
      ]
    })

    /**
     * ── 两块**共用区**的基线对照（第 5 批 5e，2026-10-07）──────────────────────
     *
     * ⚠️ 为什么单独一组、并且**改动前先出一版**：上一轮"页头被推歪"就是**只盯着新加的东西、
     * 没看没动过的地方**才溜过去的（截图工装里那一行当时已经偏了，而我读图读成了"正常"）。
     * 这一组只拍**那一行 / 那一条**，改动前后各出一版，同一脚本同一参数 ⇒ 可以直接对着看。
     *
     * 两块共用区：
     * · **右栏条目行 + 右键菜单**（5e 要给菜单加第三项、并把菜单改成"每行都弹"）；
     * · **译文栏状态条**（5e 要往里加一句删除反馈）。
     *
     * 改动**前后**各出过一版（`temp/visual/translation-5e-shared/`），标签里的"改动前/后"
     * 是手工改的 —— 两版图并排看的就是"我没动的那几样有没有被碰歪"。
     */
    await shoot({
      name: 'translation-5e-shared',
      viewport: { width: 900, height: 700 },
      scale: 2,
      panels: [
        {
          label:
            '共用区① 右栏条目行 + 右键菜单（**改动后**：三项，第三项「删除译文」；核对：前两项与位置没被碰歪）',
          html: `<div class="h-full w-full overflow-hidden">${await paneAloneHtml(reviewModel(), {
            activeIndex: 3,
            openRowMenuFor: 3
          })}</div>`,
          width: 360,
          height: '260px'
        },
        {
          label: '共用区② 译文栏状态条（**改动后**：左边来源那行字、右边仍无按钮）',
          html: `<div class="h-full w-full overflow-hidden">${await paneAloneHtml(reviewModel(), {
            activeIndex: null
          })}</div>`,
          width: 360,
          height: '260px'
        }
      ]
    })

    // ── 第 5 批 5d-2「新增框」的四态（2026-10-07）──────────────────────────────
    // ⚠️ 这一组的第 1、3 块**只差页头那枚开关**（一对一对照）：
    //    要看的正是"开关开/关时页头那一行有没有变形、有没有被撑高"。
    await shoot({
      name: 'translation-addframe',
      viewport: { width: 2400, height: 2400 },
      scale: 1,
      panels: [
        {
          label: '第5批 ① 默认态：页头那枚「新增框」开关**关着**（图标按钮，24px 档）',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            reviewModel(),
            { addFrameMode: false }
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label:
            '第5批 ② 开关**开着**：同一条页头行（不许变高 / 不许换行），开关转成 soft accent 激活态',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            reviewModel(),
            { addFrameMode: true }
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label:
            '第5批 ③ **刚新增一条**：淡紫底 + accent 细描边 + 「刚新增」小标（**没有**左缘竖条），底部状态条那句「已新增 … Ctrl+Z 可撤销」',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            reviewModel(),
            { addFrameMode: true, justAddedIndex: 3, activeIndex: null }
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label:
            '第5批 ④ **对照**：上面那块是"固定选中"（左缘 2px accent 竖条 + 选中底色），这块是"瞬时高亮"（淡紫底 + 细描边 + 小标）—— 两种状态刻意长得不一样',
          html: `<div class="relative h-full w-full overflow-hidden">${await translationPanelHtml(
            reviewModel(),
            { addFrameMode: true, activeIndex: 1, justAddedIndex: 3 }
          )}</div>`,
          width: 1000,
          height: '620px'
        },
        {
          label:
            '第5批 ⑤ **窄窗 240px**（右栏最小值，带那枚开关）：页头那一行现在需要 302px、可用 238px ⇒ 量"挤不挤 / 有没有换行"',
          html: await paneAloneHtml(reviewModel(), { addFrameMode: true, justAddedIndex: 3 }),
          width: 240,
          height: '480px'
        }
      ]
    })
  })
})
