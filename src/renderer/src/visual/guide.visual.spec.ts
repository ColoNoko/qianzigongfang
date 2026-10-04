// @vitest-environment jsdom
/**
 * 截图检查：新手引导（`features/guide/GuideDialog.vue`）与左侧栏底部那对按钮。
 *
 * ⚠️ 为什么截的是**卡片**而不是整个弹窗：弹窗根节点是 `fixed inset-0`（模态遮罩），
 * 直接塞进截图页会铺满整张图、面板互相盖住。所以只取
 * `[data-testid="guide-card"]` 的 HTML —— 也就是用户真正在看的那个盒子。
 *
 * 2026-10-03 向导化：面板变成 **入口页 + 基础 5 页 + 进阶 4 页 + 第 1 页翻页态 + 导航条**。
 * 入口页**只在"重看"时出现**（首次是直接进 01）⇒ 这里按重看口径挂载（`startWithEntry`）。
 *
 * 另一张截的是**真实的左侧导航条**（`App.vue` 里的 `<nav>`），用来看「指引」和
 * 「夜间」挨在一起时，图标 / 文案 / 高矮是否一致（需求二"不要突兀"）。
 */
import { describe, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '@renderer/App.vue'
import GuideDialog from '@renderer/features/guide/GuideDialog.vue'
import {
  GUIDE_ADVANCED_PAGES,
  GUIDE_BASIC_PAGES,
  GUIDE_NAV_SECTIONS,
  guideTitleWithNo
} from '@renderer/features/guide/guide-pages'
import { shoot } from './panel-harness'

/** 入口页（**只在重看时**出现；首次是直接进 01）。 */
async function renderEntryCard(): Promise<string> {
  const wrapper = mount(GuideDialog, {
    props: { open: true, startWithEntry: true },
    attachTo: document.body
  })
  const html = wrapper.get('[data-testid="guide-card"]').html()
  wrapper.unmount()
  return html
}

/** 进某一栏、翻到第 step 页，返回卡片本体的 HTML。 */
async function renderLaneCard(lane: 'basics' | 'advanced', step: number): Promise<string> {
  const wrapper = mount(GuideDialog, {
    props: { open: true, startWithEntry: true },
    attachTo: document.body
  })
  await wrapper.get(`[data-testid="guide-lane-${lane}"]`).trigger('click')
  for (let index = 0; index < step; index += 1) {
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
  }
  const html = wrapper.get('[data-testid="guide-card"]').html()
  wrapper.unmount()
  return html
}

/** 第 1 页翻到第 n 条时的样子（看"大图固定 + 右线框跟着换 + 文案左右翻"）。 */
async function renderSlideCard(slide: number): Promise<string> {
  const wrapper = mount(GuideDialog, { props: { open: true }, attachTo: document.body })
  for (let index = 0; index < slide; index += 1) {
    await wrapper.get('[data-testid="guide-slide-next"]').trigger('click')
  }
  const html = wrapper.get('[data-testid="guide-card"]').html()
  wrapper.unmount()
  return html
}

/** 左侧导航条本体（含新增的「指引」）。 */
async function renderNavRail(): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'dashboard', component: { template: '<div />' } }]
  })
  await router.push('/')
  await router.isReady()

  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(App, { global: { plugins: [pinia, router] } })
  const html = wrapper.get('nav').html()
  wrapper.unmount()
  return html
}

describe('visual: 新手引导', () => {
  it('renders the entry page, both lanes, and the nav rail', async () => {
    const basics = await Promise.all(
      GUIDE_BASIC_PAGES.map((_, index) => renderLaneCard('basics', index))
    )
    const advanced = await Promise.all(
      GUIDE_ADVANCED_PAGES.map((_, index) => renderLaneCard('advanced', index))
    )

    await shoot({
      name: 'guide',
      panels: [
        { label: '入口页（重看时停在这里）', html: await renderEntryCard(), width: 640, height: 'auto' },
        {
          label: `第 1 页翻到「${GUIDE_NAV_SECTIONS[1].label}」（右线框跟着换）`,
          html: await renderSlideCard(1),
          width: 640,
          height: 'auto'
        },
        {
          label: `第 1 页翻到「${GUIDE_NAV_SECTIONS[2].label}」`,
          html: await renderSlideCard(2),
          width: 640,
          height: 'auto'
        },
        ...basics.map((html, index) => ({
          label: `基础 ${index + 1}/${GUIDE_BASIC_PAGES.length} · ${guideTitleWithNo(GUIDE_BASIC_PAGES[index])}`,
          html,
          width: 640,
          // auto：每页现在是"一块文字跟一张图例"，第 2 页有 7 张图例，固定高度会把它裁掉
          height: 'auto'
        })),
        ...advanced.map((html, index) => ({
          label: `进阶 ${index + 1}/${GUIDE_ADVANCED_PAGES.length} · ${guideTitleWithNo(GUIDE_ADVANCED_PAGES[index])}`,
          html,
          width: 640,
          height: 'auto'
        })),
        { label: '左侧栏底部：指引 + 夜间', html: await renderNavRail(), width: 64, height: '530px' }
      ],
      // 显式给视口：10 个面板按两列换行（不然会排成一条细长图）；
      // 高度按最高那一列留足（上手第 2 页图例最多）。
      viewport: { width: 1350, height: 7600 },
      scale: 1
    })
  })
})
