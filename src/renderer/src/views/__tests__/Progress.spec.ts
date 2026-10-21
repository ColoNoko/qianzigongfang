// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Progress from '../Progress.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { PAIRED_MODE_STATS_VERSION, PAIRED_PSD_STATS_VERSION } from '@shared/status'


const DAY = 86_400_000
const now = Date.now()


function stats(count: number) {
  return Array.from({ length: count }, (_, index) => ({ mtimeMs: 1000 + index, ctimeMs: 1000 }))
}


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
  it('按全局职责筛选作品，筛选结果不改变汇总', async () => {
    const {wrapper}=await mountPage()
    expect(wrapper.findAll('[data-testid="progress-row"]')).toHaveLength(1)
    const summary=wrapper.get('[aria-label="当前职责汇总"]').text()
    await wrapper.get('input[aria-label="搜索作品或章节"]').setValue('不存在')
    expect(wrapper.findAll('[data-testid="progress-row"]')).toHaveLength(0)
    expect(wrapper.get('[aria-label="当前职责汇总"]').text()).toBe(summary)
    wrapper.unmount()
  })
  it('继续处理跳过已经完成的章节，并携带职责',async()=>{
    const {wrapper,router}=await mountPage()
    const button=wrapper.findAll('button').find(b=>b.text()==='继续处理')!
    await button.trigger('click');await flushPromises()
    expect(router.currentRoute.value.params.childId).toBe('c-e2')
    expect(router.currentRoute.value.query.workMode).toBe('typeset')
    wrapper.unmount()
  })
  it('展开章节可分别进入工作台',async()=>{
    const {wrapper,router}=await mountPage()
    await wrapper.get('button[aria-label="展开鹅妈妈"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('第1集')
    await wrapper.findAll('button').find(b=>b.text()==='查看')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.params.childId).toBe('c-e1')
    wrapper.unmount()
  })
  it('加载错误保留重试入口，不伪装为空项目',async()=>{
    const {wrapper}=await mountPageVia(()=>Promise.reject(new Error('磁盘不可用')))
    expect(wrapper.text()).toContain('磁盘不可用')
    expect(wrapper.find('[data-testid="retry-button"]').exists()).toBe(true)
    wrapper.unmount()
  })
})