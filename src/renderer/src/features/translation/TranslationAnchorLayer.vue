<script lang="ts">
/**
 * 这两个导出放在**独立的 `<script>` 块**里 —— `<script setup>` 不允许 ES 模块导出
 * （我第一版写进 setup 块，`@vue/compiler-sfc` 直接报
 * `<script setup> cannot contain ES module exports`，两个 spec 文件当场编译失败）。
 * 导出是给用例用的：它要按**同一个时长**断言回执会自己消失。
 */

export interface AnchorPosition {
  x: number
  y: number
}
</script>

<script setup lang="ts">
/**
 * 译文锚点层（P1 译文对照 → P2-c 可拖动，2026-10-06）
 *
 * 把 LabelPlus 文本里的每条译文，按**归一化坐标**画成原图上的编号徽章：
 * 第 1 组红、第 2 组蓝（照 LabelPlusFX 的"框内红 / 框外蓝"），组数超过 4 个循环。
 *
 * ## 三个刻意的决定
 *
 * 1. **徽章不随图缩放**：徽章是"读数"不是"内容"，图片放大时它不该跟着变成大圆饼。
 *    位置靠 `anchorOffsetFromCenter()` 算（与 ImageViewer 的 transform 同源），
 *    尺寸恒定 24px。
 * 2. **浮层走原生 Popover 顶层**（与 `InfoHint` 同一套做法）：普通绝对定位的浮层
 *    会被左右栏的 `overflow` 祖先裁掉 —— `AppSelect` 当初就是因为这个被整个重写。
 * 3. **悬停有 120ms 延迟才弹**：鼠标扫过一排徽章时不该"噼里啪啦"闪一串浮层；
 *    移出后留 140ms 再收，鼠标来得及移进浮层继续看。
 *
 * ## 与拖拽平移的关系（P2-c 之后）
 *
 * 外层图层是 `pointer-events:none`，所以图上拖拽照常；只有徽章自己
 * `pointer-events:auto`。**徽章上按下时 `stopPropagation`**，否则 `ImageViewer`
 * 会**同时**开始平移图 —— 一个手势不能同时喂给两个东西。
 *
 * ## 拖动这套手势的四条规矩（P2-c，用户拍板）
 *
 * · **阈值区分点击与拖动**（{@link ANCHOR_DRAG_THRESHOLD_PX}）：没越过阈值就仍是
 *   "点一下 = 选中"，P1 那个双向高亮不能丢；
 * · **拖动中不弹浮层、不显数字**：徽章跟手本身就是最好的反馈（P1.1 刚抱怨过遮挡）；
 * · **松手才记改动**（emit `move` → 草稿；**还没写盘**）；
 * · **松手就落盘**（emit `move` → 草稿 → 立刻写盘）；界面**不再弹坐标回执**（用户不要）。
 *
 * ⚠️ 拖动期间的位置存在**本组件内部**（`localPositions`）：草稿要等 `move` 发上去再回来，
 * 中间若直接读文档坐标，徽章会先弹回原处再跳过去。松手后清掉本地值，让草稿接管。
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import type { LabelPlusLabel } from '@shared/labelplus-import'
import {
  anchorOffsetFromCenter,
  draggedPosition,
  isDragGesture,
  normalizedDragDelta,
  type AnchorOffset
} from './anchor-geometry'
import { lpGroupVarFor } from './group-colors'

const props = withDefaults(
  defineProps<{
    labels: LabelPlusLabel[]
    /** 文本里声明的分组表（决定色槽）。 */
    groups: string[]
    naturalWidth: number
    naturalHeight: number
    scale: number
    offsetX: number
    offsetY: number
    /** 当前选中（或列表那一侧正悬停）的编号 —— 两侧共用一个编号。 */
    activeIndex?: number | null
    /**
     * 拖过之后的**有效坐标**（来自草稿）：有值就用它画，没有才用文本里的原坐标。
     * 少了这一层，拖完的徽章会在"草稿回来之前"弹回原处。
     */
    positionOverrides?: Record<number, AnchorPosition>
  }>(),
  { activeIndex: null, positionOverrides: () => ({}) }
)

const emit = defineEmits<{
  (e: 'pick', index: number): void
  (e: 'edit', index: number, anchor: HTMLElement): void
  (e: 'hover', index: number | null): void
  /** 拖完了：把新的归一化坐标交上去（宿主落进草稿，**还没写盘**）。 */
  (e: 'move', index: number, x: number, y: number): void
  /**
   * 第 5 批 5e：**右键点这个锚点 ⇒ 删掉它对应的那条译文**（用户拍板：不弹菜单、直接删）。
   *
   * ⚠️ 与"右栏行菜单第三项"是**两条入口、同一个动作**：这里只报"要删第几条"，
   * 写盘 / 挪记录 / 草稿键重映射都由宿主那一处做（本组件不认识 txt，也不认识"能不能删"）。
   * 不加二次确认（用户拍板），兜底是宿主侧的 Ctrl+Z 会话栈。
   */
  (e: 'delete', index: number): void
}>()

/** 拖动期间本地跟手用的坐标（松手后清掉，交给草稿）。 */
const localPositions = ref<Record<number, AnchorPosition>>({})

function positionOf(label: LabelPlusLabel): AnchorPosition {
  return localPositions.value[label.index] ?? props.positionOverrides[label.index] ?? label.position
}

interface PlacedAnchor {
  label: LabelPlusLabel
  offset: AnchorOffset
}

/** 只画位置算得出来的那些（图片尺寸还没读出来时一个都不画）。 */
const anchors = computed<PlacedAnchor[]>(() =>
  props.labels
    .map((label) => {
      const position = positionOf(label)
      return {
        label,
        offset: anchorOffsetFromCenter(position.x, position.y, {
          naturalWidth: props.naturalWidth,
          naturalHeight: props.naturalHeight,
          scale: props.scale,
          offsetX: props.offsetX,
          offsetY: props.offsetY
        })
      }
    })
    .filter((item): item is PlacedAnchor => item.offset !== null)
)

/** 正在拖的那一条（拖动中不做浮层、不放大，只跟手）。 */
const draggingIndex = ref<number | null>(null)

/** 交互态：悬停 / 选中 / 键盘聚焦 —— 底色变半透明，好看清底下压着的画。 */
function isVeiled(index: number): boolean {
  return props.activeIndex === index || openIndex.value === index
}

/**
 * 徽章的位置与字色。
 *
 * ⚠️ **底色不在这里**（它落在内层那一片 `<span>` 上）：用户要的是"只让底色透"，
 * 而整枚 `opacity` 会连编号一起透。交互态还给编号加一圈细描边 —— 70% 底色下
 * 白字只有 2.9~3.2:1（实测数字见 `tokens.css`），描边是兜底，不是装饰。
 */
function badgeStyle(anchor: PlacedAnchor): Record<string, string | undefined> {
  return {
    left: `calc(50% + ${anchor.offset.x}px)`,
    top: `calc(50% + ${anchor.offset.y}px)`,
    width: 'calc(32px * var(--translation-anchor-scale, 1))',
    height: 'calc(32px * var(--translation-anchor-scale, 1))',
    fontSize: 'calc(11px * var(--translation-anchor-scale, 1))',
    color: 'var(--lp-group-fg)',
    textShadow: isVeiled(anchor.label.index)
      ? '0 0 2px var(--lp-badge-ink), 0 0 3px var(--lp-badge-ink)'
      : undefined
  }
}

// ── 悬停浮层（照 InfoHint 那套：延迟、原生 Popover 顶层、贴边夹取）─────────────
const SHOW_DELAY_MS = 120
const HIDE_DELAY_MS = 140
const panel = ref<HTMLElement | null>(null)
const tooltipText = ref('')
const openIndex = ref<number | null>(null)
// 与 useProjectCompareViewer 同一写法：渲染层里 window.setTimeout 就是"一个数字句柄"
let showTimer: number | undefined
let hideTimer: number | undefined

function clearShowTimer(): void {
  if (showTimer !== undefined) {
    window.clearTimeout(showTimer)
    showTimer = undefined
  }
}

function clearHideTimer(): void {
  if (hideTimer !== undefined) {
    window.clearTimeout(hideTimer)
    hideTimer = undefined
  }
}

function labelText(label: LabelPlusLabel): string {
  const text = String(label.text ?? '').trim()
  return text || '（未填写）'
}

/** 摆在徽章正下方；下方不够就翻到上方；左右夹在视口内。 */
function placePanel(target: HTMLElement): void {
  const el = panel.value
  if (!el) return
  const box = target.getBoundingClientRect()
  const width = el.offsetWidth
  const height = el.offsetHeight
  const left = Math.min(
    Math.max(12, box.left + box.width / 2 - width / 2),
    Math.max(12, window.innerWidth - width - 12)
  )
  const below = box.bottom + 8
  const top = below + height > window.innerHeight - 12 ? Math.max(12, box.top - height - 8) : below
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

function showNow(label: LabelPlusLabel, target: HTMLElement): void {
  const el = panel.value
  if (!el) return
  tooltipText.value = labelText(label)
  openIndex.value = label.index
  el.showPopover?.()
  void nextTick(() => placePanel(target))
}

function onEnter(label: LabelPlusLabel, event: Event): void {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  clearHideTimer()
  emit('hover', label.index)
  // 拖动中不弹浮层（那是自己刚拖出来的，别盖住徽章）
  if (draggingIndex.value !== null) return
  if (openIndex.value === label.index) return
  clearShowTimer()
  showTimer = window.setTimeout(() => {
    showTimer = undefined
    showNow(label, target)
  }, SHOW_DELAY_MS)
}

function onLeave(): void {
  emit('hover', null)
  clearShowTimer()
  clearHideTimer()
  hideTimer = window.setTimeout(() => {
    hideTimer = undefined
    closeNow()
  }, HIDE_DELAY_MS)
}

function closeNow(): void {
  clearShowTimer()
  clearHideTimer()
  openIndex.value = null
  // 连文字一起清掉：只 hidePopover() 的话内容还留在 DOM 里（屏幕阅读器仍会读到上一句），
  // 而且下次 showNow() 万一先 show 后赋值就会闪一行旧译文。
  tooltipText.value = ''
  panel.value?.hidePopover?.()
}

function onPick(label: LabelPlusLabel): void {
  // 刚拖完那一下也会派发 click —— 那不是在"点选"，别顺手改选中态
  if (justDragged) {
    justDragged = false
    return
  }
  emit('pick', label.index)
}

// ── 拖动（P2-c）──────────────────────────────────────────────────────────────
/** 松手后第一次 click 要吞掉（浏览器在 pointerup 之后还会补一个 click）。 */
let justDragged = false

interface DragSession {
  index: number
  label: LabelPlusLabel
  pointerX: number
  pointerY: number
  start: AnchorPosition
  moved: boolean
}

let session: DragSession | null = null

function onPointerDown(label: LabelPlusLabel, event: PointerEvent): void {
  // ⚠️ **必须停住**：不停的话 `ImageViewer` 会同时开始平移图（一个手势喂两个东西）
  event.stopPropagation()
  if (event.button !== 0) return
  const target = event.currentTarget as HTMLElement | null
  target?.setPointerCapture?.(event.pointerId)
  session = {
    index: label.index,
    label,
    pointerX: event.clientX,
    pointerY: event.clientY,
    start: { ...positionOf(label) },
    moved: false
  }
}

function onPointerMove(event: PointerEvent): void {
  const active = session
  if (!active) return
  const dx = event.clientX - active.pointerX
  const dy = event.clientY - active.pointerY
  if (!active.moved) {
    if (!isDragGesture(dx, dy)) return
    active.moved = true
    draggingIndex.value = active.index
    // 拖动中不给浮层（P1.1 的教训：浮层会盖住徽章与画）
    closeNow()
    emit('hover', null)
  }
  const delta = normalizedDragDelta(dx, dy, {
    naturalWidth: props.naturalWidth,
    naturalHeight: props.naturalHeight,
    scale: props.scale
  })
  if (!delta) return
  localPositions.value = {
    ...localPositions.value,
    [active.index]: draggedPosition(active.start, delta)
  }
}

function onPointerUp(event: PointerEvent): void {
  const active = session
  session = null
  if (!active) return
  if (!active.moved) return // 没越过阈值 ⇒ 仍是一次点击，交给 @click
  ;(event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId)
  draggingIndex.value = null
  justDragged = true

  const placed = localPositions.value[active.index]
  if (!placed) return
  emit('move', active.index, placed.x, placed.y)
}

function onPointerCancel(): void {
  const active = session
  session = null
  if (!active) return
  draggingIndex.value = null
  // 取消 = 这次拖动不算数，把本地跟手的位置丢掉（徽章回到草稿/原文的位置）
  if (active.moved) {
    const next = { ...localPositions.value }
    delete next[active.index]
    localPositions.value = next
  }
}

/**
 * 第 5 批：徽章上的右键 —— **先只挡住**（Electron 里不 `preventDefault` 会弹浏览器原生菜单）。
 *
 * ⚠️ **第 5 批 5e 起它不再只是挡板**：右键锚点 = **直接删掉这条译文**（用户拍板，不弹菜单）。
 * `.prevent.stop` 里的 `.stop` 仍然要留着 —— 它同时保证这一下**不会冒泡**成
 * "空白处右键 = 新增框外"（两处都用右键，冒泡上去就会**又删又加**）。
 * `.prevent` 挡掉 Electron 的原生右键菜单。
 */
function onAnchorContextMenu(index: number, event: MouseEvent): void {
  event.preventDefault()
  emit('delete', index)
}

onBeforeUnmount(() => {
  clearShowTimer()
  clearHideTimer()
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0" data-testid="translation-anchors">
    <button
      v-for="anchor in anchors"
      :key="anchor.label.index"
      type="button"
      class="pointer-events-auto absolute flex h-8 w-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-bold tabular-nums transition-transform"
      :class="[
        isVeiled(anchor.label.index) ? 'z-10 scale-125 ring-2 ring-accent' : 'hover:scale-110',
        draggingIndex === anchor.label.index ? 'z-20 cursor-grabbing scale-125' : 'cursor-grab'
      ]"
      :style="badgeStyle(anchor)"
      :title="`${anchor.label.group} · 第 ${anchor.label.index} 条（按住可拖动）`"
      :aria-label="`第 ${anchor.label.index} 条译文（${anchor.label.group}）：${labelText(anchor.label)}`"
      :data-testid="`translation-anchor-${anchor.label.index}`"
      :data-active="activeIndex === anchor.label.index ? 'true' : 'false'"
      :data-veiled="isVeiled(anchor.label.index) ? 'true' : 'false'"
      :data-dragging="draggingIndex === anchor.label.index ? 'true' : 'false'"
      @pointerenter="onEnter(anchor.label, $event)"
      @pointerleave="onLeave()"
      @focus="onEnter(anchor.label, $event)"
      @blur="onLeave()"
      @pointerdown.stop="onPointerDown(anchor.label, $event)"
      @mousedown.stop
      @dblclick.stop="emit('edit', anchor.label.index, $event.currentTarget as HTMLElement)"
      @pointermove="onPointerMove($event)"
      @pointerup="onPointerUp($event)"
      @pointercancel="onPointerCancel()"
      @click.stop="onPick(anchor.label)"
      @contextmenu.prevent.stop="onAnchorContextMenu(anchor.label.index, $event)"
      @keydown.esc.stop="closeNow()"
    >
      <!-- 底色**单独一层**：交互时只有它变半透明，编号字始终不透明 -->
      <span
        class="absolute inset-0 rounded-full"
        :style="{
          background: `var(${lpGroupVarFor(groups, anchor.label.group)})`,
          opacity:
            isVeiled(anchor.label.index) || draggingIndex === anchor.label.index
              ? 'var(--lp-veil-opacity)'
              : undefined
        }"
        aria-hidden="true"
      />
      <span class="relative">{{ anchor.label.index }}</span>
    </button>

    <!-- 悬停浮层 / 拖动回执：整层共用一枚，跟着当前徽章走（20 个徽章不各带一份 DOM）。
         内容出现时**只要挂着就是在悬停或刚拖完**，所以它的底色恒为半透明（0.9）—— 字不透明。 -->
    <span
      ref="panel"
      popover="auto"
      role="note"
      class="m-0 w-max max-w-[min(320px,calc(100vw-24px))] border-0 bg-transparent p-0"
      data-testid="translation-anchor-tip"
      @pointerenter="clearHideTimer()"
      @pointerleave="onLeave()"
      @keydown.esc="closeNow()"
    >
      <span
        class="absolute inset-0 rounded-lg border border-border bg-card-bg shadow-[var(--shadow-2)]"
        :style="{ opacity: 'var(--lp-tip-veil-opacity)' }"
        aria-hidden="true"
      />
      <!--
        `whitespace-pre-wrap`：LabelPlus 的译文里 `\n` 是**断句**（同一个气泡里换行），
        而 HTML 默认把换行折成空格 ⇒ 原来这里和右栏都把两句并成一句显示（第 4 批修）。
      -->
      <span
        class="relative block px-3 py-2 text-left text-sm leading-6 whitespace-pre-wrap break-words text-text-primary"
        >{{ tooltipText }}</span
      >
    </span>
  </div>
</template>
