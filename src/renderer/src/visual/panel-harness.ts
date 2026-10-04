/**
 * 截图工装（visual harness）
 *
 * 把「挂真实组件 → 取 HTML → 套上真实编译出的 CSS → Edge 无头截图」收敛成一次调用，
 * 省掉每次手工拼 dump spec、手工暂存到 ASCII 路径、逐个跑 Edge 的重复劳动。
 *
 * 新增一个截图检查的步骤：
 *   1. 在 src/renderer/src/visual/ 下建 `xxx.visual.spec.ts`
 *   2. `import { shoot } from './panel-harness'`
 *   3. mount 你要看的真实组件，把每个面板的 `wrapper.html()` 交给 shoot：
 *
 *        await shoot({
 *          name: 'sidebar-modes',
 *          panels: [
 *            { label: '嵌字模式', html: a.html(), width: 330, height: '230px' },
 *            { label: '翻译模式', html: b.html(), width: 330, height: '230px' }
 *          ]
 *        })
 *
 *   4. `pnpm run visual`
 *   5. 看图：<工作区>/temp/visual/<name>/{dark,light}.png（同时会留下 index.html 可手翻）
 *
 * 前置：至少跑过一次 `electron-vite build`（需要 out/renderer/assets/index-*.css）。
 *
 * 为什么这么写：这套流程此前每次都要手工拼 5~8 次工具调用，且截图必须落在纯 ASCII
 * 路径上（Edge 命令行对中文路径不友好），所以这里自动暂存到系统临时目录再拷回工作区。
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface VisualPanel {
  /** 面板标题（会渲染成 figcaption） */
  label: string
  /** 组件渲染出的 HTML（通常是 wrapper.html()） */
  html: string
  /** 面板宽度（px） */
  width: number
  /** 面板高度（CSS 值，默认 420px） */
  height?: string
}

export interface VisualOptions {
  /** 输出目录名：<工作区>/temp/visual/<name>/ */
  name: string
  panels: VisualPanel[]
  themes?: ReadonlyArray<'dark' | 'light'>
  /** 截图窗口尺寸；不传则按面板宽度与高度推断 */
  viewport?: { width: number; height: number }
  /** 设备像素比，默认 2（更清晰） */
  scale?: number
}

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
]

function resolveBrowser() {
  const fromEnv = process.env.VISUAL_BROWSER
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const found = EDGE_CANDIDATES.find((candidate) => existsSync(candidate))
  if (found) return found
  throw new Error(
    '找不到 Edge/Chrome。请设置环境变量 VISUAL_BROWSER 指向浏览器可执行文件（例如 msedge.exe）。'
  )
}

function resolveCompiledCss(projectRoot: string): string {
  const assetsDir = join(projectRoot, 'out', 'renderer', 'assets')
  if (!existsSync(assetsDir)) {
    throw new Error(`未找到构建产物：${assetsDir} —— 请先执行 pnpm run build`)
  }
  const css = readdirSync(assetsDir).find(
    (name) => name.startsWith('index-') && name.endsWith('.css')
  )
  if (!css) throw new Error(`${assetsDir} 下没有 index-*.css —— 请先执行 pnpm run build`)
  return join(assetsDir, css)
}

function pageHtml(cssHref: string, panels: VisualPanel[]): string {
  const body = panels
    .map(
      (panel) => `<figure>
  <figcaption>${panel.label}</figcaption>
  <div class="frame" style="width:${panel.width}px;height:${panel.height ?? '420px'}">${panel.html}</div>
</figure>`
    )
    .join('\n')

  return `<!doctype html>
<html data-theme="__THEME__">
<head><meta charset="utf-8"><link rel="stylesheet" href="${cssHref}">
<style>
  body { margin: 0; padding: 16px; background: var(--app-bg); font-family: system-ui, sans-serif; }
  .row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; }
  /* 截图必须确定性：关掉所有动画/过渡，否则带入场淡入的页面（.page-in）
     可能被拍到 opacity < 1 的中间帧。 */
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
  figure { margin: 0; }
  figcaption { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
  .frame { overflow: hidden; background: var(--card-bg); border: 1px solid var(--border); }
</style></head>
<body><div class="row">${body}</div></body></html>`
}

/** 渲染面板、跑无头浏览器截图，返回 PNG 路径（工作区内）。 */
export async function shoot(options: VisualOptions): Promise<string[]> {
  const projectRoot = process.cwd()
  const workspaceRoot = resolve(projectRoot, '..')
  const themes = options.themes ?? (['dark', 'light'] as const)
  const scale = options.scale ?? 2

  const compiledCss = resolveCompiledCss(projectRoot)
  const outDir = join(workspaceRoot, 'temp', 'visual', options.name)
  // 截图必须走纯 ASCII 路径：Edge 命令行对中文路径不可靠。
  const staging = join(tmpdir(), `qz-visual-${options.name}`)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(staging, { recursive: true })
  copyFileSync(compiledCss, join(staging, 'app.css'))

  const viewport =
    options.viewport ??
    {
      width: 32 + options.panels.reduce((sum, panel) => sum + panel.width + 16, 0),
      height:
        96 +
        Math.max(
          ...options.panels.map((panel) => Number.parseInt(panel.height ?? '420', 10) || 420)
        )
    }

  const browser = resolveBrowser()
  const produced: string[] = []

  for (const theme of themes) {
    writeFileSync(
      join(staging, `${theme}.html`),
      pageHtml('./app.css', options.panels).replace('__THEME__', theme),
      'utf8'
    )
    // 工作区里留一份可直接用浏览器打开的副本（CSS 指向构建产物）。
    writeFileSync(
      join(outDir, `${theme}.html`),
      pageHtml(pathToFileURL(compiledCss).href, options.panels).replace('__THEME__', theme),
      'utf8'
    )

    const stagedPng = join(staging, `${theme}.png`)
    const result = spawnSync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        `--force-device-scale-factor=${scale}`,
        `--window-size=${viewport.width},${viewport.height}`,
        `--screenshot=${stagedPng}`,
        pathToFileURL(join(staging, `${theme}.html`)).href
      ],
      { stdio: 'ignore', timeout: 120000 }
    )

    if (!existsSync(stagedPng)) {
      throw new Error(`截图失败（${theme}）：浏览器退出码 ${result.status}，未生成 ${stagedPng}`)
    }
    const finalPng = join(outDir, `${theme}.png`)
    copyFileSync(stagedPng, finalPng)
    produced.push(finalPng)
  }

  console.log(`\n截图已生成（${options.panels.length} 个面板 × ${themes.length} 主题）：`)
  for (const file of produced) console.log(`  ${file}`)
  console.log(`  可手翻的 HTML：${join(outDir, 'dark.html')}\n`)

  return produced
}
