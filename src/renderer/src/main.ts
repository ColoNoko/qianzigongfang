import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { bootstrapTheme, useThemeStore } from './stores/theme'
import { useAchievementsStore } from './stores/achievements'
import { useSettingsStore } from './stores/settings'
import { useProjectWorkspace } from './stores/projectWorkspace'
import { resolveStartupPath } from './features/project/project-route'
import './styles/index.css'

function formatUnknownError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}

function writeRendererLog(
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  data?: unknown
): void {
  if (typeof window.comicType?.writeLog !== 'function') {
    console.error('[diagnostics] Logging bridge is unavailable', { level, scope, message, data })
    return
  }
  void window.comicType.writeLog({ level, scope, message, data }).catch((error) => {
    // The main process mirrors renderer console errors into the log, providing
    // a second route when this IPC call itself is what failed.
    console.error('[diagnostics] Failed to write renderer log', {
      level,
      scope,
      message,
      data,
      error: formatUnknownError(error)
    })
  })
}

window.addEventListener('error', (event) => {
  writeRendererLog('error', 'renderer-window', 'Uncaught renderer error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: formatUnknownError(event.error)
  })
})

window.addEventListener('unhandledrejection', (event) => {
  writeRendererLog('error', 'renderer-window', 'Unhandled renderer rejection', {
    reason: formatUnknownError(event.reason)
  })
})

// Prevent text/file drags that leave an input from navigating the Electron
// window when the pointer is released outside the field.
window.addEventListener('dragover', (event) => event.preventDefault())
window.addEventListener('drop', (event) => {
  const target = event.target as Element | null
  if (target?.closest('[data-labelplus-dropzone]')) return
  event.preventDefault()
})

// Apply the persisted theme before Vue mounts, so the very first frame is
// already in the user's theme instead of flashing the light default. The
// result is logged because it is the only observable proof of which source
// (main-process arguments vs localStorage) decided the first paint.
const bootTheme = bootstrapTheme()
if (bootTheme) {
  writeRendererLog('info', 'theme-bootstrap', 'Applied persisted theme before first paint', {
    source: bootTheme.source,
    mode: bootTheme.mode,
    resolved: bootTheme.resolved,
    colors: bootTheme.colors
  })
}

const app = createApp(App)
const pinia = createPinia()

router.afterEach((to, from, failure) => {
  writeRendererLog(
    failure ? 'error' : 'info',
    'router',
    failure ? 'Navigation failed' : 'Navigation completed',
    {
      from: from.fullPath,
      to: to.fullPath,
      routeName: typeof to.name === 'symbol' ? to.name.description : to.name,
      failure: failure ? formatUnknownError(failure) : undefined
    }
  )
})

router.onError((error, to, from) => {
  writeRendererLog('error', 'router', 'Router error', {
    from: from.fullPath,
    to: to.fullPath,
    error: formatUnknownError(error)
  })
})

app.config.errorHandler = (error, instance, info) => {
  writeRendererLog('error', 'vue', 'Unhandled Vue error', {
    info,
    component: instance?.$options.name,
    error: formatUnknownError(error)
  })
}

app.use(pinia)
app.use(router)

/**
 * Land on the chapter the user left off in — decided before Vue mounts, so a
 * returning user never sees the dashboard flash first. The decision table lives
 * in `resolveStartupPath()` (pure, unit-tested); this only gathers its inputs.
 *
 * The "last opened chapter" is the existing `recentProjectIds` history that
 * `Project.vue` maintains, so no new persistence is involved.
 */
async function resolveStartupRoute(): Promise<void> {
  // The initial navigation has to settle first, otherwise `currentRoute` is
  // still the router's START_LOCATION and every window would look like a deep
  // link (and be left alone).
  await router.isReady()

  const workspace = useProjectWorkspace(pinia)
  const [rawRecentIds] = await Promise.all([
    window.comicType.storeGet('recentProjectIds'),
    workspace.loadParents()
  ])
  const recentChildIds = Array.isArray(rawRecentIds)
    ? rawRecentIds.filter((value): value is string => typeof value === 'string')
    : []

  const path = resolveStartupPath({
    routeName: router.currentRoute.value.name as string | undefined,
    recentChildIds,
    parents: workspace.parents
  })

  writeRendererLog('info', 'startup-route', 'Resolved the opening screen', {
    from: router.currentRoute.value.fullPath,
    path,
    recentChildIds,
    chapterCount: workspace.parents.reduce((total, parent) => total + parent.children.length, 0)
  })

  if (!path || path === router.currentRoute.value.fullPath) return
  await router.replace(path)
}

// Mount either way — a failure here must not leave the user with no window.
void resolveStartupRoute()
  .catch((error) => {
    writeRendererLog('error', 'startup-route', 'Failed to resolve the opening screen', {
      error: formatUnknownError(error)
    })
  })
  .finally(() => {
    app.mount('#app')

    writeRendererLog('info', 'renderer', 'Renderer started', {
      href: window.location.href,
      userAgent: window.navigator.userAgent
    })
  })

// Initialize theme after mount so the DOM root is available for data-theme.
const themeStore = useThemeStore()
themeStore.initTheme()
void useSettingsStore(pinia).loadSettings()

// Refresh achievements quietly every five minutes while the app is visible.
useAchievementsStore(pinia).startSilentRefresh()
