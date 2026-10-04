// @vitest-environment jsdom
/**
 * 截图检查：「项目」页默认必须是**收起的树**。
 *
 * 这个页面以前是无条件把每个父级的所有章节都铺开（第一次进到时读起来就像
 * "全都展开了"），所以它值得一张图盯着 —— 回退方式很隐蔽：只要有人把
 * ProjectTree 换回 v-for 平铺列表，这里立刻会变成一面墙。
 */
import { describe, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { shoot } from './panel-harness'
import type { ParentProject } from '@shared/types'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() })
}))

import ProjectIndex from '@renderer/views/ProjectIndex.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'

function child(
  parent: string,
  id: string,
  chapterNumber: string,
  projectTitle: string,
  total: number
): ParentProject['children'][number] {
  return {
    id,
    parentTitle: parent,
    folderPath: `D:\\漫画\\${parent}\\${chapterNumber}`,
    chapterNumber,
    projectTitle,
    lastMtimeMs: 0,
    psdStats: Array.from({ length: total }, () => ({ mtimeMs: 0, ctimeMs: 0 }))
  }
}

function makeParents(): ParentProject[] {
  return [
    {
      id: 'p1',
      title: '町野さん',
      lastMtimeMs: 3000,
      children: [
        child('町野さん', 'c1', '第20話', '第20话', 24),
        child('町野さん', 'c2', '第19話', '第19话', 22)
      ]
    },
    { id: 'p2', title: '青梅亭亭', lastMtimeMs: 2000, children: [] },
    {
      id: 'p3',
      title: '北欧美少女',
      lastMtimeMs: 1000,
      children: [child('北欧美少女', 'c3', '第3話', '第3话', 18)]
    }
  ]
}

/** Fresh pinia + seeded projects, so no IPC is touched on mount. */
function seed(): ReturnType<typeof mount> {
  setActivePinia(createPinia())
  window.comicType = {
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.comicType
  useProjectWorkspace().parents = makeParents()
  return mount(ProjectIndex, { attachTo: document.body })
}

describe('visual: 项目页默认收起', () => {
  it('renders the collapsed tree and one opened project', async () => {
    const collapsed = seed()
    const collapsedHtml = collapsed.html()
    collapsed.unmount()

    const expanded = seed()
    const tree = expanded.get('[data-testid="project-index-tree"]')
    await tree.findAll('.font-bold')[0].trigger('click')
    const expandedHtml = expanded.html()
    expanded.unmount()

    await shoot({
      name: 'project-index',
      panels: [
        { label: '默认：全部收起', html: collapsedHtml, width: 720, height: '220px' },
        { label: '点开「町野さん」', html: expandedHtml, width: 720, height: '320px' }
      ]
    })
  })
})
