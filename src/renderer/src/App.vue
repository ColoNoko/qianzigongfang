<script setup lang="ts">
// WeChat-PC style shell: narrow left icon rail + content panel.
// Nav order mirrors the oldcode QTabWidget tabs (漫画管理/设置) plus the
// plan's Project + Achievements entries.
import { computed, onBeforeUnmount, onErrorCaptured, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ErrorToast from '@renderer/components/ErrorToast.vue'
import GuideDialog from '@renderer/features/guide/GuideDialog.vue'
import { GUIDE_TOOL_FIELDS, GUIDE_VERSION } from '@renderer/features/guide/guide-pages'
import { useThemeStore } from '@renderer/stores/theme'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useSettingsStore } from '@renderer/stores/settings'
import { resolveProjectNavPath } from '@renderer/features/project/project-route'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
// 「项目」按钮的落点要看"本会话正在看哪一话"，所以这里要拿工作区 store。
const workspace = useProjectWorkspace()
// 新手引导：看没看过存在 settings（`ui.guideSeenVersion`，见交接文档 §13.9）。
const settings = useSettingsStore()
const guideOpen = ref(false)
/**
 * 这次打开**要不要先停在入口页挑栏**（用户 2026-10-03 定的向导规矩）：
 * - **首次**（启动自动弹的那次）→ `false`：不给选择，直接进 `01` 强制看基础；
 * - **重看**（左下角「指引」）→ `true`：先给入口页，让你挑"基础 01–05 / 进阶 06–09"。
 */
const guideStartWithEntry = ref(false)
/** 引导第 4 页"就地填"那三个字段要显示的当前值（引导组件不读存储，由这里喂）。 */
const guideToolPaths = computed(() => ({
  labelPlusFx: settings.labelPlusFxPath,
  photoshop: settings.photoshopPath,
  importScript: settings.typesetImportScript
}))
const pageError = ref('')
const isNightMode = computed(() => themeStore.resolvedTheme === 'dark')
const isStandalone = computed(() => route.meta.standalone === true)

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
  // 重看：先给入口页挑栏（首次那次是自动弹的，不走这里）。
  guideStartWithEntry.value = true
  guideOpen.value = true
}

/** 关闭就记"看过了"（跳过也算）—— 否则每次启动都会再弹一次。 */
function closeGuide(): void {
  guideOpen.value = false
  settings.markGuideSeen(GUIDE_VERSION)
}

/**
 * 引导里"浏览…"挑外部工具（第 4 页就地填）—— **落库在宿主这一层做**，
 * 引导组件只 emit（它不认识存储，见 `GuideDialog.vue` 顶部那段）。
 */
async function onGuidePickTool(field: 'labelPlusFx' | 'photoshop' | 'importScript'): Promise<void> {
  const meta = GUIDE_TOOL_FIELDS.find((item) => item.id === field)
  if (!meta) return
  const picked = await window.comicType.pickToolFile(meta.pickKind)
  if (!picked) return
  if (field === 'labelPlusFx') settings.setLabelPlusFxPath(picked)
  else if (field === 'photoshop') settings.setPhotoshopPath(picked)
  else settings.setTypesetImportScript(picked)
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
  <div v-else class="flex h-full bg-app-bg text-text-primary" data-testid="app-shell">
    <!-- Global toast renderer (fixed top-right, always mounted) -->
    <ErrorToast />

    <!-- Left icon rail — WeChat-PC style, fixed 56px.
         激活态不再是一整块高亮：56×64 的色块一屏有 6 个候选位置，太吵；
         现在只留"主色图标 + 左侧 3px 竖条"，视线焦点回到内容区。
         （App-navigation.spec 锁的是激活项必须含 text-accent，这条保留。） -->
    <nav
      class="flex w-14 flex-col items-center border-r border-border bg-card-bg"
      aria-label="主导航"
      data-testid="app-nav"
    >
      <button
        v-for="item in navItems"
        :key="item.name"
        type="button"
        class="group relative flex h-16 w-full flex-col items-center justify-center gap-1.5 transition-colors"
        :class="
          isActive(item.name)
            ? 'text-accent'
            : 'text-text-secondary hover:bg-card-bg-hover hover:text-text-primary'
        "
        :title="item.label"
        :data-testid="`nav-${item.name}`"
        @click="navigate(item.to)"
      >
        <span
          v-if="isActive(item.name)"
          class="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
          aria-hidden="true"
        />
        <!-- Dashboard: grid icon -->
        <svg
          v-if="item.name === 'dashboard'"
          class="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <!-- Project: folder icon -->
        <svg
          v-else-if="item.name === 'project'"
          class="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"
          />
        </svg>
        <!-- Progress: hourglass icon（欠账清单：还欠几话、多久没动） -->
        <svg
          v-else-if="item.name === 'progress'"
          class="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M6 2h12" />
          <path d="M6 22h12" />
          <path d="M8 2v4l4 5 4-5V2" />
          <path d="M8 22v-4l4-5 4 5v4" />
        </svg>
        <!-- Achievements: trophy icon -->
        <svg
          v-else-if="item.name === 'achievements'"
          class="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 21h8" />
          <path d="M12 17v4" />
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
          <path d="M17 5h3v2a3 3 0 0 1-3 3" />
          <path d="M7 5H4v2a3 3 0 0 0 3 3" />
        </svg>
        <!-- Fonts: typography icon -->
        <svg
          v-else-if="item.name === 'fonts'"
          class="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 19 10 5h2l6 14" />
          <path d="M6.5 14h9" />
          <path d="M17 9h3" />
          <path d="M18.5 9v10" />
        </svg>
        <!-- Import: download icon -->
        <svg
          v-else-if="item.name === 'import'"
          class="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 20h14" />
        </svg>
        <!-- Settings: gear icon -->
        <svg
          v-else-if="item.name === 'settings'"
          class="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
        <span class="text-[11px] leading-none">{{ item.label }}</span>
      </button>

      <!-- 指引：随时重看新手引导。样式与下面那个昼夜按钮同一套（同样的 h-16、
           24px 图标、11px 小字、悬停底色），只是不占 mt-auto —— 那个留给昼夜按钮，
           它负责顶到最底下。 -->
      <button
        type="button"
        class="flex h-16 w-full flex-col items-center justify-center gap-1.5 text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
        title="指引（重新查看新手引导）"
        data-testid="guide-open"
        @click="openGuide"
      >
        <!-- Help circle：侧栏其余图标都是"物件/动作"，问号圈最不容易和设置（齿轮）、
             字体（A）混。 -->
        <svg
          class="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M9.4 9.3a2.7 2.7 0 0 1 5.4.8c0 1.8-2.8 2.1-2.8 3.6" />
          <path d="M12 17.1h.01" />
        </svg>
        <span class="text-[11px] leading-none">指引</span>
      </button>

      <button
        type="button"
        class="mt-auto flex h-16 w-full flex-col items-center justify-center gap-1.5 text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
        :title="isNightMode ? '切换到日间模式' : '切换到夜间模式'"
        data-testid="night-mode-toggle"
        @click="toggleNightMode"
      >
        <svg
          v-if="isNightMode"
          class="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"
          />
        </svg>
        <svg
          v-else
          class="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        <span class="text-[11px] leading-none">{{ isNightMode ? '日间' : '夜间' }}</span>
      </button>
    </nav>

    <!-- Right content area -->
    <!-- min-h-0 不是装饰：`overflow-auto` 的 flex 项必须允许收缩到内容以下，
         否则它会被内容撑着长高、进而把整个外壳（和文档）一起撑高 —— 见 §0 第二十轮。
         relative 也不是装饰：内容区必须自己当**定位基准**，设置页里那些 `sr-only`
         （= position: absolute）的控件才不会被甩到"初始包含块"上、进而不受这层 overflow 裁剪、
         把**文档**顶高出一根多余的滚动条 —— 见 §0 第二十二轮。 -->
    <main class="relative flex-1 min-h-0 overflow-auto" data-testid="app-main">
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
          <button
            type="button"
            class="mt-4 rounded-badge bg-accent px-4 py-2 text-sm text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active"
            @click="reloadApp"
          >
            重新加载
          </button>
        </div>
      </section>
      <RouterView v-slot="{ Component }" v-else>
        <KeepAlive include="Import">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </main>

    <!-- 新手引导：首启自动弹一次，之后由左下角「指引」再打开（同一个弹窗）。 -->
    <GuideDialog
      :open="guideOpen"
      :start-with-entry="guideStartWithEntry"
      :tool-paths="guideToolPaths"
      @close="closeGuide"
      @pick-tool="onGuidePickTool"
    />
  </div>
</template>
