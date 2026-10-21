import { closeFontRepository } from './fonts/repository'
import { app, shell, BrowserWindow, dialog, screen } from 'electron'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerHandlers } from './ipc/handlers'
import { getLogPath, writeLog } from './services/logger'
import {
  closeDatabase,
  databasePath,
  getDatabase,
  getStoredValue,
  setStoredValue,
  setStoredValueSync
} from './services/database'
import { autoBackupIfDue } from './services/db-backup'
import { IPC_GUARD_FLAG } from '../shared/ipc-guard'
import { buildBootThemeArguments } from './services/boot-theme'
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_BOUNDS_STORE_KEY,
  defaultWindowBounds,
  normalizeWindowBounds,
  normalizeWindowPosition,
  type WindowBoundsState
} from './services/window-state'
import { clearLabelPlusPreviewSessions } from './services/labelplus-preview'

/**
 * Development-only data directory.
 *
 * `electron-vite dev` spawns Electron with the project root as its working
 * directory, and Electron would otherwise use an empty default profile — so
 * `pnpm dev` could not see the user's own projects, which live in the
 * workspace `app/data` folder the packaged build points at (see the portable
 * rule below). When that folder is actually a used profile (it has a
 * `database`), reuse it so dev and packaged builds work on the same projects.
 *
 * Returns null when there is nothing to reuse (packaged build, or the source
 * tree was copied somewhere without a workspace data folder).
 */
function resolveDevDataDirectory(): string | null {
  if (app.isPackaged) return null
  const candidate = join(process.cwd(), '..', 'app', 'data')
  return existsSync(join(candidate, 'database')) ? candidate : null
}

function configurePortableDataDirectory(): void {
  const devDataDirectory = resolveDevDataDirectory()
  if (devDataDirectory) {
    app.setPath('userData', devDataDirectory)
    resolvedDataDirectory = { source: 'dev-workspace', path: devDataDirectory }
    return
  }

  const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (process.platform !== 'win32' || !app.isPackaged) {
    resolvedDataDirectory = { source: 'electron-default', path: null }
    return
  }

  // PORTABLE_EXECUTABLE_DIR is supplied by electron-builder's portable stub.
  // dirname(process.execPath) also covers launching the unpacked executable
  // directly, where that environment variable does not exist.
  const executableDir = portableExecutableDir || dirname(process.execPath)

  // Pointing userData here keeps the registry, settings, project memory and
  // logs together in a data folder beside the portable executable.
  const portableData = join(executableDir, 'data')
  app.setPath('userData', portableData)
  resolvedDataDirectory = { source: 'portable-beside-exe', path: portableData }
}

/**
 * Where the profile came from. The decision happens before `app.whenReady()`,
 * so this is the only way to observe it afterwards (see the startup log).
 */
let resolvedDataDirectory: { source: string; path: string | null } = {
  source: 'unset',
  path: null
}

configurePortableDataDirectory()

writeMainLog('info', 'data-directory', 'Resolved the profile directory', {
  source: resolvedDataDirectory.source,
  requested: resolvedDataDirectory.path,
  cwd: process.cwd(),
  devCandidate: join(process.cwd(), '..', 'app', 'data'),
  devCandidateHasDatabase: existsSync(join(process.cwd(), '..', 'app', 'data', 'database')),
  userDataPath: app.getPath('userData')
})

if (process.platform === 'win32') {
  app.commandLine.appendSwitch('high-dpi-support', '1')
}

function getDefaultZoomFactor(scaleFactor: number): number {
  if (process.platform !== 'win32') return 1
  if (scaleFactor >= 2) return 1.15
  if (scaleFactor >= 1.5) return 1.1
  if (scaleFactor >= 1.25) return 1.05
  return 1
}

function formatUnknownError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}

function writeMainLog(
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  data?: unknown
): void {
  void writeLog({ level, scope, message, data }).catch(() => {
    // Preserve the failure somewhere observable when the log directory itself
    // is unavailable (for example because Windows security software locked it).
    console.error(`[${scope}] ${message}`, data)
  })
}

process.on('uncaughtException', (error) => {
  writeMainLog('error', 'main-process', 'Uncaught main-process exception', {
    error: formatUnknownError(error)
  })
})

process.on('unhandledRejection', (reason) => {
  writeMainLog('error', 'main-process', 'Unhandled main-process rejection', {
    reason: formatUnknownError(reason)
  })
})

/** Debounce for persisting the window size while the user drags its edges. */
const WINDOW_BOUNDS_SAVE_DEBOUNCE_MS = 400

function captureWindowBounds(window: BrowserWindow): WindowBoundsState {
  // getNormalBounds() reports the pre-maximize geometry, so a maximized window
  // still remembers which size (and where) to return to.
  const normal = window.getNormalBounds()
  return {
    width: normal.width,
    height: normal.height,
    maximized: window.isMaximized(),
    x: normal.x,
    y: normal.y
  }
}

function persistWindowBounds(window: BrowserWindow): void {
  const bounds = captureWindowBounds(window)
  void setStoredValue(WINDOW_BOUNDS_STORE_KEY, bounds).catch((error) => {
    writeMainLog('warn', 'browser-window', 'Failed to persist window bounds', {
      error: formatUnknownError(error)
    })
  })
}

/**
 * Remember the window size across launches.
 *
 * Resizes are debounced (dragging an edge fires continuously) and `close` adds
 * a synchronous last write: by then the quit sequence may already be closing
 * the database, where an awaited write can lose the race.
 */
function trackWindowBounds(window: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleSave = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (window.isDestroyed()) return
      persistWindowBounds(window)
    }, WINDOW_BOUNDS_SAVE_DEBOUNCE_MS)
  }

  window.on('resize', scheduleSave)
  // 拖动窗口同样要记（D4）；与 resize 共用一个防抖计时器，拖完只写一次。
  window.on('move', scheduleSave)
  window.on('maximize', scheduleSave)
  window.on('unmaximize', scheduleSave)
  window.on('close', () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!setStoredValueSync(WINDOW_BOUNDS_STORE_KEY, captureWindowBounds(window))) {
      persistWindowBounds(window)
    }
  })
}

/**
 * Stored size + position, clamped to the screens we are about to open on.
 *
 * 位置要按**所有**显示器校验（换屏/拔掉扩展屏之后，上次的坐标可能已经在屏幕外）：
 * 校验不过就返回不带 x/y 的 bounds，让系统居中 —— 那比"开在看不见的地方"安全。
 */
async function resolveWindowBounds(): Promise<WindowBoundsState> {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  let stored: unknown = null
  try {
    stored = await getStoredValue(WINDOW_BOUNDS_STORE_KEY)
  } catch (error) {
    writeMainLog('warn', 'browser-window', 'Failed to read stored window bounds; using default', {
      error: formatUnknownError(error)
    })
    return defaultWindowBounds(workArea)
  }

  const size = normalizeWindowBounds(stored, workArea)
  const displays = screen.getAllDisplays().map((display) => display.workArea)
  const position = normalizeWindowPosition(stored, displays, size)
  if (!position) {
    writeMainLog('info', 'browser-window', 'Window position not restorable; centering', {
      stored,
      displayCount: displays.length
    })
    return size
  }
  return { ...size, x: position.x, y: position.y }
}

/** argv entries that let the renderer paint its first frame in the right theme. */
async function resolveBootThemeArguments(): Promise<string[]> {
  try {
    const [modeValue, colorValue] = await Promise.all([
      getStoredValue('theme'),
      getStoredValue('theme.colors')
    ])
    return buildBootThemeArguments(modeValue, colorValue)
  } catch (error) {
    writeMainLog('warn', 'browser-window', 'Failed to read stored theme for first paint', {
      error: formatUnknownError(error)
    })
    return []
  }
}

function createWindow(bounds: WindowBoundsState, bootThemeArguments: string[]): void {
  // The display is read again here (rather than reused from resolveWindowBounds)
  // because the zoom factor below must follow the screen the window opens on.
  const display = screen.getPrimaryDisplay()

  const mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    // 只有校验过的位置才传：不传时 Electron 会居中（沿用老行为）。
    ...(typeof bounds.x === 'number' && typeof bounds.y === 'number'
      ? { x: bounds.x, y: bounds.y }
      : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: '汉化工坊',
    ...(process.platform === 'win32' ? {titleBarStyle:'hidden' as const,titleBarOverlay:{color:'#00000000',symbolColor:'#202124',height:36}} : {}),
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Sandbox=true isolates the preload from Node; the IPC bridge in
      // task 2.2 must be written to work in that mode. If a future
      // preload feature requires Node access, flip this back to false
      // and document why in a comment here.
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      additionalArguments: bootThemeArguments
    }
  })

  if (bounds.maximized) mainWindow.maximize()

  trackWindowBounds(mainWindow)

  writeMainLog('info', 'browser-window', 'BrowserWindow created', {
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererPath: join(__dirname, '../renderer/index.html'),
    logPath: getLogPath(),
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: bounds.maximized,
    bootThemeArguments
  })

  mainWindow.on('ready-to-show', () => {
    writeMainLog('info', 'browser-window', 'Window ready to show')
    mainWindow.show()
  })

  mainWindow.on('unresponsive', () => {
    writeMainLog('error', 'browser-window', 'Window became unresponsive')
  })

  mainWindow.webContents.on('did-start-loading', () => {
    writeMainLog('info', 'renderer-load', 'Renderer started loading')
  })

  mainWindow.webContents.on('dom-ready', () => {
    writeMainLog('info', 'renderer-load', 'Renderer DOM ready', {
      url: mainWindow.webContents.getURL()
    })
  })

  mainWindow.webContents.once('did-finish-load', () => {
    writeMainLog('info', 'renderer-load', 'Renderer finished loading', {
      url: mainWindow.webContents.getURL()
    })
    mainWindow.webContents.setZoomFactor(getDefaultZoomFactor(display.scaleFactor))

    setTimeout(() => {
      if (mainWindow.isDestroyed()) return

      void mainWindow.webContents
        .executeJavaScript(
          `({
            href: window.location.href,
            readyState: document.readyState,
            appChildCount: document.querySelector('#app')?.childElementCount ?? -1,
            mainChildCount: document.querySelector('main')?.childElementCount ?? -1,
            bodyTextLength: document.body?.innerText?.length ?? -1,
            bodyTextPreview: document.body?.innerText?.slice(0, 160) ?? ''
          })`,
          true
        )
        .then((snapshot) => {
          writeMainLog('info', 'renderer-snapshot', 'Renderer DOM snapshot', snapshot)
        })
        .catch((error) => {
          writeMainLog('error', 'renderer-snapshot', 'Failed to inspect renderer DOM', {
            error: formatUnknownError(error)
          })
        })
    }, 1500)
  })

  mainWindow.webContents.on('preload-error', (_, preloadPath, error) => {
    writeMainLog('error', 'preload', 'Preload script failed', {
      preloadPath,
      error: formatUnknownError(error)
    })
  })

  mainWindow.webContents.on('console-message', (details) => {
    if (details.level !== 'warning' && details.level !== 'error') return
    writeMainLog(
      details.level === 'error' ? 'error' : 'warn',
      'renderer-console',
      details.message,
      {
        lineNumber: details.lineNumber,
        sourceId: details.sourceId
      }
    )
  })

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
    writeMainLog('error', 'renderer-load', 'Renderer failed to load', {
      errorCode,
      errorDescription,
      validatedURL
    })
  })

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    writeMainLog('error', 'renderer-process', 'Renderer process gone', details)
  })

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (navigationUrl === currentUrl) return
    event.preventDefault()
    writeMainLog('warn', 'renderer-navigation', 'Blocked unexpected renderer navigation', {
      currentUrl,
      navigationUrl
    })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']).catch((error) => {
      writeMainLog('error', 'renderer-load', 'loadURL rejected', {
        error: formatUnknownError(error)
      })
    })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html')).catch((error) => {
      writeMainLog('error', 'renderer-load', 'loadFile rejected', {
        error: formatUnknownError(error)
      })
    })
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
/**
 * 启动时的保底备份（第十四轮）。
 *
 * 只在"距最近一份超过 12 小时"时才做一份，且尊重设置里的开关（`ui.autoBackup`）。
 * 刻意**不 await**（备份 3 MB 而已，不该拖慢开窗）、**不抛错**（备份失败必须只出现在日志里，
 * 不能让程序起不来）—— 但失败一定要留下痕迹，否则"以为有备份、其实没有"比没有更危险。
 */
async function maybeAutoBackup(): Promise<void> {
  try {
    const enabled = await getStoredValue('ui.autoBackup')
    if (enabled === false) return
    const info = await autoBackupIfDue()
    if (!info) return
    writeMainLog('info', 'db-backup', 'Startup auto backup created', {
      file: info.file,
      bytes: info.bytes,
      rows: info.rows
    })
  } catch (error) {
    writeMainLog('warn', 'db-backup', 'Startup auto backup failed', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * 启动期致命错误：**必须让人看见**（2026-09-30 审查 high）。
 *
 * 以前这里没有兜底：`await getDatabase()` 一旦 reject（数据目录不可写 —— 例如把程序
 * 装到 `C:\Program Files\`、磁盘满、库损坏、被杀软锁住），whenReady 回调里后面的
 * `registerHandlers()` 与建窗口都不会执行；而因为**窗口从未创建过**，
 * `window-all-closed` 永不触发 —— 表现是"双击没反应 + 任务管理器里留一个占着库锁的
 * 进程"，用户拿不到任何线索（全 main 目录连一个 showErrorBox 都没有）。
 *
 * 所以：弹一个把**数据目录路径**写清楚的框，写一条日志，然后退出。
 */
function reportFatalStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const detail = [
    `程序打不开它的数据目录：${dirname(databasePath())}`,
    '',
    message,
    '',
    '常见原因：程序所在目录不可写（例如装在 C:\\Program Files\\）、磁盘已满、或数据库文件损坏。',
    '可以先把程序换到一个可写的位置（例如 D 盘的某个文件夹）再启动。'
  ].join('\n')
  try {
    dialog.showErrorBox('汉化工坊无法启动', detail)
  } catch {
    // 连弹框都失败（极罕见）时也不能静默 —— 下面还有一条日志。
  }
  writeMainLog('error', 'startup', 'Fatal startup failure', { message, detail })
  app.exit(1)
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.qianzi-gongfang.app')
  if (process.platform === 'darwin') app.dock?.setIcon(icon)
  writeMainLog('info', 'main-process', 'Electron app ready', {
    cwd: process.cwd(),
    executablePath: process.execPath,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    logPath: getLogPath(),
    packaged: app.isPackaged,
    platform: process.platform
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    await getDatabase()
  } catch (error) {
    // 数据目录不可写 / 库损坏：弹框报路径再退出，不留"没窗口的空进程"。
    reportFatalStartupError(error)
    return
  }
  registerHandlers()
  void maybeAutoBackup()

  const bootThemeArguments = await resolveBootThemeArguments()
  // dev 才有：给 preload 的 IPC 参数护栏开关（shared/ipc-guard.ts）。
  // 与首帧主题共用同一条 argv 通道 —— 那条链路已在打包环境里验证过可用，
  // 所以护栏不必去赌沙箱化 preload 里 process.env 存不存在。
  if (is.dev) bootThemeArguments.push(IPC_GUARD_FLAG)
  createWindow(await resolveWindowBounds(), bootThemeArguments)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      void resolveWindowBounds().then((bounds) => createWindow(bounds, bootThemeArguments))
    }
  })
}).catch((error) => reportFatalStartupError(error))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  closeFontRepository()
  clearLabelPlusPreviewSessions()
  // Persistent thumbnails also serve chapters whose source folder was moved or deleted.
  void closeDatabase()
})
