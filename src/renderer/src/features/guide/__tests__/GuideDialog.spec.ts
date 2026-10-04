// @vitest-environment jsdom
/**
 * 新手引导弹窗（`features/guide/GuideDialog.vue`）。
 *
 * 它只对外暴露两个口子：`open`（显示/隐藏）与 `@close`（用户关掉了）。
 * **它不碰存储** —— "有没有看过"由 App.vue 交给 settings 存（见 App-navigation.spec）。
 * 所以这里只测"壳"：翻页、边界、各种关闭方式、重开回到第 1 页。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GuideDialog from '../GuideDialog.vue'
import {
  GUIDE_ADVANCED_PAGES,
  GUIDE_BASIC_PAGES,
  GUIDE_ENTRY,
  GUIDE_HINT_LABEL,
  GUIDE_LANES,
  GUIDE_PAGES,
  GUIDE_VERSION,
  GUIDE_NAV_SECTIONS,
  GUIDE_TOOL_FIELDS,
  guideTitleWithNo
} from '../guide-pages'

function mountDialog(open = true, startWithEntry = false) {
  return mount(GuideDialog, { props: { open, startWithEntry }, attachTo: document.body })
}

/**
 * 打开并**进入某一栏**（分层之后，页相关的断言都得先选一栏）。
 * 入口页本身的行为在文件末尾那组「GuideDialog 分层」里锁。
 */
async function mountInLane(lane: 'basics' | 'advanced' = 'basics') {
  // 入口页**只在"重看"时出现** ⇒ 这里按重看口径挂载，再从入口页进栏。
  const wrapper = mountDialog(true, true)
  await wrapper.get(`[data-testid="guide-lane-${lane}"]`).trigger('click')
  return wrapper
}

/** 读页脚 `N / 9` 里的 N（全局连续编号）。 */
function currentStep(wrapper: ReturnType<typeof mountDialog>): number {
  const text = wrapper.get('[data-testid="guide-step"]').text()
  return Number(text.match(/(\d+)\s*\//)?.[1] ?? 0)
}

describe('GuideDialog', () => {
  it('open=false 时什么都不渲染', () => {
    const wrapper = mountDialog(false)
    expect(wrapper.find('[data-testid="guide-overlay"]').exists()).toBe(false)
    // 只剩 Vue 的 v-if 占位注释，没有任何可见内容
    expect(wrapper.text()).toBe('')
  })

  it('进上手栏后停在第 1 页，且「上一步」是禁用的', async () => {
    const wrapper = await mountInLane()
    expect(wrapper.find('[data-testid="guide-overlay"]').exists()).toBe(true)
    expect(currentStep(wrapper)).toBe(1)
    expect(wrapper.get('[data-testid="guide-prev"]').attributes('disabled')).toBeDefined()
    // 第 1 页讲的是左侧导航
    expect(wrapper.get('[data-testid="guide-art"]').attributes('data-art')).toBe('nav')
  })

  it('页数、标题、要点都来自 guide-pages（组件不手抄文案，且按**栏**算）', async () => {
    const wrapper = await mountInLane()
    // 标题 = **两位编号 + 页标题**（编号由平铺顺序推出来，不写在数据里）
    expect(wrapper.get('[data-testid="guide-title"]').text()).toBe(
      guideTitleWithNo(GUIDE_BASIC_PAGES[0])
    )
    // 圆点是**全局**的（连续编号 ⇒ 9 个，两栏之间留一道缝）
    expect(wrapper.get('[data-testid="guide-dots"]').findAll('span')).toHaveLength(
      GUIDE_PAGES.length
    )
    expect(wrapper.get('[data-testid="guide-step"]').text()).toBe(`1 / ${GUIDE_PAGES.length}`)
  })

  it('一页页翻到头：主按钮变「完成」，点它发出 close；中途不会越界', async () => {
    const wrapper = await mountInLane()
    const next = wrapper.get('[data-testid="guide-next"]')

    for (let step = 1; step < GUIDE_BASIC_PAGES.length; step += 1) {
      expect(wrapper.get('[data-testid="guide-next"]').text()).toBe('下一步')
      await next.trigger('click')
      expect(currentStep(wrapper)).toBe(step + 1)
    }

    // 基础栏最后一页：主按钮是「继续看进阶」，**不直接结束**（用户 2026-10-03 定的向导规矩）
    const fork = wrapper.get('[data-testid="guide-next"]')
    expect(fork.text()).toBe('继续看进阶')
    expect(wrapper.get('[data-testid="guide-skip"]').text()).toBe('就到这里')
    await fork.trigger('click')
    expect(wrapper.emitted('close')).toBeFalsy()
    expect(currentStep(wrapper)).toBe(GUIDE_BASIC_PAGES.length + 1)

    // 进阶栏翻到头才是「完成」→ 关窗
    for (let i = 1; i < GUIDE_ADVANCED_PAGES.length; i += 1) {
      await wrapper.get('[data-testid="guide-next"]').trigger('click')
    }
    expect(wrapper.get('[data-testid="guide-next"]').text()).toBe('完成')
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(currentStep(wrapper)).toBe(GUIDE_PAGES.length)
  })

  it('「上一步」能回退，回到第 1 页后重新禁用', async () => {
    const wrapper = await mountInLane()
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    expect(currentStep(wrapper)).toBe(3)

    await wrapper.get('[data-testid="guide-prev"]').trigger('click')
    expect(currentStep(wrapper)).toBe(2)
    await wrapper.get('[data-testid="guide-prev"]').trigger('click')
    expect(currentStep(wrapper)).toBe(1)
    expect(wrapper.get('[data-testid="guide-prev"]').attributes('disabled')).toBeDefined()
  })

  it('「跳过」直接发出 close（跳过也算看过了 —— 否则每次启动都来烦人）', async () => {
    const wrapper = mountDialog(true, true)
    await wrapper.get('[data-testid="guide-skip"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('Esc 与点遮罩空白处都能关；点卡片内部不关', async () => {
    const wrapper = mountDialog(true, true)

    await wrapper.get('[data-testid="guide-card"]').trigger('click')
    expect(wrapper.emitted('close')).toBeFalsy()

    await wrapper.get('[data-testid="guide-overlay"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('关闭后不再监听键盘（Esc 不该继续发 close）', async () => {
    const wrapper = mountDialog(true, true)
    await wrapper.setProps({ open: false })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('方向键翻页：→ 下一页，← 上一页，且第 1 页不会再往回退', async () => {
    const wrapper = await mountInLane()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await wrapper.vm.$nextTick()
    expect(currentStep(wrapper)).toBe(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await wrapper.vm.$nextTick()
    expect(currentStep(wrapper)).toBe(2)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await wrapper.vm.$nextTick()
    expect(currentStep(wrapper)).toBe(1)
  })

  it('最后一页按 → 键不会翻到"第 6 / 5 页"，也不会把弹窗关掉', async () => {
    const wrapper = await mountInLane()
    for (let step = 1; step < GUIDE_BASIC_PAGES.length; step += 1) {
      await wrapper.get('[data-testid="guide-next"]').trigger('click')
    }

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await wrapper.vm.$nextTick()

    expect(currentStep(wrapper)).toBe(GUIDE_BASIC_PAGES.length)
    expect(wrapper.get('[data-testid="guide-step"]').text()).toBe(
      `${GUIDE_BASIC_PAGES.length} / ${GUIDE_PAGES.length}`
    )
    // 方向键只翻页；关窗只能靠「完成」/「跳过」/✕/遮罩/Esc
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('重新打开会回到入口页（从「指引」按钮再进来时不能停在上次那一页）', async () => {
    const wrapper = await mountInLane()
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    expect(currentStep(wrapper)).toBe(3)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(wrapper.find('[data-testid="guide-entry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="guide-step"]').exists()).toBe(false)
  })

  /**
   * 文字分三层（用户 2026-09-27 选的 A 方案）：
   *   ① `guide-block-label` 结论/标签（浅底盒 + 主色字）
   *   ② `guide-block-text`  解说（正文色，**必填**）
   *   ③ `guide-block-note`  例子/补充（三级灰，可空）
   * 顺序必须是 ①→②→③，而且**图例要在整块正文之后**。
   *
   * ⚠️ 局限：jsdom 没有排版引擎，所以这里锁的是 **DOM 顺序**（不是"看起来在下面"）；
   * 真要看观感靠 `visual/guide.visual.spec.ts` 那组图。反序布局能骗过这条 ——
   * 那种写法没人会写，但把边界写出来比假装全覆盖强。
   */
  it('每块文字按「结论 → 解说 → 补充」三层渲染，图例在整块之后', async () => {
    const rank: Record<string, number> = {
      'guide-block-label': 0,
      'guide-block-text': 1,
      'guide-block-note': 2
    }
    const wrapper = await mountInLane()

    for (let step = 0; step < GUIDE_BASIC_PAGES.length; step += 1) {
      const blocks = wrapper.findAll('[data-testid="guide-block"]')
      // 第 1 页是"一屏一条" ⇒ 一次只渲染"导语 + 当前那一条"
      expect(blocks.length).toBe(
        GUIDE_BASIC_PAGES[step].slides ? 2 : GUIDE_BASIC_PAGES[step].blocks.length
      )

      for (const block of blocks) {
        const children = Array.from(block.element.children)
        const bodyIndex = children.findIndex(
          (el) => el.getAttribute('data-testid') === 'guide-block-body'
        )
        const artIndexes = children
          .map((el, index) => (el.getAttribute('data-testid') === 'guide-art' ? index : -1))
          .filter((index) => index >= 0)

        // 正文在最前；图例一律在整块正文之后（不是跑到页尾、也不是压在文字上）
        expect(bodyIndex).toBe(0)
        for (const artIndex of artIndexes) expect(artIndex).toBeGreaterThan(bodyIndex)

        const levels = Array.from(
          children[bodyIndex].querySelectorAll('[data-testid^="guide-block-"]')
        ).map((el) => el.getAttribute('data-testid') ?? '')
        // 层级单调递增 = 顺序正确；出现未知层级会算出 NaN 直接红
        const ranks = levels.map((id) => rank[id])
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
        // 解说永远在（没有它这一块就没意义）
        expect(levels).toContain('guide-block-text')
      }

      if (step < GUIDE_BASIC_PAGES.length - 1) {
        await wrapper.get('[data-testid="guide-next"]').trigger('click')
      }
    }

    // 进阶栏也要过一遍（新页最容易漏掉三层里的某一层）
    const advanced = await mountInLane('advanced')
    for (let step = 0; step < GUIDE_ADVANCED_PAGES.length; step += 1) {
      const blocks = advanced.findAll('[data-testid="guide-block"]')
      expect(blocks.length).toBe(GUIDE_ADVANCED_PAGES[step].blocks.length)
      for (const block of blocks) {
        const levels = Array.from(
          block.element.querySelector('[data-testid="guide-block-body"]')?.querySelectorAll(
            '[data-testid^="guide-block-"]'
          ) ?? []
        ).map((el) => el.getAttribute('data-testid') ?? '')
        const ranks = levels.map((id) => rank[id])
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
        expect(levels).toContain('guide-block-text')
      }
      if (step < GUIDE_ADVANCED_PAGES.length - 1) {
        await advanced.get('[data-testid="guide-next"]').trigger('click')
      }
    }
  })

  /**
   * 数据层的锁：拆三层时最容易出的错是"拆出空层"（空盒子、空行）和
   * "有一条要点忘了写结论"。样式是给读者扫读用的，这两类错会让它失效。
   */
  it('数据层：每条要点都有结论，且三层都不允许是空字符串', () => {
    for (const page of GUIDE_PAGES) {
      for (const [index, block] of page.blocks.entries()) {
        const where = `第 ${page.id} 页第 ${index + 1} 块`
        expect(block.text.trim().length, `${where} 的解说不能为空`).toBeGreaterThan(0)
        if (block.label !== undefined) {
          expect(block.label.trim().length, `${where} 的结论不能是空盒子`).toBeGreaterThan(0)
        }
        if (block.note !== undefined) {
          expect(block.note.trim().length, `${where} 的补充不能是空行`).toBeGreaterThan(0)
        }
        if (block.kind === 'point') {
          expect(block.label, `${where} 是列表要点，必须给结论（扫读靠它）`).toBeTruthy()
        }
      }
    }
  })

  it('第 1 页介绍左下角的「指引」按钮：翻到最后一条能看到它，示意图里也有它', async () => {
    const wrapper = await mountInLane()
    for (let i = 1; i < GUIDE_NAV_SECTIONS.length; i += 1) {
      await wrapper.get('[data-testid="guide-slide-next"]').trigger('click')
    }
    // 最后一条讲的必须是「指引」（文案 2026-10-04 重写过，这里按新契约取值；
    // 守的是意图：第 8 条 = 左下角那枚按钮，不是别的）
    expect(wrapper.text()).toContain('这份教程')
    expect(wrapper.get('[data-testid="guide-art"]').text()).toContain(GUIDE_HINT_LABEL)
  })

  it('第 2 页的图例与参照图一一对应（图二~图八，一张都不许漏）', async () => {
    const wrapper = await mountInLane()
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    expect(currentStep(wrapper)).toBe(2)

    const arts = wrapper
      .findAll('[data-testid="guide-art"]')
      .map((el) => el.attributes('data-art'))
    expect(arts).toEqual([
      'workbench', // 图二：整页工作台（导语配图）
      'add-project', // 图三：点「添加」后那张表单（注意点写在框内）
      'sidebar-manage', // 图四：工具条 + 管理面板 + 父级行
      'row-progress', // 图五：每行进度（翻译进度 0/24、16/16）
      'card-actions', // 图六 + 图七：去嵌字 / 去翻译
      'toolbar-strip' // 图二左上角：打开当前文件夹 / 刷新 / 模式下拉
      // ⚠️ 图八（对照视图）2026-10-04 晚搬去第 09 页了 —— 那一页整页讲对照，
      //    这里少一张是**图位重排**的结果，不是丢图（第 09 页那条锁会接住它）
    ])
  })

  /**
   * 2026-10-04 用户看图后的第 4 条：这两张图要**左右排列**（原来竖着堆）。
   * jsdom 量不了宽度，所以锁的是"同一个横向容器里的两个图、顺序正确"。
   */
  it('「添加 / 修改 / 删除」那条：两张图并排在同一行里（左=添加项目表单，右=管理面板）', async () => {
    const wrapper = await mountInLane()
    await wrapper.get('[data-testid="guide-next"]').trigger('click')

    const row = wrapper.get('[data-testid="guide-arts-row"]')
    expect(
      row.findAll('[data-testid="guide-art"]').map((el) => el.attributes('data-art'))
    ).toEqual(['add-project', 'sidebar-manage'])
    // 左右并排 = 同一个容器里的兄弟节点（不是各自独立、上下堆）
    expect(wrapper.findAll('[data-testid="guide-arts-row"]')).toHaveLength(1)
  })

  /**
   * 2026-10-04 用户看图后的第 1 条：那两个箭头原来是"细描边 + 三级灰"，看不出能点。
   * 锁两件事：箭头是主色调（tonal）、下面那行写明怎么翻。
   */
  it('第 1 页的左右翻看按钮是主色调，且写明"左右箭头翻看 N / M"', async () => {
    const wrapper = await mountInLane()

    for (const id of ['guide-slide-prev', 'guide-slide-next']) {
      const classes = wrapper.get(`[data-testid="${id}"]`).classes()
      expect(classes, `${id} 还是"看不出能点"的灰色描边`).toContain('bg-primary-soft')
      expect(classes, `${id} 的字应当是主色`).toContain('text-accent')
      expect(classes).not.toContain('text-text-secondary')
    }

    const pos = wrapper.get('[data-testid="guide-slide-pos"]')
    expect(pos.text()).toContain('左右箭头翻看')
    expect(pos.text()).toContain(`1 / ${GUIDE_NAV_SECTIONS.length}`)
  })

  it('第 3 页的示意图换成图九（模式下拉展开），且只有一个', async () => {
    const wrapper = await mountInLane()
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    expect(currentStep(wrapper)).toBe(3)

    const arts = wrapper
      .findAll('[data-testid="guide-art"]')
      .map((el) => el.attributes('data-art'))
    expect(arts).toEqual(['mode-dropdown'])
  })

})

/**
 * 分层改版（2026-10-03）：入口页 + 上手栏（5 页）/ 进阶栏（3 页）。
 *
 * 为什么加：加了几块新功能（父级职责、标记台账/撤销/备份、三件套看图），
 * 老用户不需要重看"左边这条是干什么的"，但也有新东西要讲 —— 于是先让人**挑一栏**，
 * 而不是每次都把整本翻一遍。
 *
 * 这一组锁盯三件事：入口页是默认落点、两栏各算各的页数、**跨栏不许串页**。
 */
describe('GuideDialog 分层（入口页 + 上手 / 进阶）', () => {
  function enterLane(wrapper: ReturnType<typeof mountDialog>, lane: 'basics' | 'advanced') {
    return wrapper.get(`[data-testid="guide-lane-${lane}"]`).trigger('click')
  }

  it('打开时停在**入口页**：两个入口在、不显示"第 n / N 页"、页脚只有跳过', () => {
    const wrapper = mountDialog(true, true)

    expect(wrapper.find('[data-testid="guide-entry"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="guide-title"]').text()).toBe(GUIDE_ENTRY.title)
    expect(wrapper.find('[data-testid="guide-step"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="guide-dots"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="guide-prev"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="guide-next"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="guide-skip"]').exists()).toBe(true)

    // 两栏的标题与页数徽标都来自数据（组件不手抄）
    for (const lane of GUIDE_LANES) {
      const button = wrapper.get(`[data-testid="guide-lane-${lane.id}"]`)
      expect(button.text()).toContain(lane.label)
      // 徽标从"几页"改成**编号范围**，跟标题里的编号对得上（连续 01–09）
      expect(button.text()).toContain(lane.id === 'basics' ? '01–05' : '06–09')
    }
  })

  it('点「先看怎么用」→ 上手第 1 页（上一步禁用），页数按**上手栏**算', async () => {
    const wrapper = mountDialog(true, true)
    await enterLane(wrapper, 'basics')

    expect(wrapper.find('[data-testid="guide-entry"]').exists()).toBe(false)
    expect(currentStep(wrapper)).toBe(1)
    expect(wrapper.get('[data-testid="guide-step"]').text()).toBe(`1 / ${GUIDE_PAGES.length}`)
    expect(wrapper.get('[data-testid="guide-prev"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="guide-art"]').attributes('data-art')).toBe('nav')
    // 圆点是全局的（9 个）
    expect(wrapper.get('[data-testid="guide-dots"]').findAll('span')).toHaveLength(
      GUIDE_PAGES.length
    )
  })

  it('点「看进阶功能」→ 进阶第 1 页，页数按**进阶栏**算', async () => {
    const wrapper = mountDialog(true, true)
    await enterLane(wrapper, 'advanced')

    // 进阶栏第 1 页 = **全局第 06 步**（连续编号）
    expect(currentStep(wrapper)).toBe(GUIDE_BASIC_PAGES.length + 1)
    expect(wrapper.get('[data-testid="guide-title"]').text()).toBe(
      guideTitleWithNo(GUIDE_ADVANCED_PAGES[0])
    )
    expect(wrapper.get('[data-testid="guide-step"]').text()).toBe(
      `${GUIDE_BASIC_PAGES.length + 1} / ${GUIDE_PAGES.length}`
    )
    expect(wrapper.get('[data-testid="guide-dots"]').findAll('span')).toHaveLength(
      GUIDE_PAGES.length
    )
  })

  it('基础栏翻到头：主按钮是「继续看进阶」，而 → 键**不会自己滑过去**', async () => {
    const wrapper = mountDialog(true, true)
    await enterLane(wrapper, 'basics')

    for (let step = 1; step < GUIDE_BASIC_PAGES.length; step += 1) {
      await wrapper.get('[data-testid="guide-next"]').trigger('click')
    }
    expect(currentStep(wrapper)).toBe(GUIDE_BASIC_PAGES.length)
    expect(wrapper.get('[data-testid="guide-next"]').text()).toBe('继续看进阶')

    // → 键不许把它带到进阶第 1 页，也不许关窗
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await wrapper.vm.$nextTick()
    expect(currentStep(wrapper)).toBe(GUIDE_BASIC_PAGES.length)
    expect(wrapper.get('[data-testid="guide-title"]').text()).toBe(
      guideTitleWithNo(GUIDE_BASIC_PAGES[GUIDE_BASIC_PAGES.length - 1])
    )
    expect(wrapper.emitted('close')).toBeFalsy()

    // 点「继续看进阶」→ **不关窗**，进进阶栏第 1 页（全局 06）
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    expect(wrapper.emitted('close')).toBeFalsy()
    expect(currentStep(wrapper)).toBe(GUIDE_BASIC_PAGES.length + 1)

    // 进阶栏翻到头才是「完成」→ 这才关窗
    for (let i = 1; i < GUIDE_ADVANCED_PAGES.length; i += 1) {
      await wrapper.get('[data-testid="guide-next"]').trigger('click')
    }
    expect(wrapper.get('[data-testid="guide-next"]').text()).toBe('完成')
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('入口页按方向键不翻页（还没有"页"可翻）', async () => {
    const wrapper = mountDialog(true, true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await wrapper.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="guide-entry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="guide-step"]').exists()).toBe(false)
  })

  it('重新打开回到**入口页**（不是停在上次那一栏那一页）', async () => {
    const wrapper = mountDialog(true, true)
    await enterLane(wrapper, 'advanced')
    await wrapper.get('[data-testid="guide-next"]').trigger('click')
    expect(currentStep(wrapper)).toBe(GUIDE_BASIC_PAGES.length + 2)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.find('[data-testid="guide-entry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="guide-step"]').exists()).toBe(false)
  })
})

/**
 * 2026-10-04 视觉精修（用户看图拍板的 A 方案）：头部主色渐变带 + 「01 / 09」编号小字 +
 * 标题加大；入口页栏卡升级；主按钮加重。这一组锁盯四件"壳"的事 ——
 * 都是"改回去不会报错、只会悄悄变丑"的地方，所以必须锁住。
 */
describe('GuideDialog 视觉精修（壳层，2026-10-04）', () => {
  it('头部有主色渐变底带，编号写成「01 / 09」且从数据推出来（不手抄）', async () => {
    const wrapper = await mountInLane()
    const header = wrapper.get('[data-testid="guide-header"]')
    expect(header.classes()).toContain('guide-header-gradient')

    const no = wrapper.get('[data-testid="guide-header-no"]')
    const expected = GUIDE_BASIC_PAGES.findIndex((page) => page.id === 'nav') + 1
    expect(no.text()).toBe(
      `${String(expected).padStart(2, '0')} / ${String(GUIDE_PAGES.length).padStart(2, '0')}`
    )
  })

  it('页标题加大到 19px（text-[19px]），不再是与正文同权重的 16px', async () => {
    const wrapper = await mountInLane()
    expect(wrapper.get('[data-testid="guide-title"]').classes()).toContain('text-[19px]')
  })

  it('入口页「先看怎么用」的编号徽标是实心主色块，两张栏卡升级成 rounded-lg 大卡', () => {
    const wrapper = mountDialog(true, true)
    const basics = wrapper.get('[data-testid="guide-lane-basics"]')
    expect(basics.classes()).toContain('rounded-[var(--radius-lg)]')
    // 实心主色徽标：底是 --accent、字是 on-accent（不再是 primary-soft 淡底）
    const badge = basics.get('[data-testid="guide-lane-range"]')
    expect(badge.classes()).toContain('bg-accent')
    expect(badge.classes()).toContain('text-text-on-accent')
    // 进阶卡保持低调：徽标是灰块
    const advBadge = wrapper
      .get('[data-testid="guide-lane-advanced"]')
      .get('[data-testid="guide-lane-range"]')
    expect(advBadge.classes()).toContain('bg-card-bg-hover')
  })

  it('页脚主按钮加重（font-semibold + 阴影），「跳过」降为三级灰', async () => {
    const wrapper = await mountInLane()
    const primary = wrapper.get('[data-testid="guide-next"]')
    expect(primary.classes()).toContain('font-semibold')
    expect(primary.classes()).toContain('shadow-[var(--shadow-1)]')
    expect(wrapper.get('[data-testid="guide-skip"]').classes()).toContain('text-text-tertiary')
  })
})

/**
 * 2026-10-04 杂志式重排（用户在四方案对照里拍板的 C）：正文区改成
 * 「左栏页导航 + 右栏内容」两栏。这一组锁盯四件"布局改了不许改坏"的事：
 * 左栏在、可跳、高亮跟随、入口页不渲染左栏。
 */
describe('GuideDialog 杂志式两栏（2026-10-04）', () => {
  it('进栏后左栏页导航存在，且列出当前栏全部页、当前页高亮', async () => {
    const wrapper = await mountInLane()
    const nav = wrapper.get('[data-testid="guide-page-nav"]')
    const items = nav.findAll('[data-testid^="guide-page-nav-item-"]')
    expect(items).toHaveLength(GUIDE_BASIC_PAGES.length)
    // 第一项高亮（当前页）
    expect(items[0].classes()).toContain('bg-primary-soft')
  })

  it('点左栏第 3 项直达第 3 页（guide-step 变 3），且高亮跟着走', async () => {
    const wrapper = await mountInLane()
    await wrapper.get('[data-testid="guide-page-nav-item-2"]').trigger('click')
    expect(currentStep(wrapper)).toBe(3)
    const items = wrapper
      .get('[data-testid="guide-page-nav"]')
      .findAll('[data-testid^="guide-page-nav-item-"]')
    expect(items[2].classes()).toContain('bg-primary-soft')
    expect(items[0].classes()).not.toContain('bg-primary-soft')
  })

  it('入口页不渲染左栏（还没进任何栏）', () => {
    const wrapper = mountDialog(true, true)
    expect(wrapper.find('[data-testid="guide-page-nav"]').exists()).toBe(false)
  })

  it('进阶栏的左栏列出的是进阶 4 页（不是基础 5 页）', async () => {
    const wrapper = mountDialog(true, true)
    await wrapper.get('[data-testid="guide-lane-advanced"]').trigger('click')
    const items = wrapper
      .get('[data-testid="guide-page-nav"]')
      .findAll('[data-testid^="guide-page-nav-item-"]')
    expect(items).toHaveLength(GUIDE_ADVANCED_PAGES.length)
  })
})

/**
 * 数据层（分层之后）。三条都是"改内容时最容易漏"的地方：
 * 版本号没跟上（老用户看不到新增页）、某栏页数写错、新页忘了配图例。
 */
describe('引导数据：分栏与版本', () => {
  it('版本号 = 5，且与"两栏都非空"配套（加页必须 +1，否则老用户永远看不到）', () => {
    expect(GUIDE_VERSION).toBe(5)
    expect(GUIDE_LANES.map((lane) => lane.id)).toEqual(['basics', 'advanced'])
    expect(GUIDE_BASIC_PAGES.length).toBe(5)
    expect(GUIDE_ADVANCED_PAGES.length).toBe(4)
    // 平铺视图 = 两栏按顺序拼起来（给"全量数据检查"和截图工装用）
    expect(GUIDE_PAGES).toEqual([...GUIDE_BASIC_PAGES, ...GUIDE_ADVANCED_PAGES])
  })

  it('页面 id 全局唯一（两栏之间也不许撞）', () => {
    const ids = GUIDE_PAGES.map((page) => page.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('进阶四页各自配了图例，且是那几张（职责 / 进度 / 台账 / 对照 + 三件套）', () => {
    const artsOf = (page: (typeof GUIDE_ADVANCED_PAGES)[number]) =>
      page.blocks.flatMap((block) => [...(block.arts ?? []), ...(block.artsRow ?? [])])
    expect(artsOf(GUIDE_ADVANCED_PAGES[0])).toEqual(['parent-duty'])
    expect(artsOf(GUIDE_ADVANCED_PAGES[1])).toEqual(['progress'])
    expect(artsOf(GUIDE_ADVANCED_PAGES[2])).toEqual(['mark-ledger'])
    // 对照视图这张（原图 | PSD）2026-10-04 晚从第 02 页搬到这里 —— 第 09 页整页讲对照
    expect(artsOf(GUIDE_ADVANCED_PAGES[3])).toEqual(['compare', 'viewer-controls'])
  })

  it('所有栏所有页：每条要点都有结论，三层都不许是空字符串', () => {
    for (const page of GUIDE_PAGES) {
      for (const [index, block] of page.blocks.entries()) {
        const where = `第 ${page.id} 页第 ${index + 1} 块`
        expect(block.text.trim().length, `${where} 的解说不能为空`).toBeGreaterThan(0)
        if (block.label !== undefined) {
          expect(block.label.trim().length, `${where} 的结论不能是空盒子`).toBeGreaterThan(0)
        }
        if (block.note !== undefined) {
          expect(block.note.trim().length, `${where} 的补充不能是空行`).toBeGreaterThan(0)
        }
        if (block.kind === 'point') {
          expect(block.label, `${where} 是列表要点，必须给结论（扫读靠它）`).toBeTruthy()
        }
      }
    }
  })
})

/**
 * 说明书一致性（2026-10-03）。
 *
 * 这一条是**这次改版真正的起因**：卡片左下角那个点早就不表示"勾选"了
 * （它=当前模式的完成状态、点它就能改），而引导里一直写着"小圆圈是勾选"。
 * 引导文件头自己就写着"别让说明书和程序说的不一样" —— 所以拿锁盯住这两处。
 */
describe('说明书不许和程序说的不一样', () => {
  /**
   * 2026-10-03 这条锁要求"第 2 页必须有一条讲左下角圆点的要点"；
   * 2026-10-04 用户看图后决定**把那一整条删掉**（原话：图六部分的介绍删去）。
   * 于是锁改成它真正要守的那条底线：**圆点不许再被说成"勾选"** ——
   * 那个说法是 2026-10-03 抓到的真错，删块不能顺手把它放回来。
   */
  it('那条讲左下角圆点的要点已按用户要求删掉，而"圆点≠勾选"这条底线仍在', () => {
    const workbench = GUIDE_PAGES.find((page) => page.id === 'workbench')!
    expect(
      workbench.blocks.some((block) => (block.label ?? '').includes('左下')),
      '第 2 页那条讲左下角圆点的要点应当已删掉（用户 2026-10-04 要求）'
    ).toBe(false)

    // 信息没丢：「标记X / 标记未X」作用在一批卡片上，第 03 页仍在讲
    const modes = GUIDE_PAGES.find((page) => page.id === 'modes')!
    expect(modes.blocks.some((block) => block.text.includes('勾选'))).toBe(true)

    // 全引导扫描：任何提到"圆点"的句子都不许再把它说成"勾选"
    for (const page of GUIDE_PAGES) {
      for (const block of page.blocks) {
        const all = [block.label, block.text, block.note].filter(Boolean).join(' ')
        if (all.includes('圆点')) expect(all, `第 ${page.id} 页又把圆点说成勾选了`).not.toContain('勾选')
      }
    }
  })

  /**
   * 2026-10-04 用户看图后的第 7 条：原来分两条讲"「翻译」「校对」点去翻译"与
   * "「嵌字」「监修」点去嵌字"，要**合并精简**成一条。合并 ≠ 丢信息：两种模式都得还在。
   */
  it('第 2 页「去X」的按模式说明合并成一条', () => {
    const workbench = GUIDE_PAGES.find((page) => page.id === 'workbench')!
    const merged = workbench.blocks.filter((block) => (block.label ?? '').includes('去X'))
    expect(merged, '按模式的「去X」说明应当只剩一条').toHaveLength(1)

    const block = merged[0]
    expect(block.text).toContain('翻译')
    expect(block.text).toContain('嵌字')
    expect(block.text).toContain('LabelPlusFX')
    expect(block.text).toContain('PSD')
    expect(block.note ?? '').toContain('.jsx')
    expect(block.note ?? '').toContain('弹窗')
  })

  /**
   * 2026-10-04 用户看图后的第 8 条：第 4 页删掉示意图，改成
   * **一处介绍紧跟一处填写框**（而不是三处介绍完了再堆三个框），避免重复。
   */
  it('第 4 页：示意图已删掉，且每条介绍后面紧跟它自己的填写框', async () => {
    const wrapper = await mountInLane()
    for (let i = 0; i < 3; i += 1) await wrapper.get('[data-testid="guide-next"]').trigger('click')
    expect(currentStep(wrapper)).toBe(4)

    // ① 那一页不再有示意图（数据层与渲染层都不许有）
    const allArts = GUIDE_PAGES.flatMap((page) =>
      page.blocks.flatMap((block) => [...(block.arts ?? []), ...(block.artsRow ?? [])])
    )
    expect(allArts).not.toContain('settings-form')
    expect(wrapper.find('[data-art="settings-form"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="guide-art"]')).toHaveLength(0)

    // ② DOM 顺序 = 介绍、它的框、下一条介绍……（不是三条介绍 + 末尾三个框）
    const order = wrapper
      .findAll('[data-testid="guide-block"], [data-testid="guide-tool-row"]')
      .map((el) =>
        el.attributes('data-testid') === 'guide-tool-row'
          ? `row:${el.attributes('data-field')}`
          : 'block'
      )
    expect(order).toEqual([
      'block', // 导语
      'block',
      'row:labelPlusFx',
      'block',
      'row:photoshop',
      'block',
      'row:importScript',
      'block' // 「不再提示」那条（它没有框）
    ])

    // ③ 三个框的 id 与顺序跟设置页真实顺序一致（翻译/校对 → Photoshop → 译文导入）
    expect(GUIDE_TOOL_FIELDS.map((field) => field.id)).toEqual([
      'labelPlusFx',
      'photoshop',
      'importScript'
    ])
  })

  it('文案里不许出现 markdown 记号（** / `）—— 它是纯文本，会原样渲染给用户看', () => {
    // 2026-10-03 现场：screenshot 里看到「按**当前选中的职责**算」——星号原样显示了。
    for (const page of GUIDE_PAGES) {
      for (const block of page.blocks) {
        const fields = [block.label, block.text, block.note]
        for (const value of fields) {
          if (!value) continue
          expect(value, `第 ${page.id} 页的文案里有 markdown 星号：${value}`).not.toContain('**')
          expect(value, `第 ${page.id} 页的文案里有 markdown 反引号：${value}`).not.toContain('`')
        }
      }
    }
  })

  it('黑话首次出现必须带白话解释（2026-10-04 用户要求"深入浅出"）', () => {
    // 「待烤」是本应用的自造词 —— 第一次出现的页必须在同一条文案里给白话
    const progressPage = GUIDE_PAGES.find((page) => page.id === 'progress')!
    const first = progressPage.blocks.find((block) =>
      [block.label, block.text, block.note].filter(Boolean).join(' ').includes('待烤')
    )
    expect(first, '「进度」页必须有讲「待烤」的条目').toBeTruthy()
    const all = [first!.label, first!.text, first!.note].filter(Boolean).join(' ')
    expect(all).toMatch(/待烤[（(=＝]|＝[^（]*待烤|[（=＝]/)
    expect(all).toContain('没做完')
  })

  it('每一页导语都回答"这页讲什么"（一句话点名主题 + 一句为什么在乎）', () => {
    for (const page of GUIDE_PAGES) {
      const lead = page.blocks.find((block) => block.kind === 'lead')
      expect(lead, `第 ${page.id} 页必须有导语`).toBeTruthy()
      // 导语不能太短（只是个空壳开场）也不能太长（变成正文）—— 15~60 字
      const len = lead!.text.length
      expect(len, `第 ${page.id} 页导语 ${len} 字：太短（没说清这页讲什么）`).toBeGreaterThanOrEqual(15)
      expect(len, `第 ${page.id} 页导语 ${len} 字：太长（抢了正文的活）`).toBeLessThanOrEqual(60)
    }
  })

  it('上手第 1 页讲「字体」那条要提到「识字网」（用户 2026-10-03 要求）', () => {
    const nav = GUIDE_BASIC_PAGES.find((page) => page.id === 'nav')!
    const block = nav.blocks.find((item) => item.label === '字体')
    expect(block, '上手第 1 页必须有「字体」那条').toBeTruthy()
    const all = [block!.text, block!.note].filter(Boolean).join(' ')
    expect(all).toContain('识字网')
    // 只写个词不够 —— 得说清"点按钮就能去外面那个站"（真实按钮在字体页的动作行里）
    expect(all).toContain('按钮')
    expect(all).toContain('浏览器')
  })

  it('「标记后下一张」说的是对照视图的工具条（它**不在**设置页）', () => {
    const viewer = GUIDE_ADVANCED_PAGES.find((page) => page.id === 'viewer')!
    const block = viewer.blocks.find((item) => (item.label ?? '').includes('标记后下一张'))
    expect(block, '进阶「看图与对照」必须有这一条').toBeTruthy()
    expect(block!.text).toContain('对照视图')
    expect(block!.text).not.toContain('设置')
  })
})
