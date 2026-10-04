// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '../App.vue'

/**
 * 外壳布局契约 + 布局取证（§0 第二十轮）。
 *
 * 背景：设置页滚到底时，**整个界面（连同左侧导航条）被向上顶走**，窗口底部露出一截 `--app-bg`，
 * 右侧同时出现「内容区 + 文档级」两根滚动条 —— 那是滚动链（scroll chaining）的签名。
 * 但当时**根因没能证死**：可能是渲染层视口高度与真实窗口不同步，也可能是文档真的被某处撑高了
 * （两者修法完全不同）。所以这一轮锁两件事：
 *
 *  ① **外壳契约**：不许依赖 `100vh`（`h-screen`），内容区必须 `min-h-0` —— 撑高容器的常见来源；
 *  ② **取证通道必须真的工作**：窗口尺寸变 / 文档被滚动时，把现场尺寸写进日志。
 *     没有这两条，下次再出问题手里还是只有一张截图。
 *
 * ⚠️ 写这套用例时踩到的坑（留给下一个人）：App 把 `resize` / `scroll` 监听挂在
 * `window` / `document` 上，**不 unmount 的话旧实例的监听会一直留着** ——
 * 后一个用例里一次 `dispatchEvent` 会被好几个实例同时收到，条数直接翻倍；
 * 同理，挂载时那条 300ms 的日志也会在计时器里等着，不清掉就会污染后面每一条断言。
 * 所以这里统一：每个用例 `mountShellAndSettle()`（假计时器 + 先让 mount 那条落定 + 清记录），
 * `afterEach` 里 `unmount()`。
 */
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: { template: '<div>首页内容</div>' } },
      { path: '/settings', name: 'settings', component: { template: '<div>设置内容</div>' } }
    ]
  })
}

let writeLog: ReturnType<typeof vi.fn>
let wrapper: VueWrapper | null = null

beforeEach(() => {
  writeLog = vi.fn().mockResolvedValue(undefined)
  window.comicType = {
    writeLog,
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.comicType
  vi.useFakeTimers()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

/** 挂载外壳，并让"挂载时那条取证日志"先落定、清掉记录 —— 之后只看得见本用例自己触发的那条。 */
async function mountShellAndSettle(): Promise<VueWrapper> {
  const router = makeRouter()
  await router.push('/settings')
  await router.isReady()
  wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  vi.advanceTimersByTime(400)
  await flushPromises()
  writeLog.mockClear()
  return wrapper
}

function layoutCalls(): Array<{ scope?: string; data?: Record<string, unknown> }> {
  return writeLog.mock.calls
    .map((call) => call[0] as { scope?: string; data?: Record<string, unknown> })
    .filter((entry) => entry?.scope === 'layout')
}

function lastLayoutLog(): Record<string, unknown> {
  const calls = layoutCalls()
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1].data ?? {}
}

describe('App 外壳布局契约', () => {
  it('外壳不依赖 100vh（h-full），内容区是 flex-1 + min-h-0 + overflow-auto', async () => {
    const mounted = await mountShellAndSettle()

    const shell = mounted.get('[data-testid="app-shell"]')
    // `h-screen`（100vh）在"窗口尺寸变了但视口没跟上"时会把外壳钉在旧高度上；
    // `h-full` 跟着真实盒子走（#app 是 height:100%）。
    expect(shell.classes()).toContain('h-full')
    expect(shell.classes()).not.toContain('h-screen')

    const main = mounted.get('[data-testid="app-main"]')
    // overflow-auto 的 flex 项必须允许收缩（min-h-0），否则会被内容撑高、把外壳和文档一起顶大。
    expect(main.classes()).toContain('min-h-0')
    expect(main.classes()).toContain('overflow-auto')
  })

  /**
   * 第二十二轮：内容区必须是**定位基准**（`position: relative`）。
   *
   * 为什么这条不能省：`sr-only`（Tailwind）就是 `position: absolute`，设置页里有 10 个这样的
   * 表单控件（缩略图大小 3 + 集数排序 2 + 播放间隔 3 组单选，加「静默导入新增章节」「跳过 PS 提示」两个开关）。
   * 外壳里**没有任何定位祖先**时，它们的包含块落到**初始包含块**，
   * 于是 ①不受内容区 `overflow-auto` 的裁剪、②按"在文档里的静态位置"计入**文档**的可滚动溢出。
   * 真机日志（2026-09-30 17:38，/settings，2048×1082 CSS）实测：
   *   documentScrollHeight **1551** > documentClientHeight **1082**（外壳高 1081.6 = 视口，尺寸链是好的），
   *   于是右侧多出第二根"文档级"滚动条，滚它会把整个外壳（连左侧导航）一起顶走、窗口底部露 `--app-bg`；
   *   同一尺寸下的 /import 是 1082 == 1082（干净）。
   * 给内容区 `relative` 之后，这些绝对定位后代的包含块回到内容区内部，逃逸在结构上不可能再发生。
   *
   * ⚠️ jsdom 没有排版引擎，这里锁的是**契约**（"内容区是定位基准"）；
   * "文档真的不再被撑高"由真实排版实测负责（见 §0 第二十二轮）。
   */
  it('内容区是定位基准（relative）—— sr-only 这类绝对定位后代不许逃逸到文档层', async () => {
    const mounted = await mountShellAndSettle()

    const main = mounted.get('[data-testid="app-main"]')
    expect(main.classes()).toContain('relative')
  })
})

describe('布局取证（下次出问题要有数字）', () => {
  it('窗口尺寸变化后写一条 layout 日志，含视口与各容器尺寸', async () => {
    await mountShellAndSettle()

    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(400)
    await flushPromises()

    const data = lastLayoutLog()
    expect(data.reason).toBe('resize')
    expect(data.route).toBe('/settings')
    for (const key of [
      'innerWidth',
      'innerHeight',
      'devicePixelRatio',
      'documentScrollTop',
      'documentClientHeight',
      'documentScrollHeight',
      'shellHeight',
      'navHeight',
      'mainClientHeight',
      'mainScrollHeight'
    ]) {
      expect(data).toHaveProperty(key)
    }
  })

  it('连续 resize 只记一条（防抖）', async () => {
    await mountShellAndSettle()

    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(400)
    await flushPromises()

    expect(layoutCalls().map((entry) => entry.data?.reason)).toEqual(['resize'])
  })

  it('文档被滚动（scrollTop ≠ 0）才记 —— 那本身就是病征；正常滚动不记', async () => {
    await mountShellAndSettle()

    // ① 文档没滚（scrollTop 仍是 0）：只发 scroll 事件，不该记
    document.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(400)
    await flushPromises()
    expect(layoutCalls()).toHaveLength(0)

    // ② 文档真的被滚了：必须留下证据（jsdom 没有排版，scrollTop 要显式钉住）
    Object.defineProperty(document.documentElement, 'scrollTop', {
      value: 468,
      configurable: true
    })
    document.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(400)
    await flushPromises()

    const data = lastLayoutLog()
    expect(data.reason).toBe('document-scroll')
    expect(data.documentScrollTop).toBe(468)
  })
})
