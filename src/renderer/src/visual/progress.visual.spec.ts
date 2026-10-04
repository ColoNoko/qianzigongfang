// @vitest-environment jsdom
/**
 * 「进度」页的截图检查（2026-10-03）。
 *
 * 单测能证明"数字对不对、点击有没有反应"，但证明不了这两件事 —— 所以必须看图：
 *   ① **密度**：一行七列（漫画 / 职责 / 更新至 / 上次更新 / 最近出勤 / 待烤 / 完成度）在一屏里排得下吗；
 *   ② **一眼能不能扫出欠账**：粉字（未熟）· 黄/红字（久未动）· 绿字（全熟）三种高亮
 *      在同一屏里会不会互相打架。
 *
 * 用的漫画名、职责、话数都是**真实数据**（取自用户库里的统计），不是编的样例。
 * 前置与产出口径同 panel-harness：先 `electron-vite build` 出 CSS。
 */
import { beforeEach, describe, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Progress from '@renderer/views/Progress.vue'
import { shoot } from './panel-harness'
import { PAIRED_MODE_STATS_VERSION, PAIRED_PSD_STATS_VERSION } from '@shared/status'
import type { WorkMode } from '@shared/types'

const DAY = 86_400_000
const now = Date.now()

function stats(count: number) {
  return Array.from({ length: count }, (_, index) => ({ mtimeMs: 1000 + index, ctimeMs: 1000 }))
}

function child(id: string, parentTitle: string, chapterNumber: string) {
  return {
    id,
    parentTitle,
    folderPath: `D:\\漫画\\${parentTitle}\\${chapterNumber}`,
    chapterNumber,
    projectTitle: chapterNumber,
    lastMtimeMs: 1000,
    psdStats: stats(20),
    statsVersion: PAIRED_PSD_STATS_VERSION,
    modeStatsVersion: PAIRED_MODE_STATS_VERSION
  }
}

function markStat(
  childId: string,
  counts: Partial<Record<WorkMode, number>>,
  at: number
) {
  const stamps = (count: number) => Array.from({ length: count }, (_, i) => at + i)
  return {
    childId,
    folderPath: `D:\\漫画\\${childId}`,
    fileCount: Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0),
    completedTimestamps: {
      typeset: stamps(counts.typeset ?? 0),
      translated: stamps(counts.translated ?? 0),
      proofread: stamps(counts.proofread ?? 0),
      supervised: stamps(counts.supervised ?? 0)
    }
  }
}

/** 造一本：`cookedBy` 说"前 N 话在这个职责上前 20 个文件已标完"（20 个文件 = 一话全熟）。 */
function parentWith(
  title: string,
  duties: WorkMode[],
  total: number,
  cookedBy: Partial<Record<WorkMode, number>>,
  daysAgoOfLastMark = 3,
  lastMtimeMs = 1000
) {
  const children = Array.from({ length: total }, (_, index) =>
    child(`${title}-${index + 1}`, title, String(index + 1))
  )
  const marks = children.map((item, index) => {
    const counts: Partial<Record<WorkMode, number>> = {}
    for (const [mode, cooked] of Object.entries(cookedBy)) {
      if (index < (cooked as number)) counts[mode as WorkMode] = 20
    }
    // 最近标记的那一话给小一点的 daysAgo ⇒ 列表里的"最近出勤"就是它
    return markStat(item.id, counts, now - (daysAgoOfLastMark + (total - index)) * DAY)
  })
  return { parent: { id: `p-${title}`, title, duties, lastMtimeMs, children }, marks }
}

const FIXTURES = [
  parentWith('快住手', ['proofread'], 75, { proofread: 73 }, 0, 900),
  parentWith('青梅亭亭', ['proofread', 'supervised'], 14, { proofread: 7, supervised: 3 }, 6, 800),
  parentWith('零魔力的大贤者', ['typeset', 'supervised'], 19, { typeset: 7, supervised: 7 }, 10, 700),
  parentWith('町野同学', ['typeset'], 17, { typeset: 8 }, 5, 600),
  parentWith('搬砖', ['typeset'], 10, { typeset: 7 }, 0, 500),
  parentWith('鹅妈妈', ['typeset'], 40, { typeset: 40 }, 9, 400),
  parentWith('伯爵的6岁萝莉', ['supervised'], 14, {}, 200, 300),
  parentWith('北欧美少女', ['supervised'], 6, { supervised: 6 }, 0, 200)
]

const TREE = FIXTURES.map((item) => item.parent)
const MARKS = FIXTURES.flatMap((item) => item.marks)

beforeEach(() => {
  setActivePinia(createPinia())
  ;(window as unknown as { comicType: unknown }).comicType = {
    storeGet: vi.fn(() => Promise.resolve(undefined)),
    storeSet: vi.fn(() => Promise.resolve(undefined)),
    writeLog: vi.fn(() => Promise.resolve(undefined)),
    projectGetTree: vi.fn(() => Promise.resolve(TREE)),
    memoryMarkStatistics: vi.fn(() => Promise.resolve(MARKS))
  }
})

async function mountProgress() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: { template: '<div />' } },
      { path: '/project', name: 'projectIndex', component: { template: '<div />' } },
      { path: '/progress', name: 'progress', component: Progress },
      { path: '/project/:parentTitle/:childId', name: 'project', component: { template: '<div />' } }
    ]
  })
  await router.push('/progress')
  await router.isReady()

  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Progress, { global: { plugins: [pinia, router] } })
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('visual: 进度页', () => {
  it('列表 + 时间线抽屉', async () => {
    const listWrapper = await mountProgress()
    const listHtml = listWrapper.html()
    listWrapper.unmount()

    // 抽屉**只截它自己**：遮罩是 `fixed inset-0`，塞进面板会逃出去把整屏压暗
    // （`guide.visual.spec` 当年踩过同一个坑，那边是只取弹窗卡片）。
    const drawerWrapper = await mountProgress()
    await drawerWrapper.get('[data-testid="progress-timeline-open"]').trigger('click')
    await flushPromises()
    const drawerHtml = drawerWrapper.get('[data-testid="progress-timeline-drawer"]').html()
    drawerWrapper.unmount()

    // 排序菜单展开（验证"三个控件统一 + 新排序文案"）
    const menuWrapper = await mountProgress()
    await menuWrapper.get('[data-testid="progress-sort-trigger"]').trigger('click')
    await flushPromises()
    const menuHtml = menuWrapper.html()
    menuWrapper.unmount()

    await shoot({
      name: 'progress',
      panels: [
        {
          // 宽度按真实窗口给（真机日志里默认窗口约 1215×831）—— 给窄了右三列会被裁
          label: '进度列表：一行一本（职责胶囊 · 更新至 · 上次更新 · 最近出勤 · 待烤 · 完成度）',
          html: listHtml,
          width: 1200,
          height: 'auto'
        },
        {
          label: '工具条 + 排序菜单（三个控件同高；新文案）',
          html: menuHtml,
          width: 1200,
          height: '420px'
        },
        {
          label: '时间线抽屉（点工具条「时间线」从右侧滑出）',
          html: drawerHtml,
          width: 380,
          height: '620px'
        }
      ],
      viewport: { width: 1660, height: 1180 },
      scale: 1
    })
  })
})
