<script setup lang="ts">
/**
 * 新手引导弹窗 —— 一本可复用的"说明书"（2026-10-03 向导化）。
 *
 * 两处调用（`App.vue`）：首次启动自动打开、「指引」按钮再打开。所以它**不认识存储**：
 * 只接收 `open`，把"挑文件"往上抛（`pick-tool`），"有没有看过"与落库都由宿主负责（§13.9）。
 *
 * 向导规矩（用户 2026-10-03 定的）：
 *   ① **首次不给选择**：自动弹的那次直接进 `01`（`startWithEntry=false`）；
 *   ② **重看先挑栏**：点左下角「指引」进来时先给入口页（`startWithEntry=true`）；
 *   ③ **编号写在标题里**（`01 总功能介绍`）—— 顶部不加步骤条，编号由平铺顺序推出来；
 *   ④ 页脚左下 = 圆点 + `N / 9`；右下 = 就到这里/跳过 · 上一步 · 主按钮；
 *   ⑤ 基础栏最后一页的**主按钮是「继续看进阶」**（不是直接结束），旁边给「就到这里」；
 *   ⑥ 第 1 页是**大图固定 + 文案一屏一条左右翻**（`slides`），右边线框跟着当前项换。
 *
 * 文案与页数在 `guide-pages.ts`（组件不手抄），图例在 `GuideArt.vue`，单块文字在 `GuideBlockView.vue`。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import GuideArt from './GuideArt.vue'
import GuideBlockView from './GuideBlockView.vue'
import {
  GUIDE_BASIC_PAGES,
  GUIDE_ENTRY,
  GUIDE_LANES,
  GUIDE_PAGES,
  guideTitleWithNo,
  type GuideLaneId,
  type GuidePage,
  type GuideToolFieldId
} from './guide-pages'

const props = withDefaults(
  defineProps<{
    open?: boolean
    /** 由宿主给：这次打开要不要先停在入口页（首次自动弹 = false，点「指引」= true）。 */
    startWithEntry?: boolean
    /** 三个外部工具路径的当前值（就地填那三个字段要显示它）。组件不读存储，只显示宿主给的。 */
    toolPaths?: Record<GuideToolFieldId, string>
  }>(),
  {
    open: false,
    startWithEntry: false,
    toolPaths: () => ({ labelPlusFx: '', photoshop: '', importScript: '' })
  }
)
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pickTool', field: GuideToolFieldId): void
}>()

/**
 * 当前在哪一栏。**null = 入口页**（挑"基础"还是"进阶"的地方）。
 * 入口页不是一个 `GuidePage`：它不计入页码、没有上一步 / 下一步 —— 用"空栏"表达最直接。
 */
const laneId = ref<GuideLaneId | null>(null)
const lane = computed(() => GUIDE_LANES.find((item) => item.id === laneId.value) ?? null)
const pages = computed<readonly GuidePage[]>(() => lane.value?.pages ?? [])
const step = ref(0)
const total = computed(() => pages.value.length)
const page = computed(() => pages.value[Math.min(step.value, total.value - 1)])
const isLast = computed(() => total.value > 0 && step.value >= total.value - 1)

/** 全局编号（连续 01–09）：基础栏从 1 起，进阶栏接在基础栏后面。 */
const globalNo = computed(
  () => (laneId.value === 'advanced' ? GUIDE_BASIC_PAGES.length : 0) + step.value + 1
)
const totalPages = computed(() => GUIDE_PAGES.length)
/** 头部编号小字「01 / 09」：与页脚 `N / 9` 同源（`globalNo` / `totalPages`），不手抄。 */
const headerNo = computed(
  () =>
    `${String(globalNo.value).padStart(2, '0')} / ${String(totalPages.value).padStart(2, '0')}`
)
/** 标题栏：入口页用自己的标题，进了栏才用"编号 + 页标题"。 */
const headerTitle = computed(() =>
  lane.value && page.value ? guideTitleWithNo(page.value) : GUIDE_ENTRY.title
)
/** 入口页卡片上的编号范围（`基础 01–05`）。由页数推出来，不手抄。 */
const laneRange = computed<Record<GuideLaneId, string>>(() => {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const basics = GUIDE_BASIC_PAGES.length
  return {
    basics: `${pad(1)}–${pad(basics)}`,
    advanced: `${pad(basics + 1)}–${pad(GUIDE_PAGES.length)}`
  }
})

/** 第 1 页那种"大图固定 + 文案左右翻"的排法。 */
const slides = computed(() => page.value?.slides === true)
const headBlocks = computed<readonly GuidePage['blocks'][number][]>(() =>
  page.value ? (slides.value ? page.value.blocks.filter((b) => b.kind === 'lead') : page.value.blocks) : []
)
const slideBlocks = computed(() => (page.value && slides.value ? page.value.blocks.filter((b) => b.kind === 'point') : []))
const slideIndex = ref(0)
const currentSlide = computed(() => slideBlocks.value[slideIndex.value] ?? null)
const slideFirst = computed(() => slideIndex.value === 0)
const slideLast = computed(() => slideIndex.value >= slideBlocks.value.length - 1)

/** 主按钮文案：基础栏最后一页是"继续看进阶"，进阶栏最后一页才是"完成"。 */
const primaryLabel = computed(() => {
  if (!isLast.value) return '下一步'
  return laneId.value === 'basics' ? '继续看进阶' : '完成'
})
/** 「跳过」在基础栏最后一页改叫「就到这里」（同一个动作：关窗并算看过）。 */
const skipLabel = computed(() => (laneId.value === 'basics' && isLast.value ? '就到这里' : '跳过'))

/** 选一栏：从第 1 页开始。 */
function enterLane(id: GuideLaneId): void {
  laneId.value = id
  step.value = 0
  slideIndex.value = 0
  void nextTick(() => nextButton.value?.focus())
}
const nextButton = ref<HTMLButtonElement | null>(null)

function close(): void {
  emit('close')
}

/**
 * 纯翻页：**不关窗**、也**不跨栏**。方向键用它，所以
 * ① 最后一页按 → 不会把弹窗关掉；② 基础栏翻到头不会自己滑进进阶栏。
 */
function goNext(): void {
  if (total.value === 0 || isLast.value) return
  step.value += 1
}

function goPrev(): void {
  if (total.value === 0 || step.value === 0) return
  step.value -= 1
}

/** 主按钮：基础栏最后一页 → 进进阶栏；进阶栏最后一页 → 关闭；其余 → 下一页。 */
function onPrimaryClick(): void {
  if (!isLast.value) {
    goNext()
    return
  }
  if (laneId.value === 'basics') enterLane('advanced')
  else close()
}

function slidePrev(): void {
  if (slideIndex.value > 0) slideIndex.value -= 1
}

function slideNext(): void {
  if (!slideLast.value) slideIndex.value += 1
}

function onPickTool(field: GuideToolFieldId): void {
  emit('pickTool', field)
}

/** 某个外部工具字段当前填了什么（组件不读存储，只显示宿主给的那份）。 */
function fieldPath(field: GuideToolFieldId | undefined): string {
  return field ? (props.toolPaths[field] ?? '') : ''
}

/** 点「浏览…」：把"挑文件"抛给宿主（它才知道该落哪一格库）。 */
function pickField(field: GuideToolFieldId | undefined): void {
  if (field) onPickTool(field)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    close()
    return
  }
  if (event.key === 'ArrowRight') goNext()
  else if (event.key === 'ArrowLeft') goPrev()
}

// 打开时：按宿主给的口径决定落在哪（首次直进 01 / 重看先入口页）+ 挂键盘 + 焦点给主按钮。
// immediate 是需要的：宿主可能一挂载就带着 open=true（首启自动弹）。
watch(
  () => props.open,
  (open) => {
    if (open) {
      laneId.value = props.startWithEntry ? null : 'basics'
      step.value = 0
      slideIndex.value = 0
      window.addEventListener('keydown', onKeydown)
      void nextTick(() => nextButton.value?.focus())
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  },
  { immediate: true }
)

// 换页 / 换栏 → 翻页页回到第一条（否则会停在上次翻到的那条）。
watch([laneId, step], () => {
  slideIndex.value = 0
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    data-testid="guide-overlay"
    @click.self="close"
  >
    <div
      class="flex max-h-[88vh] w-full max-w-[min(1120px,92vw)] flex-col overflow-hidden rounded-[14px] border border-border bg-card-bg text-text-primary shadow-[var(--shadow-3)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      data-testid="guide-card"
    >
      <!-- 标题栏（2026-10-04 视觉精修）：主色渐变底带 = 整个弹窗唯一的主色大面，
           「01 / 09」编号小字与页脚同源；标题加大到 19px —— 治"整页没有视觉焦点"。
           编号仍写在标题里（`01 总功能介绍`），编号小字是它的重复强调，不替代。 -->
      <header
        class="guide-header-gradient flex items-center gap-3 border-b border-border px-7 pb-4 pt-[18px]"
        data-testid="guide-header"
      >
        <div class="min-w-0">
          <p
            class="text-[12px] font-semibold leading-none tracking-[0.08em] text-accent tabular-nums"
            data-testid="guide-header-no"
          >
            {{ headerNo }}
          </p>
          <h2
            id="guide-title"
            class="mt-1.5 text-[19px] font-semibold leading-tight tracking-[-0.015em]"
            data-testid="guide-title"
          >
            {{ headerTitle }}
          </h2>
        </div>
        <button
          type="button"
          class="ml-auto flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-badge text-text-tertiary transition-colors hover:bg-card-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="关闭"
          data-testid="guide-close"
          @click="close"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="min-h-0 flex-1 space-y-4 overflow-auto px-7 py-[22px]">
        <!-- 入口页：挑一栏（**只在重看时出现**；首次自动弹的那次直接进 01）。
             2026-10-04 视觉精修：普通列表行 → "选关卡"大卡（rounded-lg + 实心编号徽标 +
             基础卡主色底衬），让开场有点仪式感。 -->
        <div v-if="!lane" class="space-y-4" data-testid="guide-entry">
          <p class="text-[13px] text-text-secondary">{{ GUIDE_ENTRY.lead }}</p>
          <div class="flex flex-col gap-3">
            <button
              v-for="item in GUIDE_LANES"
              :key="item.id"
              type="button"
              class="flex items-center gap-3.5 rounded-[var(--radius-lg)] border py-4 pl-4 pr-[18px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              :class="
                item.id === 'basics'
                  ? 'border-primary-border bg-primary-soft shadow-[var(--shadow-1)] hover:bg-primary-soft-hover'
                  : 'border-border bg-card-bg hover:bg-card-bg-hover'
              "
              :data-testid="`guide-lane-${item.id}`"
              @click="enterLane(item.id)"
            >
              <span
                class="flex h-[38px] min-w-16 shrink-0 items-center justify-center rounded-badge px-2.5 text-[12px] font-bold tabular-nums"
                :class="
                  item.id === 'basics'
                    ? 'bg-accent text-text-on-accent'
                    : 'bg-card-bg-hover text-text-secondary'
                "
                data-testid="guide-lane-range"
              >
                {{ laneRange[item.id] }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-[14px] font-semibold text-text-primary">
                  {{ item.label }}
                  <span v-if="item.tag" class="ml-1.5 text-[11px] font-normal text-text-tertiary">
                    {{ item.tag }}
                  </span>
                </span>
                <span class="mt-0.5 block text-[12px] leading-snug text-text-tertiary">{{
                  item.hint
                }}</span>
              </span>
              <span
                class="text-[14px]"
                :class="item.id === 'basics' ? 'text-accent' : 'text-text-tertiary'"
                aria-hidden="true"
              >
                →
              </span>
            </button>
          </div>
        </div>

        <template v-else>
          <!-- 2026-10-04 杂志式重排（用户在四方案对照里拍板的 C）：
               左栏 = 当前栏的页导航（可点直达，编号与标题从数据推出来）；
               右栏 = 原来的正文（块循环 / 第 1 页翻页 / toolField 全部原样）。
               ⚠️ 纯布局轮：guide-pages.ts 一个字节没动，所有内容锁照旧成立。 -->
          <div class="flex min-h-0 flex-1 gap-0">
            <nav
              class="w-[150px] shrink-0 overflow-y-auto border-r border-border pr-3"
              aria-label="本栏页目录"
              data-testid="guide-page-nav"
            >
              <button
                v-for="(item, index) in pages"
                :key="item.id"
                type="button"
                class="mb-1 flex w-full items-center gap-2 rounded-badge px-2.5 py-2 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                :class="
                  index === step
                    ? 'bg-primary-soft font-semibold text-accent'
                    : 'text-text-tertiary hover:bg-card-bg-hover hover:text-text-primary'
                "
                :data-testid="`guide-page-nav-item-${index}`"
                @click="step = index"
              >
                <span class="tabular-nums font-bold">{{
                  String(
                    (laneId === 'advanced' ? GUIDE_BASIC_PAGES.length : 0) + index + 1
                  ).padStart(2, '0')
                }}</span>
                <span class="min-w-0 truncate">{{ item.title }}</span>
              </button>
            </nav>

            <div class="min-w-0 flex-1 overflow-y-auto pl-5">
          <!-- 正文：翻页页只放导语，其余页放全部块。
               ⚠️ 第 4 页那三个"就地填"的字段由**块自己**指过来（`block.toolField`）——
               框紧跟它那一块文字，而不是三块讲完再堆三个框（用户 2026-10-04 第 8 条）。 -->
          <template v-for="(block, index) in headBlocks" :key="`${page.id}-${index}`">
            <GuideBlockView :block="block" />

            <div
              v-if="block.toolField"
              class="flex items-center gap-2 rounded-badge border border-border bg-card-bg px-3 py-2"
              data-testid="guide-tool-row"
              :data-field="block.toolField"
            >
              <p
                class="min-w-0 flex-1 truncate text-[12px]"
                :class="fieldPath(block.toolField) ? 'text-text-primary' : 'text-text-tertiary'"
                :data-testid="`guide-tool-${block.toolField}`"
              >
                {{ fieldPath(block.toolField) || '还没选 —— 可以留空，以后在设置里填' }}
              </p>
              <button
                type="button"
                class="shrink-0 rounded-badge border border-border bg-card-bg px-2.5 py-1 text-[12px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                :data-testid="`guide-tool-pick-${block.toolField}`"
                @click="pickField(block.toolField)"
              >
                浏览…
              </button>
            </div>
          </template>

          <!-- 第 1 页：**大图固定不动**，右边线框跟着当前这条换（focus 与文案同源） -->
          <GuideArt
            v-if="slides && page.fixedArt"
            :art="page.fixedArt"
            :focus="currentSlide?.focus"
          />

          <!-- 第 1 页：文案**一屏一条、左右翻** -->
          <div v-if="slides" class="space-y-2">
            <div class="flex items-stretch gap-3" data-testid="guide-slides">
              <button
                type="button"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-badge bg-primary-soft text-xl leading-none text-accent ring-1 ring-inset ring-accent transition-colors hover:bg-accent hover:text-text-on-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary-soft disabled:hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="上一条"
                data-testid="guide-slide-prev"
                :disabled="slideFirst"
                @click="slidePrev"
              >
                ‹
              </button>
              <div class="min-w-0 flex-1" data-testid="guide-slide-body">
                <GuideBlockView v-if="currentSlide" :key="currentSlide.label" :block="currentSlide" />
              </div>
              <button
                type="button"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-badge bg-primary-soft text-xl leading-none text-accent ring-1 ring-inset ring-accent transition-colors hover:bg-accent hover:text-text-on-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary-soft disabled:hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="下一条"
                data-testid="guide-slide-next"
                :disabled="slideLast"
                @click="slideNext"
              >
                ›
              </button>
            </div>
            <p
              class="text-center text-[11px] tabular-nums text-text-tertiary"
              data-testid="guide-slide-pos"
            >
              左右箭头翻看 · {{ slideIndex + 1 }} / {{ slideBlocks.length }}
            </p>
          </div>

          <!-- 第 4 页的三个外部工具路径**就地可填** —— 由各自那一块文字自己带来
               （`block.toolField`，见上面那段），这里不再有"堆在页尾"的版本。 -->
            </div>
          </div>
        </template>
      </div>

      <!-- 页脚：左下 = 圆点 + N / 9（两栏之间留一道缝）；右下 = 跳过 · 上一步 · 主按钮 -->
      <footer class="flex items-center gap-2 border-t border-border px-6 py-3.5">
        <template v-if="lane">
          <div class="flex items-center gap-1.5" data-testid="guide-dots" aria-hidden="true">
            <span
              v-for="(item, index) in GUIDE_PAGES"
              :key="item.id"
              class="h-1.5 rounded-full transition-colors"
              :class="[
                index === globalNo - 1 ? 'w-4 bg-accent' : 'w-1.5 bg-border-strong',
                index === GUIDE_BASIC_PAGES.length - 1 ? 'mr-1.5' : ''
              ]"
            />
          </div>
          <span
            class="text-[11px] tabular-nums text-text-tertiary"
            data-testid="guide-step"
          >
            {{ globalNo }} / {{ totalPages }}
          </span>
        </template>
        <button
          type="button"
          class="ml-auto rounded-badge px-3 py-1.5 text-sm text-text-tertiary transition-colors hover:bg-card-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="guide-skip"
          @click="close"
        >
          {{ skipLabel }}
        </button>
        <button
          v-if="lane"
          type="button"
          class="rounded-badge border border-border bg-card-bg px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary active:bg-card-bg-pressed disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="guide-prev"
          :disabled="step === 0"
          @click="goPrev"
        >
          上一步
        </button>
        <!-- 2026-10-04 视觉精修：主按钮加重（字重 + 内边距 + 一层小阴影）——
             "下一步"是这一页唯一的行动点，页脚里必须最显眼。 -->
        <button
          v-if="lane"
          ref="nextButton"
          type="button"
          class="rounded-badge bg-accent px-[22px] py-2 text-sm font-semibold text-text-on-accent shadow-[var(--shadow-1)] transition-colors hover:bg-primary-hover active:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="guide-next"
          @click="onPrimaryClick"
        >
          {{ primaryLabel }}
        </button>
      </footer>
    </div>
  </div>
</template>
