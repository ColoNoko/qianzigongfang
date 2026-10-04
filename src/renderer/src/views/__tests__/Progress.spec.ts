// @vitest-environment jsdom
/**
 * 「进度」页（`views/Progress.vue`）—— 2026-10-03 新增。
 *
 * 计算口径已经在 `@shared/__tests__/progress.spec.ts` 里逐条锁过（31 条）；
 * 这里只锁**这一页独有的四件事**：
 *   ① 一行一本漫画，数字来自"项目树 + 标记记录"两处合成；
 *   ② 点职责胶囊 → 整行数据切到那个职责（多职责不合并）；
 *   ③ 点漫画名 → 跳到该漫画"最近在干的那一话"；
 *   ④ 工具条的「时间线」打开抽屉，抽屉里是摊平的完成记录。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Progress from '../Progress.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { PAIRED_MODE_STATS_VERSION, PAIRED_PSD_STATS_VERSION } from '@shared/status'

const DAY = 86_400_000
const now = Date.now()

/** 一话的 PSD 统计（分母）—— 只要长度对就行。 */
function stats(count: number) {
  return Array.from({ length: count }, (_, index) => ({ mtimeMs: 1000 + index, ctimeMs: 1000 }))
}

/** 标记记录的一条（形状 = 主进程 `ChildMarkStatistics`）。 */
function markStat(
  childId: string,
  counts: Partial<Record<'typeset' | 'translated' | 'proofread' | 'supervised', number>>,
  at = now - DAY
) {
  const stamps = (n: number) => Array.from({ length: n }, (_, i) => at + i)
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

function child(
  id: string,
  parentTitle: string,
  chapterNumber: string,
  psdCount: number,
  projectTitle = id
) {
  return {
    id,
    parentTitle,
    folderPath: `D:\\漫画\\${parentTitle}\\${chapterNumber}`,
    chapterNumber,
    projectTitle,
    lastMtimeMs: 1000,
    psdStats: stats(psdCount),
    statsVersion: PAIRED_PSD_STATS_VERSION,
    modeStatsVersion: PAIRED_MODE_STATS_VERSION
  }
}

const TREE = [
  {
    id: 'p-e', title: '鹅妈妈', duties: ['typeset'], lastMtimeMs: 300,
    children: [child('c-e1', '鹅妈妈', '1', 3), child('c-e2', '鹅妈妈', '2', 2)]
  },
  {
    id: 'p-q', title: '青梅亭亭', duties: ['proofread', 'supervised'], lastMtimeMs: 200,
    children: [
      child('c-q1', '青梅亭亭', '11', 1),
      child('c-q2', '青梅亭亭', '12', 1),
      child('c-q3', '青梅亭亭', '13', 1)
    ]
  },
  {
    // 没设职责：唯一的标记只有 1 张（不到"推断"的门槛 ≥3）⇒ 推断也给不出来
    id: 'p-n', title: '还没设职责的本', lastMtimeMs: 100,
    children: [child('c-n1', '还没设职责的本', '5', 2)]
  },
  {
    /**
     * 分母的试金石：这一话**两个模式都标过** —— 标记记录里的文件数是 2×20=40，
     * 而项目树的 PSD 数是 20。用错分母就判不出"收工"（40 > 20）。
     */
    id: 'p-two', title: '两个模式都标过', duties: ['proofread'], lastMtimeMs: 50,
    children: [child('c-t1', '两个模式都标过', '1', 20)]
  }
]

const MARKS = [
  markStat('c-e1', { typeset: 3 }, now - 5 * DAY),
  markStat('c-q1', { proofread: 1 }, now - 3 * DAY),
  markStat('c-q2', { proofread: 1 }, now - 9 * DAY),
  markStat('c-q3', { supervised: 1 }, now - 1 * DAY),
  markStat('c-n1', { typeset: 1 }, now - 2 * DAY),
  markStat('c-t1', { proofread: 20, supervised: 20 }, now - 4 * DAY)
]

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: { template: '<div />' } },
      { path: '/project', name: 'projectIndex', component: { template: '<div />' } },
      { path: '/progress', name: 'progress', component: { template: '<div />' } },
      {
        path: '/project/:parentTitle/:childId',
        name: 'project',
        component: { template: '<div />' }
      }
    ]
  })
}

async function mountPage(tree: unknown = TREE) {
  return mountPageVia(() => Promise.resolve(tree))
}

/**
 * 项目树由这一页自己去拉（`workspace.loadParents`）；这里决定那一次拉取
 * 成功还是失败 —— 失败路径要单独锁（见「项目树读不到」那条）。
 */
async function mountPageVia(loadTree: () => Promise<unknown>) {
  // 按用例给的方式重设一次 mock
  const api = window.comicType as unknown as { projectGetTree: unknown }
  api.projectGetTree = vi.fn(loadTree)

  const router = makeRouter()
  await router.push('/progress')
  await router.isReady()

  const pinia = createPinia()
  setActivePinia(pinia)
  // 真实程序里是 App 启动时读一次设置；这里照那个顺序，页面才拿得到"记住的排序"
  await useSettingsStore().loadSettings()

  const wrapper = mount(Progress, { global: { plugins: [pinia, router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  const win = window as unknown as { comicType: unknown }
  win.comicType = {
    writeLog: vi.fn().mockResolvedValue(undefined),
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined),
    projectGetTree: vi.fn().mockResolvedValue(TREE),
    memoryMarkStatistics: vi.fn().mockResolvedValue(MARKS)
  }
})

describe('Progress 页', () => {
  it('一行一本漫画：未熟话数、最新话、完成度都按"当前职责"算', async () => {
    const { wrapper } = await mountPage()
    const rows = wrapper.findAll('[data-testid="progress-row"]')
    // 四本：鹅妈妈 / 青梅亭亭 / 还没设职责的本 / 两个模式都标过
    expect(rows).toHaveLength(4)

    // 鹅妈妈：职责=嵌字，2 话里 1 话全熟（c-e1 的 3 个文件全标完），最新话 = 有标记的那一话
    const goose = rows[0]
    expect(goose.text()).toContain('鹅妈妈')
    expect(goose.get('[data-testid="progress-uncooked"]').text()).toBe('1 话')
    expect(goose.get('[data-testid="progress-latest"]').text()).toBe('第1集')
    expect(goose.text()).toContain('1/2')
  })

  it('多职责：点「监」→ 整行数据切到监修（不合并成"都完成"）', async () => {
    const { wrapper } = await mountPage()
    const qing = wrapper.findAll('[data-testid="progress-row"]')[1]

    // 默认第一个职责 = 校对：c-q1/c-q2 熟了 ⇒ 未熟 1
    expect(qing.get('[data-testid="progress-uncooked"]').text()).toBe('1 话')
    expect(qing.text()).toContain('2/3')

    await qing.get('[data-testid="progress-duty-p-q-supervised"]').trigger('click')

    // 切到监修：只有 c-q3 熟 ⇒ 未熟 2，完成度 1/3
    const after = wrapper.findAll('[data-testid="progress-row"]')[1]
    expect(after.get('[data-testid="progress-uncooked"]').text()).toBe('2 话')
    expect(after.text()).toContain('1/3')
    // 「最新话」也跟着换成监修口径下最近动手的那一话
    expect(after.get('[data-testid="progress-latest"]').text()).toBe('第13集')
  })

  it('点漫画名 → 跳到该漫画最近在干的那一话（工作台）', async () => {
    const { wrapper, router } = await mountPage()

    await wrapper.get('[data-testid="progress-title-p-e"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('project')
    // c-e1 是鹅妈妈里唯一有标记的那一话
    expect(router.currentRoute.value.params.childId).toBe('c-e1')
  })

  it('没设职责的本：显示「未设职责」占位，待烤与进展都不硬算（都是破折号）', async () => {
    const { wrapper } = await mountPage()
    const none = wrapper.findAll('[data-testid="progress-row"]')[2]

    expect(none.get('[data-testid="progress-set-duties-p-n"]').text()).toBe('未设职责')
    expect(none.get('[data-testid="progress-uncooked"]').text()).toBe('—')
    // 「更新至」= 最近收工的那一话；没设职责 ⇒ 说不出来 ⇒ 破折号（不再硬报一个集号）
    expect(none.get('[data-testid="progress-latest"]').text()).toBe('—')
    // 「上次更新」同理：没设职责就没有"多久没更新"这个答案
    expect(none.get('[data-testid="progress-last-cooked"]').text()).toBe('—')
  })

  /**
   * 2026-10-04 用户新增一列 + 两次改名（把两列天数讲清楚）：
   *   更新至（原「进展」）/ 上次更新（新列：距上次**完整做完一话**）/ 最近出勤（原「距上次」）。
   */
  it('表头：新增「上次更新」，并把「进展」→「更新至」、「距上次」→「最近出勤」', async () => {
    const { wrapper } = await mountPage()
    const table = wrapper.get('[data-testid="progress-table"]')
    const header = table.element.firstElementChild as HTMLElement
    const text = header.textContent ?? ''

    expect(text).toContain('更新至')
    expect(text).toContain('上次更新')
    expect(text).toContain('最近出勤')
    // 旧名不许再出现在表头 —— 改一半最糟：表头两套词，用户对不上号
    expect(text).not.toContain('进展')
    expect(text).not.toContain('距上次')
  })

  it('新列真的渲染：完整收工过 → 天数（两列都渲染出来）', async () => {
    const { wrapper } = await mountPage()
    const goose = wrapper.findAll('[data-testid="progress-row"]')[0]
    // 鹅妈妈唯一的标记就是那话收工的标记（夹具里在 5 天前）⇒ 两列同值
    expect(goose.get('[data-testid="progress-last-cooked"]').text()).toBe('5 天前')
    expect(goose.get('[data-testid="progress-days"]').text()).toBe('5 天前')
    // 两列都在行里（不是只改了一列的名字、另一列忘了渲染）
    expect(goose.findAll('[data-testid="progress-last-cooked"]')).toHaveLength(1)
  })

  it('两列会给出**不同的答案**：最近来标过一张，但很久没完整做完一话', async () => {
    // 造一本：c1 已收工（标记在 40 天前）；c2 只标了 1/2、时间是今天
    const tree = [
      {
        id: 'p-x',
        title: '零敲碎打的本',
        duties: ['proofread'],
        lastMtimeMs: 10,
        children: [child('c-x1', '零敲碎打的本', '1', 2), child('c-x2', '零敲碎打的本', '2', 2)]
      }
    ]
    const marks = [
      markStat('c-x1', { proofread: 2 }, now - 40 * DAY),
      markStat('c-x2', { proofread: 1 }, now - 1000)
    ]
    const api = window.comicType as unknown as { memoryMarkStatistics: unknown }
    api.memoryMarkStatistics = vi.fn().mockResolvedValue(marks)

    const { wrapper } = await mountPage(tree)
    const row = wrapper.findAll('[data-testid="progress-row"]')[0]
    expect(row.get('[data-testid="progress-last-cooked"]').text()).toBe('40 天前')
    expect(row.get('[data-testid="progress-days"]').text()).toBe('今天')
  })

  /**
   * 这一条是**变异验证逼出来的**：把「从未」改成「—」时，原有锁一条都不红
   * （没设职责那条只覆盖了 duty=null 的破折号）。补上"设了职责、但一话都没完整做完"
   * 的渲染断言 —— 它与"没设职责"是两件事，文案也必须不同：
   *   · 没设职责 → 「—」（这问题没有答案）
   *   · 设了、但从没收工 → 「从未」（有答案：一次都没完整更新过）
   */
  it('设了职责但一话都没完整做完 → 新列显示「从未」（不是破折号）', async () => {
    const tree = [
      {
        id: 'p-y',
        title: '只标了几张的本',
        duties: ['proofread'],
        lastMtimeMs: 10,
        children: [child('c-y1', '只标了几张的本', '1', 5)]
      }
    ]
    const marks = [markStat('c-y1', { proofread: 2 }, now - 3 * DAY)]
    const api = window.comicType as unknown as { memoryMarkStatistics: unknown }
    api.memoryMarkStatistics = vi.fn().mockResolvedValue(marks)

    const { wrapper } = await mountPage(tree)
    const row = wrapper.findAll('[data-testid="progress-row"]')[0]
    expect(row.get('[data-testid="progress-last-cooked"]').text()).toBe('从未')
    // 出勤那边有值（3 天前标过），两列语义分得开
    expect(row.get('[data-testid="progress-days"]').text()).toBe('3 天前')
  })

  it('工具条「时间线」打开抽屉：一条 = **某天** × 某话 × 某职责，按时间倒序', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.find('[data-testid="progress-timeline-drawer"]').exists()).toBe(false)

    await wrapper.get('[data-testid="progress-timeline-open"]').trigger('click')

    const drawer = wrapper.get('[data-testid="progress-timeline-drawer"]')
    const items = drawer.findAll('[data-testid="progress-timeline-item"]')
    // 夹具里每条标记都落在不同的天：7 条 = 6 话（其中「两个模式都标过」贡献 2 条：校对 + 监修）
    expect(items).toHaveLength(7)
    expect(items[0].text()).toContain('青梅亭亭')
    expect(items[0].text()).toContain('监修')
    expect(items[0].text()).toContain('第13集')
  })

  /**
   * 2026-10-04 用户拍板按天切分：同一话同一职责**跨天**标过 → 抽屉里是**两行**，
   * 各行的张数是各自那天做的量（旧口径会压成一行、写累计张数）。
   */
  it('时间线按天切分：同一话跨两天标过 → 两行，张数各算各天', async () => {
    const tree = [
      {
        id: 'p-z',
        title: '跨天做的本',
        duties: ['typeset'],
        lastMtimeMs: 10,
        children: [child('c-z1', '跨天做的本', '1', 5)]
      }
    ]
    const marks = [
      {
        ...markStat('c-z1', { typeset: 5 }, now - 2 * DAY),
        // 同一话、同一职责，但时间戳横跨两天：前天 3 张 + 昨天 2 张
        completedTimestamps: {
          typeset: [now - 2 * DAY, now - 2 * DAY + 1000, now - 2 * DAY + 2000, now - DAY, now - DAY + 1000],
          translated: [],
          proofread: [],
          supervised: []
        }
      }
    ]
    const api = window.comicType as unknown as { memoryMarkStatistics: unknown }
    api.memoryMarkStatistics = vi.fn().mockResolvedValue(marks)

    const { wrapper } = await mountPage(tree)
    await wrapper.get('[data-testid="progress-timeline-open"]').trigger('click')
    const items = wrapper
      .get('[data-testid="progress-timeline-drawer"]')
      .findAll('[data-testid="progress-timeline-item"]')

    expect(items).toHaveLength(2)
    // 倒序：昨天那条在前（2 张），前天那条在后（3 张）
    expect(items[0].text()).toContain('2 张')
    expect(items[0].text()).toContain('昨天')
    expect(items[1].text()).toContain('3 张')
    expect(items[1].text()).toContain('2 天前')
  })

  it('抽屉点遮罩能关（列表背后还有东西可看）', async () => {
    const { wrapper } = await mountPage()
    await wrapper.get('[data-testid="progress-timeline-open"]').trigger('click')
    await wrapper.get('[data-testid="progress-timeline-overlay"]').trigger('click')
    expect(wrapper.find('[data-testid="progress-timeline-drawer"]').exists()).toBe(false)
  })

  it('表头写「待烤」（2026-10-03 用户定的列名），且说明在表格**上方**', async () => {
    const { wrapper } = await mountPage()

    expect(wrapper.get('[data-testid="progress-table"]').text()).toContain('待烤')
    expect(wrapper.get('[data-testid="progress-table"]').text()).not.toContain('未熟')

    // 说明整块在表格之前（用户要求从表格下方搬到「进度」标题下方）
    const text = wrapper.text()
    const hintAt = text.indexOf('按当前选中的职责算')
    const tableAt = text.indexOf('漫画')
    expect(hintAt).toBeGreaterThan(-1)
    expect(tableAt).toBeGreaterThan(-1)
    expect(hintAt).toBeLessThan(tableAt)
  })

  it('右上三个控件同高同字号（下拉 / 时间线 / 刷新 —— 不许一个 32px 一个 36px）', async () => {
    const { wrapper } = await mountPage()

    const trigger = wrapper.get('[data-testid="progress-sort-trigger"]')
    expect(trigger.classes()).toContain('h-9')
    expect(trigger.classes()).toContain('text-sm')

    for (const testId of ['progress-timeline-open', 'progress-refresh']) {
      const button = wrapper.get(`[data-testid="${testId}"]`)
      expect(button.classes(), `${testId} 应与下拉同高`).toContain('h-9')
      expect(button.classes(), `${testId} 应与下拉同字号`).toContain('text-sm')
    }
  })

  it('抽屉：背景与面板**各动各的**（背景只淡入、面板只位移）', async () => {
    const { wrapper } = await mountPage()
    await wrapper.get('[data-testid="progress-timeline-open"]').trigger('click')

    const overlay = wrapper.get('[data-testid="progress-timeline-overlay"]')
    const panel = wrapper.get('[data-testid="progress-timeline-drawer"]')

    // 背景：淡入类，且**不带**面板那个位移类（带了就又变成"整块一起滑"＝那道硬边）
    expect(overlay.classes()).toContain('drawer-backdrop-in')
    expect(overlay.classes()).not.toContain('drawer-panel-in')
    // 面板：位移类
    expect(panel.classes()).toContain('drawer-panel-in')
  })

  it('「进展」= 最近**收工**的那一话（不是最近标记的那一话）', async () => {
    const { wrapper } = await mountPage()
    const qing = wrapper.findAll('[data-testid="progress-row"]')[1]

    // 校对口径下收工的是 c-q1(第11集) 与 c-q2(第12集)，其中 c-q1 更近 ⇒ 显示第11集。
    // ⚠️ 全库里**最近标记**的是 c-q3（监修，1 天前）—— 它没在校对口径下收工，不许出现在这儿。
    expect(qing.get('[data-testid="progress-latest"]').text()).toBe('第11集')

    await qing.get('[data-testid="progress-duty-p-q-supervised"]').trigger('click')
    const after = wrapper.findAll('[data-testid="progress-row"]')[1]
    expect(after.get('[data-testid="progress-latest"]').text()).toBe('第13集')
  })

  it('分母用**项目树的 PSD 数**：一话标了两个模式，也照样判得出"收工"', async () => {
    const { wrapper } = await mountPage()

    // 这一本只有 1 话、20 个文件、两个模式都标满（标记记录里 fileCount=40）。
    // 若分母错用 fileCount，20 >= 40 不成立 ⇒ 会被判成"没做"，显示 1 话待烤。
    const row = wrapper.findAll('[data-testid="progress-row"]')[3]
    expect(row.text()).toContain('两个模式都标过')
    expect(row.get('[data-testid="progress-uncooked"]').text()).toBe('✓ 全熟')
    expect(row.text()).toContain('1/1')
  })

  it('职责列用的是同一枚 duty-chip 原语：单职责 15px、双职责 30px，只有选中那段实心', async () => {
    const { wrapper } = await mountPage()
    const rows = wrapper.findAll('[data-testid="progress-row"]')

    // 青梅亭亭：声明 校+监，默认选中「校」
    const qing = rows[1].get('[data-testid="progress-duties"]')
    const pair = qing.get('.duty-chip')
    expect(pair.classes()).toContain('duty-chip--pair')
    expect(qing.get('[data-testid="progress-duty-p-q-proofread"]').classes()).toContain(
      'duty-chip__seg--on'
    )
    expect(qing.get('[data-testid="progress-duty-p-q-supervised"]').classes()).not.toContain(
      'duty-chip__seg--on'
    )

    // 鹅妈妈：单职责 ⇒ 一枚 15px 胶囊（不是"一个方块"）
    const goose = rows[0].get('[data-testid="progress-duties"]').get('.duty-chip')
    expect(goose.classes()).toContain('duty-chip--single')
  })

  it('表头是「更新至」（2026-10-04 用户定名：原名"进展"→"更新至"）', async () => {
    const { wrapper } = await mountPage()
    const table = wrapper.get('[data-testid="progress-table"]').text()
    expect(table).toContain('更新至')
    expect(table).not.toContain('最新话')
  })

  it('记住排序：换一档 → 写进设置；重进这一页仍然是那一档', async () => {
    // 用一个"真的存得住"的假存储，才能验证"重进还在"
    const memory = new Map<string, unknown>()
    const api = window.comicType as unknown as { storeGet: unknown; storeSet: unknown }
    api.storeGet = vi.fn((key: string) => Promise.resolve(memory.get(key)))
    api.storeSet = vi.fn((key: string, value: unknown) => {
      memory.set(key, value)
      return Promise.resolve()
    })

    const first = await mountPage()
    await first.wrapper.get('[data-testid="progress-sort-trigger"]').trigger('click')
    await first.wrapper.get('[data-testid="progress-sort-option-update:desc"]').trigger('click')
    await flushPromises()

    expect(memory.get('ui.progressSort')).toBe('update:desc')
    first.wrapper.unmount()

    // 重进这一页（设置会重新读一遍）—— 仍应是「上次更新↓」
    const second = await mountPage()
    expect(second.wrapper.get('[data-testid="progress-sort-trigger"]').text()).toContain('上次更新↓')

    // ⚠️ 光看下拉上的字不够（那个字直接读设置，页面就算不按它排也照样对）——
    // 必须断言**行的顺序**：上次更新↓ 时"从未完整更新过"排最前，而默认顺序的第一行是「鹅妈妈」。
    const firstRow = second.wrapper.findAll('[data-testid="progress-row"]')[0]
    expect(firstRow.text(), '重进后没有按记住的档位排').toContain('还没设职责的本')
  })

  it('页面文案里不许出现 markdown 星号（纯文本会原样渲染 —— 截图里抓到过一次）', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.text()).not.toContain('**')
  })

  it('没有项目 → 空状态（不是空白页，也不是"0 话"的假列表）', async () => {
    const { wrapper } = await mountPage([])
    expect(wrapper.find('[data-testid="progress-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="progress-row"]')).toHaveLength(0)
  })

  it('项目树读不到 → 给错误与「重试」，不许假装"还没有项目"', async () => {
    // 第一次拉取失败、重试时成功 —— 顺带锁"重试真的会再拉一次"
    let attempt = 0
    const { wrapper } = await mountPageVia(() => {
      attempt += 1
      return attempt === 1
        ? Promise.reject(new Error('ENOENT: 目录不在'))
        : Promise.resolve(TREE)
    })

    // ① 失败 ≠ 空：空状态会说"还没有项目"，那是假话，也是这次要修的毛病
    expect(wrapper.find('[data-testid="progress-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="progress-empty"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('ENOENT')
    // 不许是空白页：重试入口必须真的在
    expect(wrapper.find('[data-testid="retry-button"]').exists()).toBe(true)

    // ② 点重试 → 这一次拉到了 → 正常出表（错误块收起）
    await wrapper.get('[data-testid="retry-button"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-testid="progress-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="progress-row"]')).toHaveLength(4)
  })
})

/**
 * 抽屉动效的**唯一真相在 CSS 里**（`styles/index.css`）。
 *
 * jsdom 没有动画引擎 —— 这里锁不了"看起来丝不丝滑"，但能锁住更硬的那条：
 * **两个动画类必须真的存在**（删掉 keyframes 或者拼错类名，这条立刻红）。
 * 观感那一半靠截图工装（`visual/progress.visual.spec.ts`）与真机看。
 */
describe('抽屉动效的 CSS 契约', () => {
  it('styles/index.css 里定义了背景淡入与面板位移两个动画', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/index.css'), 'utf8')
    for (const name of ['drawer-backdrop-in', 'drawer-panel-in']) {
      expect(css, `${name} 的 keyframes 不见了`).toContain(`@keyframes ${name}`)
      expect(css, `${name} 的类没定义（或拼错）`).toContain(`.${name} {`)
    }
  })
})
