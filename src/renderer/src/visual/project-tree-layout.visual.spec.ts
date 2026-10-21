// @vitest-environment jsdom
/**
 * Real component fixture for the list/sidebar layout. Compare the progress and
 * menu tracks across short and long Chinese titles at each width. Assigned
 * duties must retain the same four role colors in both themes and work modes.
 * Run after building: VISUAL_BROWSER=<Chrome/Edge path> pnpm visual project-tree-layout
 */
import { describe, expect, it } from 'vitest'
import { config, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProjectSidebar from '@renderer/components/ProjectSidebar.vue'
import type { ParentProject, WorkMode } from '@shared/types'
import { shoot } from './panel-harness'

config.global.stubs.teleport = true

const longTitle = '在星海尽头等待那封迟来的信以及从未说出口的漫长告别与再会之约'
const pending = (count: number) => Array.from({ length: count }, () => ({ mtimeMs: 0, ctimeMs: 0 }))
const done = (count: number) => Array.from({ length: count }, () => ({ mtimeMs: 600_001, ctimeMs: 0 }))

function makeParents(): ParentProject[] {
  const chapter = (id: string, title: string, n: number): ParentProject['children'][number] => ({
    id,
    parentTitle: longTitle,
    folderPath: `D:\\漫画\\示例\\${n}`,
    chapterNumber: String(n),
    projectTitle: title,
    lastMtimeMs: 0,
    psdStats: [...done(n === 1 ? 8 : 128), ...pending(n === 1 ? 120 : 0)],
    psdModeStats: { typeset: [], translated: done(n === 1 ? 2 : 120), proofread: [], supervised: [] }
  })
  return [
    {
      id: 'long', title: longTitle, duties: ['typeset', 'translated'], lastMtimeMs: 0,
      children: [
        chapter('short-chapter', '海风', 1),
        chapter('long-chapter', `${longTitle}，穿过月光下的旧车站去寻找昨日寄出的另一封信`, 2)
      ]
    },
    { id: 'other', title: '星海来信', duties: ['proofread', 'supervised'], lastMtimeMs: 0, children: [] },
    { id: 'empty', title: '尚未设置职责的作品', duties: [], lastMtimeMs: 0, children: [] }
  ]
}

async function render(mode: WorkMode, listPage = false, multiSelect = false): Promise<string> {
  setActivePinia(createPinia())
  const parents = makeParents()
  const wrapper = mount(ProjectSidebar, {
    props: {
      parents, loading: false, listPage, stickyParentHeader: !listPage, mode,
      activeChildId: 'short-chapter',
      parentDuties: Object.fromEntries(parents.map(parent => [parent.id, parent.duties ?? []]))
    },
    attachTo: document.body
  })
  try {
    await wrapper.findAll('button[aria-label="展开子项目"]')[0].trigger('click')
    if (multiSelect) {
      await wrapper.get('[data-testid="multi-select-button"]').trigger('click')
      await wrapper.get('[data-child-id="long-chapter"]').trigger('click')
    }
    // Verify the screenshot actually includes both samples, not a collapsed tree.
    expect(wrapper.findAll('[data-child-id]')).toHaveLength(2)
    expect(wrapper.get('[data-child-id="long-chapter"] .chapter-main').attributes('aria-label')).toContain(longTitle)
    return wrapper.html()
  } finally {
    wrapper.unmount()
  }
}

describe('visual: project title and fixed progress columns', () => {
  it('renders short/long Chinese titles, all duty colors, and narrow management mode', async () => {
    await shoot({
      name: 'project-tree-layout',
      panels: [
        { label: '项目列表 · 长短标题 / 固定进度列', html: await render('typeset', true), width: 820, height: '440px' },
        { label: '侧栏 330px · 翻译模式 / 职责颜色不变', html: await render('translated'), width: 330, height: '440px' },
        { label: '窄侧栏 220px', html: await render('typeset'), width: 220, height: '440px' },
        { label: '窄侧栏 220px · 批量管理', html: await render('typeset', false, true), width: 220, height: '480px' }
      ]
    })
  })
})
