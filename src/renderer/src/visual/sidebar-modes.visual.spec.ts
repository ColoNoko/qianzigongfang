// @vitest-environment jsdom
/**
 * 示例截图检查：侧栏每一行的进度是否随工作模式联动。
 *
 * 它同时是工装的自测 —— 改动侧栏/取数逻辑后跑 `pnpm run visual`，
 * 直接看图确认三个模式的文案与数字是否都正确。
 * 新增面板照这个文件的形状写即可（见 ./panel-harness.ts 顶部说明）。
 */
import { describe, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProjectSidebar from '@renderer/components/ProjectSidebar.vue'
import { shoot } from './panel-harness'
import type { ParentProject, WorkMode } from '@shared/types'

const pending = (n: number) => Array.from({ length: n }, () => ({ mtimeMs: 0, ctimeMs: 0 }))
const done = (n: number) => Array.from({ length: n }, () => ({ mtimeMs: 600_000, ctimeMs: 0 }))

function makeParents(): ParentProject[] {
  const child = (
    id: string,
    chapterNumber: string,
    projectTitle: string,
    total: number,
    modes: Partial<Record<WorkMode, number>>
  ): ParentProject['children'][number] => ({
    id,
    parentTitle: '青梅亭亭',
    folderPath: `D:\\漫画\\青梅亭亭\\${chapterNumber}`,
    chapterNumber,
    projectTitle,
    lastMtimeMs: 0,
    psdStats: chapterNumber === '第1集' ? [...done(1), ...pending(total - 1)] : pending(total),
    psdModeStats: {
      typeset: [],
      translated: done(modes.translated ?? 0),
      proofread: done(modes.proofread ?? 0),
      supervised: done(modes.supervised ?? 0)
    }
  })

  return [
    {
      id: 'p1',
      title: '青梅亭亭',
      // 职责（2026-10-03）：截图里要能看出"单字胶囊 + 名字对齐"这件事
      duties: ['proofread', 'supervised'],
      lastMtimeMs: 0,
      children: [
        child('c1', '第13集', '第13话 图源：NAGI', 19, { translated: 2 }),
        child('c2', '第12集', '第12话 图源：NAGI', 21, { supervised: 1 }),
        child('c3', '第1集', '第1话', 28, {})
      ]
    },
    { id: 'p2', title: '北欧美少女', duties: ['translated'], lastMtimeMs: 0, children: [] }
  ]
}

async function renderSidebar(
  mode: WorkMode,
  expandFirst = true,
  multiSelect = false,
  dutyMenu = false
): Promise<string> {
  setActivePinia(createPinia())
  const parents = makeParents()
  const wrapper = mount(ProjectSidebar, {
    props: {
      parents,
      loading: false,
      activeChildId: 'c1',
      mode,
      // 职责表由宿主算好（侧栏只画）—— 与真实宿主 Project.vue / ProjectIndex 同一形状
      parentDuties: Object.fromEntries(
        parents.map((parent) => [parent.id, parent.duties ?? []])
      )
    },
    attachTo: document.body
  })
  // The tree starts fully collapsed (it no longer auto-expands the active
  // child's parent), so this check has to open a project itself — otherwise the
  // screenshots would show parent rows only and silently stop covering the
  // per-row mode text these panels exist for.
  if (expandFirst) {
    await wrapper.findAll('.font-bold')[0].trigger('click')
  }
  if (multiSelect) {
    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')
  }
  if (dutyMenu) {
    // 展开职责菜单：它必须压在下面的子行之上（现场：以前被后面的行盖住）
    await wrapper.findAll('[data-testid="parent-duty-pill"]')[0].trigger('click')
  }
  const html = wrapper.html()
  wrapper.unmount()
  return html
}

describe('visual: 侧栏模式联动', () => {
  it('renders one panel per mode', async () => {
    const panels = [
      { label: '嵌字模式', html: await renderSidebar('typeset'), width: 330, height: '230px' },
      { label: '翻译模式', html: await renderSidebar('translated'), width: 330, height: '230px' },
      { label: '监修模式', html: await renderSidebar('supervised'), width: 330, height: '230px' },
      // Opening state: every project collapsed, nothing auto-expanded.
      { label: '默认收起', html: await renderSidebar('typeset', false), width: 330, height: '230px' },
      // 多选模式：「取消」应当顶到右端，与正常模式的「管理」同一个角落。
      { label: '多选模式', html: await renderSidebar('typeset', true, true), width: 330, height: '230px' },
      // 职责菜单展开：既看夜间对比度，也看它有没有被下面的子行盖住
      { label: '职责菜单', html: await renderSidebar('typeset', true, false, true), width: 330, height: '300px' }
    ]

    await shoot({ name: 'sidebar-modes', panels })
  })
})
