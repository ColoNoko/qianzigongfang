<script setup lang="ts">
import { Popover, PopoverTrigger, PopoverContent } from './components/ui/popover'
import WorkModeSegments from './components/WorkModeSegments.vue'
import NavigationIcon from './features/shell/NavigationIcon.vue'

import ActionConfirmation from './components/ActionConfirmation.vue'
import { Button as UiButton } from '@renderer/components/ui/button'
// WeChat-PC style shell: narrow left icon rail + content panel.
// Nav order mirrors the oldcode QTabWidget tabs (漫画管理/设置) plus the
// plan's Project + Achievements entries.
import { computed, onBeforeUnmount, onErrorCaptured, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ErrorToast from '@renderer/components/ErrorToast.vue'
import GuideDialog from '@renderer/features/guide/GuideDialog.vue'
import { GUIDE_VERSION } from '@renderer/features/guide/guide-config'
import { useThemeStore } from '@renderer/stores/theme'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useSettingsStore } from '@renderer/stores/settings'
import { PROJECT_INCREMENTAL_INTERVAL, runProjectIncrementalScan } from '@renderer/services/project-incremental'
import { resolveProjectNavPath } from '@renderer/features/project/project-route'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
// 「项目」按钮的落点要看"本会话正在看哪一话"，所以这里要拿工作区 store。
const workspace = useProjectWorkspace()
// 新手引导：看没看过存在 settings（`ui.guideSeenVersion`，见交接文档 §13.9）。
const settings = useSettingsStore()
const selectedWorkMode = computed(() => settings.activeWorkMode)
function selectWorkMode(mode: import('@shared/types').WorkMode): void {
  void settings.setActiveWorkMode(mode)
}
let incrementalTimer: ReturnType<typeof setInterval> | undefined
let incrementalGeneration = 0
watch(() => settings.autoIncrementalScan, enabled => {
  clearInterval(incrementalTimer)
  const generation = ++incrementalGeneration
  if (!enabled) return
  incrementalTimer = setInterval(() => {
    if (route.meta.standalone) return
    void runProjectIncrementalScan(() => generation === incrementalGeneration && settings.autoIncrementalScan)
      .catch(error => console.error('后台项目扫描失败', error))
  }, PROJECT_INCREMENTAL_INTERVAL)
}, { immediate: true })
const guideOpen = ref(false)
// 首次自动打开快速上手；主动打开时进入功能查阅。
const guideStartWithEntry = ref(false)
const pageError = ref('')
const isNightMode = computed(() => themeStore.resolvedTheme === 'dark')
const isStandalone = computed(() => route.meta.standalone === true)
const nativeTitleOverlay = navigator.userAgent.includes('Windows')
watch(isNightMode, dark => {
  if (!isStandalone.value) void window.comicType.setWindowTitleBarTheme?.(dark ? 'dark' : 'light').catch(() => undefined)
}, {immediate:true})

/**
 * 首次启动自动弹一次引导，左下角「指引」按钮随时再弹（同一个弹窗）。
 *
 * **为什么要等 `settingsLoaded`**：settings 是在界面挂载**之后**才异步加载的
 * （`main.ts` 里那句 `void useSettingsStore(pinia).loadSettings()`），
 * 刚挂载时读到的还是初始值 0 —— 直接判断就会每次启动都闪一下引导。
 * 等那面旗子立起来再判，就分得清"没看过"和"还没读到"；
 * 也**不去改启动顺序**（§13.10 要求动启动期行为时连带检查四处 + 真机看日志）。
 */
watch(
  () => settings.settingsLoaded,
  (loaded) => {
    if (loaded && settings.guideSeenVersion < GUIDE_VERSION) {
      // 首次：**不给选择**，直接进 01（用户 2026-10-03 定的向导规矩）。
      guideStartWithEntry.value = false
      guideOpen.value = true
    }
  },
  { immediate: true }
)

function openGuide(): void {
  // 主动查阅：默认显示功能查阅。
  guideStartWithEntry.value = true
  guideOpen.value = true
}

/** 关闭就记"看过了"（跳过也算）—— 否则每次启动都会再弹一次。 */
function closeGuide(): void {
  guideOpen.value = false
  settings.markGuideSeen(GUIDE_VERSION)
}

interface NavItem {
  to: string
  label: string
  // Match by route name for active highlight — avoids partial-match noise
  // on the '/' dashboard route that router-link-active would otherwise cause.
  name: string
}

const navItems: NavItem[] = [
  { to: '/', label: '首页', name: 'dashboard' },
  { to: '/project', label: '项目', name: 'project' },
  { to: '/progress', label: '进度', name: 'progress' },
  { to: '/achievements', label: '成就', name: 'achievements' },
  { to: '/fonts', label: '字体', name: 'fonts' },
  { to: '/import', label: '导入', name: 'import' },
  { to: '/settings', label: '设置', name: 'settings' }
]

function isActive(name: string): boolean {
  if (name === 'dashboard') return route.name === 'dashboard'
  if (name === 'project') return route.name === 'project' || route.name === 'projectIndex'
  return route.name === name
}

/**
 * 导航落点。「项目」不是固定去列表页 —— 从别的页面切回来时，如果本会话看过
 * 某一话就直接回那一话（用户点名的痛点一）；已经在项目页面上则回列表页，
 * 否则列表页会变得无法到达。判定表在纯函数 `resolveProjectNavPath()` 里，
 * 由 `project-route.spec` 锁住。
 */
function navigate(to: string): void {
  const target =
    to === '/project'
      ? resolveProjectNavPath({
          routeName: route.name as string | undefined,
          activeChild: workspace.activeChild,
          parents: workspace.parents
        })
      : to
  if (route.path === target) return
  void router.push(target)
}

function formatPageError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

onErrorCaptured((error, instance, info) => {
  pageError.value = formatPageError(error)

  if (typeof window.comicType?.writeLog === 'function') {
    void window.comicType
      .writeLog({
        level: 'error',
        scope: 'page-render',
        message: 'Route page failed to render',
        data: {
          route: route.fullPath,
          info,
          component: instance?.$options.name,
          error: {
            message: formatPageError(error),
            stack: error instanceof Error ? error.stack : undefined
          }
        }
      })
      .catch((logError) => {
        // Main-process console capture provides a second diagnostic route.
        console.error('[diagnostics] Failed to write page error log', {
          pageError: formatPageError(error),
          logError: formatPageError(logError)
        })
      })
  }

  // The route error is handled by the visible fallback below.
  return false
})

watch(
  () => route.fullPath,
  () => {
    pageError.value = ''
  }
)

function reloadApp(): void {
  window.location.reload()
}

function toggleNightMode(): void {
  themeStore.setTheme(isNightMode.value ? 'light' : 'dark')
}

/**
 * 布局取证（2026-09-30，对应 §0 第二十轮；结论见 §0 第二十二轮）。
 *
 * 现象：设置页滚到底时，**整个界面（连同左侧导航条）被向上顶走**，窗口底部露出一截 `--app-bg`；
 * 而且右侧同时出现**两根滚动条**（内容区 + 文档级），这是滚动链（scroll chaining）的签名。
 *
 * 为什么先取证而不是直接改：静态截图区分不出两种可能 ——
 *   ① 渲染层视口高度与真实窗口不同步（最大化 / 改尺寸之后）；
 *   ② 文档确实被某处撑高了，滚动从内容区传到了文档。
 * 两者对应的修法完全不同。所以把**现场尺寸**写进现有日志通道（主进程日志 `psd-manager.log`），
 * 下次再出现时直接有确凿数字。
 *
 * ✅ 结论（第二十二轮，2026-09-30 17:38 那次启动抓到了数字）：是 ②。
 * 撑高文档的是设置页里的 `sr-only` 控件（Tailwind 的 `sr-only` 就是 `position: absolute`）：
 * 当时外壳里**没有任何定位祖先**，它们的包含块落到**初始包含块** —— 既不受内容区
 * `overflow-auto` 的裁剪，又按"文档里的静态位置"计入文档的可滚动溢出。实测
 * documentScrollHeight **1551** > documentClientHeight **1082**（外壳高 1081.6 = 视口，尺寸链是好的），
 * 于是右侧多出一根文档级滚动条，滚它就把整个外壳连同左侧导航一起顶走。修法见 `<main>` 上的 `relative`。
 * 这套取证留在原地：它是这次能定位的原因，而且平时不刷日志。
 *
 * 只在三件事发生时记：**窗口尺寸变 / 路由变 / 文档真的滚了**（最后这条本身就是病征）。
 * 都很少见，不会刷日志；`documentScrollTop !== 0` 那一条才是关键证据。
 */
function logLayoutGeometry(reason: string): void {
  if (typeof window.comicType?.writeLog !== 'function') return
  const doc = document.documentElement
  const heightOf = (selector: string): number | null => {
    const element = document.querySelector(selector)
    return element ? element.getBoundingClientRect().height : null
  }
  const main = document.querySelector<HTMLElement>('[data-testid="app-main"]')
  void window.comicType
    .writeLog({
      level: 'info',
      scope: 'layout',
      message: 'Layout geometry snapshot',
      data: {
        reason,
        route: route.fullPath,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        documentScrollTop: doc.scrollTop,
        documentClientHeight: doc.clientHeight,
        documentScrollHeight: doc.scrollHeight,
        shellHeight: heightOf('[data-testid="app-shell"]'),
        navHeight: heightOf('[data-testid="app-nav"]'),
        mainClientHeight: main ? main.clientHeight : null,
        mainScrollHeight: main ? main.scrollHeight : null
      }
    })
    .catch(() => {
      // 取证失败绝不能影响界面 —— 这条日志本来就是"可有可无"的。
    })
}

/** resize 会连发几十次，合并成一次记录。 */
let layoutLogTimer: ReturnType<typeof setTimeout> | null = null

function scheduleLayoutLog(reason: string): void {
  if (layoutLogTimer !== null) clearTimeout(layoutLogTimer)
  layoutLogTimer = setTimeout(() => {
    layoutLogTimer = null
    logLayoutGeometry(reason)
  }, 300)
}

function onWindowResize(): void {
  scheduleLayoutLog('resize')
}

function onDocumentScroll(): void {
  // 文档本身**不该**能滚：一旦滚了就是这次的病征（那时才记，正常滚动不记）。
  if (document.documentElement.scrollTop !== 0) scheduleLayoutLog('document-scroll')
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('scroll', onDocumentScroll, { passive: true })
  scheduleLayoutLog('mount')
})

onBeforeUnmount(() => {
  incrementalGeneration++
  clearInterval(incrementalTimer)
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('scroll', onDocumentScroll)
  if (layoutLogTimer !== null) clearTimeout(layoutLogTimer)
})

watch(
  () => route.fullPath,
  () => {
    scheduleLayoutLog('route')
  }
)
</script>

<template>
  <div v-if="isStandalone" class="h-screen bg-app-bg text-text-primary">
    <section v-if="pageError" class="flex h-full items-center justify-center p-8" data-testid="page-error">
      <div class="max-w-lg rounded-xl border border-border bg-card-bg p-6 text-center shadow-[var(--shadow-1)]">
        <h1 class="text-lg font-semibold text-text-primary">页面加载失败</h1>
        <p class="mt-2 break-all rounded bg-app-bg p-3 text-left text-xs text-text-secondary">{{ pageError }}</p>
      </div>
    </section>
    <RouterView v-else />
  </div>
  <div v-else class="flex h-full flex-col bg-app-bg text-text-primary" data-testid="app-shell" :data-native-overlay="nativeTitleOverlay">
    <div v-if="nativeTitleOverlay" class="window-titlebar" data-testid="window-titlebar" aria-hidden="true"></div>
    <div class="app-body flex min-h-0 flex-1">
    <!-- Global toast renderer (fixed top-right, always mounted) -->
    <ErrorToast />
    <ActionConfirmation />

    <!-- Left icon rail — WeChat-PC style, fixed 56px.
         激活态不再是一整块高亮：56×64 的色块一屏有 6 个候选位置，太吵；
         现在只留"主色图标 + 左侧 3px 竖条"，视线焦点回到内容区。
         （App-navigation.spec 锁的是激活项必须含 text-accent，这条保留。） -->
    <nav
      class="app-nav flex w-14 shrink-0 flex-col items-center overflow-y-auto border-r border-border bg-card-bg"
      :data-night="isNightMode"
      aria-label="主导航"
      data-testid="app-nav"
    >
      <UiButton variant="ghost" size="sm"
        v-for="item in navItems"
        :key="item.name"
        type="button"
        class="group relative h-16 w-full shrink-0 flex-col gap-1.5 rounded-none px-0 [&_svg]:size-6"
        :class="
          isActive(item.name)
            ? 'text-accent'
            : 'text-text-secondary hover:bg-card-bg-hover hover:text-text-primary'
        "
        :title="item.label"
        :aria-current="isActive(item.name) ? 'page' : undefined"
        :data-testid="`nav-${item.name}`"
        @click="navigate(item.to)"
      >
        <span
          v-if="isActive(item.name)"
          class="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
          aria-hidden="true"
        />
        <NavigationIcon :name="item.name" />
        <span class="text-[11px] leading-none">{{ item.label }}</span>
      </UiButton>

      <div class="mt-auto" />
      <Popover v-if="settings.enabledWorkModes.length > 1">
        <PopoverTrigger as-child>
          <UiButton variant="ghost" size="sm" class="h-16 w-full shrink-0 flex-col gap-1.5 rounded-none px-0 [&_svg]:size-6" data-testid="work-mode-open" aria-label="切换默认工作模式" title="默认模式，不修改各作品职责">
            <NavigationIcon name="mode" />
            <span class="text-[11px] leading-none">默认模式</span>
          </UiButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" class="w-auto p-2" data-testid="work-mode-menu">
          <p class="mb-2 text-xs font-medium text-text-primary">默认工作模式</p>
          <WorkModeSegments label="默认工作模式" :model-value="selectedWorkMode" reselect :modes="settings.enabledWorkModes" :disabled="settings.savingWorkModes" @update:model-value="selectWorkMode" />
          <p class="mt-2 max-w-64 text-[11px] leading-relaxed text-text-tertiary">未设职责的作品进入章节时使用此模式；已有职责与当前章节手动选择不受影响。</p>
        </PopoverContent>
      </Popover>
      <!-- 指引：随时重看新手引导。样式与下面那个昼夜按钮同一套（同样的 h-16、
           24px 图标、11px 小字、悬停底色），只是不占 mt-auto —— 那个留给昼夜按钮，
           它负责顶到最底下。 -->
      <UiButton variant="ghost" size="sm"
        type="button"
        class="h-16 w-full shrink-0 flex-col gap-1.5 rounded-none px-0 [&_svg]:size-6"
        title="指引（重新查看新手引导）"
        data-testid="guide-open"
        @click="openGuide"
      >
        <NavigationIcon name="guide" />
        <span class="text-[11px] leading-none">指引</span>
      </UiButton>

      <UiButton variant="ghost" size="sm"
        type="button"
        class="h-16 w-full shrink-0 flex-col gap-1.5 rounded-none px-0 [&_svg]:size-6"
        :title="isNightMode ? '切换到日间模式' : '切换到夜间模式'"
        data-testid="night-mode-toggle"
        @click="toggleNightMode"
      >
        <NavigationIcon :name="isNightMode ? 'sun' : 'moon'" />
        <span class="text-[11px] leading-none">{{ isNightMode ? '日间' : '夜间' }}</span>
      </UiButton>
    </nav>

    <!-- Right content area -->
    <!-- min-h-0 不是装饰：`overflow-auto` 的 flex 项必须允许收缩到内容以下，
         否则它会被内容撑着长高、进而把整个外壳（和文档）一起撑高 —— 见 §0 第二十轮。
         relative 也不是装饰：内容区必须自己当**定位基准**，设置页里那些 `sr-only`
         （= position: absolute）的控件才不会被甩到"初始包含块"上、进而不受这层 overflow 裁剪、
         把**文档**顶高出一根多余的滚动条 —— 见 §0 第二十二轮。 -->
    <main class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="app-main" :data-project-workspace="route.name === 'project'">
      <div class="app-scroll min-h-0 flex-1 overflow-auto">
      <section
        v-if="pageError"
        class="flex h-full min-h-80 items-center justify-center p-8"
        data-testid="page-error"
      >
        <div class="max-w-lg rounded-xl border border-border bg-card-bg p-6 text-center shadow-[var(--shadow-1)]">
          <h1 class="text-lg font-semibold text-text-primary">页面加载失败</h1>
          <p class="mt-2 text-sm text-text-secondary">
            页面出现异常，已将详细信息写入日志。你可以重新加载应用后再试。
          </p>
          <p class="mt-3 break-all rounded bg-app-bg p-3 text-left text-xs text-text-secondary">
            {{ pageError }}
          </p>
          <UiButton variant="default" size="sm"
            type="button"
            class="mt-4 transition-colors"
            @click="reloadApp"
          >
            重新加载
          </UiButton>
        </div>
      </section>
      <RouterView v-slot="{ Component }" v-else>
        <KeepAlive include="Import">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
      </div>
    </main>
    </div>

    <!-- 新手引导：首启自动弹一次，之后由左下角「指引」再打开（同一个弹窗）。 -->
    <GuideDialog
      :open="guideOpen"
      :start-with-entry="guideStartWithEntry"
      @close="closeGuide"
    />
  </div>
</template>

<style scoped>
.window-titlebar { position:fixed; inset:0 0 auto; height:env(titlebar-area-height,36px); -webkit-app-region:drag; pointer-events:none; }
[data-native-overlay="true"] :deep(:is(button, a, input, select, textarea, [role="button"], [role="radio"], [role="slider"], [role="separator"], [role="dialog"])) { -webkit-app-region:no-drag; }
[data-native-overlay="true"] { --window-controls-inset: env(titlebar-area-height,36px); }
[data-native-overlay="true"] .app-nav { padding-top:var(--window-controls-inset); }
[data-native-overlay="true"] .app-scroll { margin-top:var(--window-controls-inset); }
[data-native-overlay="true"] [data-project-workspace="true"] > .app-scroll { margin-top:0; overflow:hidden; }
[data-native-overlay="true"] :deep(.project-sidebar-scroll) { margin-top:var(--window-controls-inset); }
[data-native-overlay="true"] :deep([data-viewer-workspace] > header) { padding-top:calc(var(--window-controls-inset) + 8px); min-height:calc(96px + var(--window-controls-inset)); }
.app-nav { --nav-ink: var(--text-secondary); }
.app-nav[data-night="true"] { --nav-ink: color-mix(in srgb, var(--text-secondary) 80%, var(--text-primary)); --nav-icon-wash: .14; }
.app-nav > button { color: var(--nav-ink); }
.app-nav > button:hover, .app-nav > button[data-state="open"] { color: var(--text-primary); background: var(--hover-surface); }
.app-nav > button[aria-current="page"] { color: var(--primary); }
.app-nav > button:focus-visible { box-shadow: inset 0 0 0 2px var(--ring); }
</style>
