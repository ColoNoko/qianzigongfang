// @vitest-environment jsdom
/**
 * 截图检查：工作台侧栏的父级行吸顶（`docs/侧栏父级吸顶-优化方案.md` §6.2）。
 *
 * **为什么非要"滚过第一个父级"**：截图是静态的，"吸顶生效"和"根本没滚动"长得
 * 一模一样。只有滚进子项目深处之后，"首行是父级标题"与"首行是第 N 集"才分得开。
 *
 * 面板成对出现，看图判据：
 *   ① 吸顶（真实组件）→ 首行必须是**父级标题**那一行（箭头 + 粗体 + 右侧刷新图标）
 *   ② 对照（同一份 HTML 摘掉 `sticky top-0 z-10` = 改之前的样子）
 *                     → 首行必须是**子项目行**
 * 两张图必须长得不一样，否则这条检查就是 §10.5 说的那种静默失效。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProjectSidebar from '@renderer/components/ProjectSidebar.vue'
import { shoot } from './panel-harness'
import type { ParentProject } from '@shared/types'

const pending = (n: number) => Array.from({ length: n }, () => ({ mtimeMs: 0, ctimeMs: 0 }))
const done = (n: number) => Array.from({ length: n }, () => ({ mtimeMs: 600_000, ctimeMs: 0 }))

/** 每行进度都不同（n/30）—— 看图时一眼能说出"现在露出来的是第几话"。 */
const statsFor = (n: number) => [...done(n), ...pending(30 - n)]

/** 一话够多的项目：滚 600px 之后父级行会完全离开视口（探针实测 −559px）。 */
function makeLongParents(): ParentProject[] {
  const longParent: ParentProject = {
    id: 'pB',
    title: '直到你的愿望实现为止',
    lastMtimeMs: 0,
    children: Array.from({ length: 30 }, (_, index) => {
      const n = index + 1
      return {
        id: `c${n}`,
        parentTitle: '直到你的愿望实现为止',
        folderPath: `D:\\漫画\\愿望\\第${n}集`,
        chapterNumber: `第${n}集`,
        projectTitle: '直到你的愿望实现为止',
        lastMtimeMs: 0,
        psdStats: statsFor(n)
      }
    })
  }

  return [
    { id: 'pA', title: '2号的我', lastMtimeMs: 0, children: [] },
    longParent,
    { id: 'pC', title: '北欧美少女', lastMtimeMs: 0, children: [] }
  ]
}

const PARENT_COUNT = 3

/** 与 `ProjectTree.parentRowClasses()` 里那一段完全一致；对照面板要把它摘掉。 */
const STICKY_CLASSES = 'sticky top-0 z-10'

/**
 * 追加在面板 HTML 末尾的脚本：`load` 时把页面里**所有**树的滚动口滚到 600px，
 * 之后截图工装才拍照。用 `querySelectorAll` 是因为同一张图里放着两个面板。
 * （这条路已经先用探针在真机 Edge 上验证过。）
 */
const scrollScript = `<script>
window.addEventListener('load', function () {
  document.querySelectorAll('[data-testid="tree-scroll"]').forEach(function (el) {
    el.scrollTop = 600
  })
})
</script>`

async function renderScrolledTree(): Promise<string> {
  setActivePinia(createPinia())
  const wrapper = mount(ProjectSidebar, {
    props: { parents: makeLongParents(), loading: false, activeChildId: 'c15' },
    attachTo: document.body
  })
  // 树默认全收起（§4.4），要截到子行必须自己点开父项目 —— 这里点第二个（话数多的那个）。
  await wrapper.findAll('.font-bold')[1].trigger('click')
  const html = wrapper.html()
  wrapper.unmount()
  return html + scrollScript
}

describe('visual: 侧栏父级吸顶', () => {
  it('renders the pinned parent row next to a non-sticky control', async () => {
    const sticky = await renderScrolledTree()
    const control = sticky.split(STICKY_CLASSES).join('')

    // 对照面板必须**真的**少掉了那几个类：否则两个面板长得一样，
    // 这条检查会退化成"看着绿、其实什么都没锁"（§10.5）。
    expect(sticky.split(STICKY_CLASSES)).toHaveLength(PARENT_COUNT + 1)
    expect(control).not.toBe(sticky)

    await shoot({
      name: 'sidebar-sticky',
      panels: [
        { label: '吸顶：首行应是父级标题', html: sticky, width: 330, height: '260px' },
        { label: '对照（改之前）：首行应是子项目行', html: control, width: 330, height: '260px' }
      ]
    })
  })
})
