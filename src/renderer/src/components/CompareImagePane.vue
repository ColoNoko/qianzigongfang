<script setup lang="ts">
import type { TranslationPaneMode } from '@shared/translation-review'

/**
 * 对照视图的**左栏（原图）**（2026-10-06 抽出）。
 *
 * 抽它的原因只有一个：对照视图现在有三种形态 —— 只有一栏（imageOnly）/ 译文态分栏 /
 * PSD 态分栏 —— 而三种形态共用**同一个**左栏。不抽出来就得把这一整块 markup 抄两遍，
 * 而那正是本仓库反复吃亏的"同一条规则两处各写一份"。
 *
 * ⚠️ 它是**哑组件**：不认识 store、不认识 IPC，尺寸类由调用方给
 * （分栏那支传 `h-full`、flex 那支传 `flex-1`）。
 */
import ImageViewer from './ImageViewer.vue'
import ComparePager from './ComparePager.vue'
import TranslationAnchorLayer from '@renderer/features/translation/TranslationAnchorLayer.vue'
import type { TranslationPaneModel } from '@renderer/features/translation/pane-model'
import {
  decideImageGesture,
  normalizedPointFromCenterOffset,
  type ViewerImageMetrics
} from '@renderer/features/translation/anchor-geometry'
import { shouldToggleAddModeByTab } from '@renderer/utils/keyboard-target'
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 原图的 data URL；还没读出来时是 null。 */
    jpgUrl: string | null
    /** 受控倍数（与右栏共用同一个旋钮）。 */
    zoomRatio: number
    pan?: { x: number; y: number }
    /** 译文模型：给了才有锚点层；不给就是纯原图。 */
    translation?: TranslationPaneModel | null
    /** 要高亮的编号（悬停优先于选中，由父层算好）。 */
    activeIndex?: number | null
    /** 当前是第几张（**1 起**；0 = 还不知道/没对上，此时不显示页码）。 */
    pageNumber?: number
    /** 这一话一共几张。 */
    pageCount?: number
    /** 第 5 批：页头那枚"新增框"开关开着没有（关着一律不新增，平移照旧）。 */
    addMode?: boolean
    /**
     * 要不要由**这一栏**自己画「下一页」（2026-10-07）。
     *
     * · **翻 / 校**态（true）：「下一页」贴本栏右缘 —— 现状，一字不改；
     * · **嵌 / 监**态（false）：本栏**不画**它 —— 那一枚改由 `CompareViewer` 挂在
     *   **PSD 栏最右缘**（用户拍板："PSD 栏右边新增一个显隐区"）。
     *   ⇒ 这样"下一页"永远只有一枚，且两种形态下分别落在各自该在的位置。
     */
    showNextPager?: boolean
  }>(),
  {
    translation: null,
    activeIndex: null,
    pageNumber: 0,
    pageCount: 0,
    addMode: false,
    showNextPager: true
  }
)

const emit = defineEmits<{
  (e: 'update:zoomRatio', ratio: number): void
  (e: 'update:pan', pan: { x: number; y: number }): void
  (e: 'pageWheel', delta: number): void
  (e: 'pick', index: number): void
  (e: 'edit', index: number, anchor: HTMLElement): void
  (e: 'hover', index: number | null): void
  /** 拖完锚点：新的归一化坐标交上去（宿主落进草稿）。 */
  (e: 'translationMoveAnchor', index: number, x: number, y: number): void
  /** 第 5 批：在原图上新增一个条目的请求（分组名 + 归一化坐标）。 */
  (e: 'translationAddFrame', groupName: string, x: number, y: number): void
  /**
   * 第 5 批 5d-2：**Tab 键**要求切「新增框」模式（新值 = 取反后的状态）。
   *
   * 状态在宿主，这一层只报"用户在这一栏里按了 Tab"—— 判据（键位 / 修饰键 /
   * 是否在输入框里 / 焦点是否在栏内）在纯函数 `shouldToggleAddModeByTab` 里。
   */
  (e: 'update:addFrameMode', value: boolean): void
  /** 第 5 批 5e：**锚点右键 ⇒ 删这条译文**（锚点层报上来，原样往上交）。 */
  (e: 'translationDeleteEntry', index: number): void
  /** 从页码下拉选了第几张（1 起）。复用胶片条那条跳转，不另写一套翻页。 */
  (e: 'translationMode', mode: TranslationPaneMode): void
  (e: 'pickPage', pageNumber: number): void
  (e: 'previous'): void
  (e: 'next'): void
}>()

// ── 新增框手势（第 5 批）─────────────────────────────────────────────────────
/**
 * 空白处的点击/右键层（`pointer-events:auto`）。
 *
 * 三条刻意的安排：
 * · 它只在**空白处**收事件 —— 锚点徽章在 DOM 里排在它**后面**（压在上面），
 *   所以徽章上的点击/右键根本不经过这一层；
 * · 它在 `ImageViewer` 容器**内部**，`mousedown` 照常冒泡上去 ⇒ **拖拽平移一点不受影响**
 *   （`ImageViewer` 的平移听的是容器与 window，不是这一层）；
 * · 判定与换算全在纯函数里（`decideImageGesture` / `normalizedPointFromCenterOffset`），
 *   这一层只负责"取像素、喂进去、把结果报上去"。
 */
const captureRef = ref<HTMLElement | null>(null)

/** 左键按下时的起点：`click` 只在按下/抬起同一处才来，位移要拿它算。 */
let addStart: { x: number; y: number } | null = null
let addDragged = false
function onPanStart(): void { addDragged = true }

function focusCanvas(): void { captureRef.value?.focus({ preventScroll: true }) }
function onPaneWheel(event: WheelEvent): void {
  if (event.target instanceof Element && event.target.closest('[data-testid="compare-image-controls"]')) return
  focusCanvas()
}

function onAddMouseDown(event: MouseEvent): void {
  addDragged = false
  captureRef.value?.focus({ preventScroll: true })
  addStart = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
}

function onAddClick(metrics: ViewerImageMetrics, event: MouseEvent): void {
  const start = addStart
  addStart = null
  if (!start || addDragged || event.button !== 0) return
  // ⚠️ 双击的第二下（`detail=2`）不算 —— 那是"双击复位"，别多出一个框（用户拍板 C）
  if (event.detail > 1) return
  const intent = decideImageGesture({
    button: 0,
    dxPx: event.clientX - start.x,
    dyPx: event.clientY - start.y,
    addMode: props.addMode
  })
  if (intent !== 'add-inside') return
  emitAddFrame('框内', metrics, event)
}

function onAddContextMenu(metrics: ViewerImageMetrics, event: MouseEvent): void {
  const intent = decideImageGesture({ button: 2, dxPx: 0, dyPx: 0, addMode: props.addMode })
  // 没开新增模式 ⇒ **不碰**原生右键菜单（关着的时候一切照旧）
  if (intent !== 'add-outside') return
  // Electron 里不 `preventDefault` 会弹浏览器原生菜单 —— 右键"新增框外"必须先挡掉
  event.preventDefault()
  emitAddFrame('框外', metrics, event)
}

/** 新增模式下**屏蔽"双击复位"**（用户拍板 C）：复位还有「适应窗口」按钮这个入口。 */
function onAddDoubleClick(event: MouseEvent): void {
  if (!props.addMode) return
  event.stopPropagation()
}

/**
 * **Tab 入口**（第 5 批 5d-2，用户拍板口径 A：只认"焦点在原图栏内"）。
 *
 * 监听挂在**这一栏的根**上（模板里那行注释写了为什么这就是口径 A 的结构性实现）：
 * Tab 的 keydown 只发给聚焦元素 ⇒ 能冒泡到这里 = 焦点本来就在栏内。
 *
 * ⚠️ **没开新增模式也要走一遍这个函数**（不要在这里加 `if (!props.addMode) return`）：
 * 它就是"把新增模式**打开**"的那个入口 —— 只在开着时才响应的话，第一次根本开不了。
 *
 * ## ⚠️ 2026-10-07 真机更正（这一段是"进入/退出都不对"的根因）
 *
 * 1. **锚点是图片那张可聚焦层**（`tabindex="0"`），**不是这一栏的根**。
 *    第一版判的是"事件目标在这一栏的容器里"，而当时手势层是个**收不到焦点的 div** ——
 *    点图之后 `document.activeElement` 还是 `<body>` ⇒ keydown 落在 body 上，
 *    压根没进这一栏；浏览器按默认 Tab 顺序走，第一个停靠点正是右栏第一排行按钮，
 *    于是"按一下 Tab 焦点跳走、再按一下才切模式"。现在锚点自己可聚焦，点图 ⇒ 焦点就在它上。
 * 2. **`preventDefault` 只发生在真的切了模式那一下**。以前无条件挡 ⇒ 焦点焊死在栏内，
 *    只能拿鼠标去点页头那枚开关才出得来。现在焦点在栏内**别的地方**时判据直接返回 false，
 *    Tab 恢复成正常的移焦 —— 这就是"能退出去"。
 *
 * 判据全在纯函数 `shouldToggleAddModeByTab` 里（键位 / 修饰键 / 是不是在输入框里 / 是不是锚点自身）。
 */
function onPaneKeydown(event: KeyboardEvent): void {
  // 锚点是**图片那张可聚焦层**（`tabindex="0"`），不是这一栏的根 —— 为什么见下面那段注释
  if (!shouldToggleAddModeByTab(event, captureRef.value)) return
  event.preventDefault()
  emit('update:addFrameMode', !props.addMode)
}

/**
 * 把"点下去的位置"报上去（归一化坐标）。**点在图外就不发** ——
 * 夹到边缘等于凭空钉一个框，那是另一种错（写进文件的坐标必须真的在图里）。
 */
function emitAddFrame(groupName: string, metrics: ViewerImageMetrics, event: MouseEvent): void {
  const layer = captureRef.value
  if (!layer) return
  const rect = layer.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  // 相对容器中心 —— 与 ImageViewer 缩放锚点同一套算法（它也以 rect 中心为原点）
  const centerX = event.clientX - rect.left - rect.width / 2
  const centerY = event.clientY - rect.top - rect.height / 2
  const point = normalizedPointFromCenterOffset({ x: centerX, y: centerY }, metrics)
  if (!point) return
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return
  emit('translationAddFrame', groupName, point.x, point.y)
}

/**
 * 切页按钮要不要露出来（2026-10-06 P1.1）。
 *
 * 用户拍板：滚轮改成缩放之后，翻页靠"左右中段那两枚按钮，平时隐藏、鼠标移过去才显示"。
 * 触发区就是**看图区本身**（鼠标在图上一动就该看得见入口）。
 * ⚠️ 隐藏时是 `pointer-events-none` —— 不然一枚看不见的按钮会吃掉图上的拖拽平移。
 */
const pageHintVisible = ref(false)

/**
 * 切页。写成函数而不是 `emit(page.kind)`：`defineEmits` 是重载签名，
 * 传联合类型 TS 收窄不了（vue-tsc 会当场报 TS2769）。
 */
function goPage(kind: 'previous' | 'next'): void {
  if (kind === 'previous') emit('previous')
  else emit('next')
}

/** 两枚切页按钮的全部差异就这三样（免得把整块 markup 抄两遍）。 */
</script>

<template>
  <!--
    ⚠️ `@keydown` 挂在**这一栏的根**上（不是 window）—— 这就是「口径 A：只认焦点在原图栏内」的**结构性实现**：
    keydown 只发给当前聚焦的元素，所以事件能冒泡到这里 ⇒ 焦点本来就在栏内。
    好处是**零全局监听、零误吞**：鼠标停在图上（很常见）时，正常的 Tab 焦点切换一律不受影响。
  -->
  <div class="flex min-h-0 min-w-0 flex-col" data-testid="compare-image-pane" @keydown="onPaneKeydown">
    <div v-if="$slots.toolbar" class="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1" data-testid="compare-image-pane-header">
      <slot name="toolbar" />
    </div>
    <div
      class="relative min-h-0 flex-1"
      data-testid="compare-image-pane-body"
      @wheel.capture="onPaneWheel"
      @pointerenter="pageHintVisible = true"
      @pointerleave="pageHintVisible = false"
    >
      <!--
        **退出保护**（用户拍板）：新增模式开着时，原图区域加一圈 **accent 细描边** ——
        告诉用户"这一栏现在点一下就写"。它是一条**独立**的细描边层（不靠改父级 border）：
        加 `border` 会改变盒模型、把画面顶偏 1px，而 `ring-inset` 画在盒内、不影响布局。
      -->
      <span
        v-if="addMode"
        class="pointer-events-none absolute inset-0 z-10 ring-1 ring-inset ring-accent"
        data-testid="compare-image-pane-add-frame-outline"
        aria-hidden="true"
      />
      <ImageViewer
        v-if="jpgUrl"
        :src="jpgUrl"
        :draw-mode="addMode"
        :pan="pan"
        @update:pan="emit('update:pan', $event)"
        @page-wheel="emit('pageWheel', $event)"
        @pan-start="onPanStart"
        :zoom-ratio="zoomRatio"
        @update:zoom-ratio="emit('update:zoomRatio', $event)"
      >
        <!-- 译文锚点：编号徽章跟着图的缩放/平移走（尺寸不跟着放大） -->
        <template #overlay="metrics">
          <!--
            新增框手势层（第 5 批）：**空白处**的点击 / 右键落在这里。
            ⚠️ 它排在锚点层**前面**（DOM 靠后 = 压在上面）⇒ 徽章上的事件不经过这一层；
            ⚠️ 它在 ImageViewer 容器内部且**不停冒泡** ⇒ 拖拽平移照旧（`ImageViewer` 听的是容器与 window）。
          -->
          <div
            v-if="translation"
            ref="captureRef"
            class="pointer-events-auto absolute inset-0 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
            data-testid="compare-add-frame-layer"
            :data-add-mode="addMode ? 'true' : 'false'"
            tabindex="0"
            :aria-label="
              addMode
                ? '新增框已开启：左键点图 = 框内、右键点图 = 框外；按 Tab 关闭'
                : '原图；按 Tab 开启新增框'
            "
            @mousedown="onAddMouseDown"
            @click="onAddClick(metrics, $event)"
            @contextmenu="onAddContextMenu(metrics, $event)"
            @dblclick="onAddDoubleClick"
          ></div>
          <TranslationAnchorLayer
            v-if="translation && translation.entry"
            :labels="translation.entry.labels"
            :groups="translation.groups"
            :natural-width="metrics.naturalWidth"
            :natural-height="metrics.naturalHeight"
            :scale="metrics.scale"
            :offset-x="metrics.offsetX"
            :offset-y="metrics.offsetY"
            :active-index="activeIndex"
            :position-overrides="translation.positionOverrides"
            @pick="emit('pick', $event)"
            @edit="(index, anchor) => emit('edit', index, anchor)"
            @hover="emit('hover', $event)"
            @move="
              (index: number, x: number, y: number) => emit('translationMoveAnchor', index, x, y)
            "
            @delete="(index: number) => emit('translationDeleteEntry', index)"
          />
        </template>
      </ImageViewer>
      <div v-else class="flex h-full items-center justify-center text-sm text-text-tertiary">
        无同名图片
      </div>

      <!--
        切页按钮（P1.1）：**左右中段、平时隐身**，鼠标移进看图区才淡入。
        滚轮让给缩放之后，这是最主要的翻页入口（键盘 ←/→ 与底部胶片条仍在）。
        ⚠️ 隐身时 `pointer-events-none`：否则看不见的按钮会吃掉图上的拖拽平移。
        键盘 Tab 到它照样会显示（`focus-visible:opacity-100`）。
      -->
      <ComparePager
        kind="previous"
        position-class="left-2"
        :visible="pageHintVisible"
        test-id="compare-page-previous"
        @go="goPage"
      />
      <ComparePager
        v-if="showNextPager"
        kind="next"
        position-class="right-2"
        :visible="pageHintVisible"
        test-id="compare-page-next"
        @go="goPage"
      />
    </div>
  </div>
</template>
