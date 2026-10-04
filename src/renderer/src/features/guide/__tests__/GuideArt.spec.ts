// @vitest-environment jsdom
/**
 * 引导图例（`features/guide/GuideArt.vue`）—— 2026-10-03 新增的三张。
 *
 * 为什么单独一个文件：图例是**照着真实控件复刻**的迷你示意图，最容易出的错是
 * "画的东西和程序里不一样"（同一类错误这次改版刚抓到过一次：卡片左下角那个点
 * 被写成"勾选"）。所以这里既锁**内容**（关键控件在不在、文案对不对），
 * 也锁**只用主题 token**（不许出现写死的颜色 —— 否则夜间模式会瞎）。
 *
 * ⚠️ 内容断言一律用 `wrapper.text()`，**不要用 `html()` + `toContain`** ——
 * 后者会把注释节点一起序列化，注释里出现同样的词就会假绿（本轮实测踩到过）。
 *
 * 三张图对应进阶栏：`parent-duty`（职责）/ `mark-ledger`（标记有记录）/ `viewer-controls`（看图）。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GuideArt from '../GuideArt.vue'
import {
  GUIDE_DUTY_CHIPS,
  GUIDE_DUTY_CHOSEN,
  GUIDE_NAV_SECTIONS,
  GUIDE_PAGES
} from '../guide-pages'
import type { WorkMode } from '@shared/types'

/** 模式 → { label, short }（与图例同一个来源，不手抄一份）。 */
const CHIP = Object.fromEntries(GUIDE_DUTY_CHIPS.map((item) => [item.mode, item])) as Record<
  WorkMode,
  (typeof GUIDE_DUTY_CHIPS)[number]
>

function render(art: 'parent-duty' | 'progress' | 'mark-ledger' | 'viewer-controls') {
  return mount(GuideArt, { props: { art } })
}

/** 三张图共用的底线：不许出现写死的颜色（会破坏夜间）。 */
function expectTokenOnly(html: string): void {
  expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  expect(html).not.toMatch(/rgba?\(/)
}

describe('GuideArt：进阶栏的四张新图例', () => {
  it('parent-duty：两枚单字胶囊 + 菜单里两项打勾 + "最多 2 个"', () => {
    const wrapper = render('parent-duty')
    const text = wrapper.text()
    const html = wrapper.html()

    // 胶囊上的单字（与 shared/modes 的 WORK_MODE_SHORT_LABELS 同源）
    for (const mode of GUIDE_DUTY_CHOSEN) {
      expect(text).toContain(CHIP[mode].short)
    }
    // 菜单四项都在，已选的两项带 ✓
    for (const mode of ['typeset', 'translated', 'proofread', 'supervised'] as const) {
      expect(text).toContain(CHIP[mode].label)
    }
    expect(html.match(/✓/g) ?? []).toHaveLength(GUIDE_DUTY_CHOSEN.length)
    expect(text).toContain('最多 2 个')
    // 那张图要教的事：点胶囊能改 + 进本自动切
    expect(text).toContain('点这枚胶囊就能改')
    expectTokenOnly(html)
  })

  it('progress：逐本欠账清单 —— 三行示例、真实胶囊、待烤/完成度，只用 token', () => {
    const wrapper = render('progress')
    const text = wrapper.text()
    const html = wrapper.html()

    expect(text).toContain('待烤')
    expect(text).toContain('完成度')
    // 示例行：青梅亭亭（双职责）、快住手（单职责）
    expect(text).toContain('青梅亭亭')
    expect(text).toContain('快住手')
    // 职责胶囊用**真实原语**画（与程序里同一枚 .duty-chip），不是另画一套
    expect(wrapper.findAll('.duty-chip').length).toBeGreaterThan(0)
    expect(wrapper.find('.duty-chip--pair').exists()).toBe(true)
    expect(wrapper.find('.duty-chip--single').exists()).toBe(true)
    expectTokenOnly(html)
  })

  it('mark-ledger：撤销 + 台账（两行、还原 / 已还原）+ 备份入口', () => {
    const wrapper = render('mark-ledger')
    const text = wrapper.text()
    const html = wrapper.html()

    expect(text).toContain('撤销')
    expect(text).toContain('标记记录')
    expect(text).toContain('校对')
    expect(text).toContain('监修')
    expect(text).toContain('还原')
    expect(text).toContain('已还原')
    // 备份入口必须写明在**设置 › 数据安全**里（这是"去哪找"的信息）
    expect(text).toContain('数据安全')
    expect(text).toContain('从备份还原标记')
    expectTokenOnly(html)
  })

  it('viewer-controls：缩放 / 播放 / 胶片条 / ⇥ 标记后下一张 都在', () => {
    const wrapper = render('viewer-controls')
    const text = wrapper.text()
    const html = wrapper.html()

    expect(text).toContain('100%')
    expect(text).toContain('播放')
    expect(text).toContain('胶片')
    // 那枚开关的真实位置就是对照视图工具条 —— 图里必须画出来。
    // ⚠️ 按 testid 找、不查字符串：注释里也有"下一张"，而 `html()` 会把注释一起序列化
    // （本轮踩过：变异把它删了，锁却因为命中注释而假绿）。
    const advanceChip = wrapper.find('[data-testid="guide-art-advance-chip"]')
    expect(advanceChip.exists()).toBe(true)
    expect(advanceChip.text()).toContain('下一张')
    expect(text).toContain('点哪张跳哪张')
    expectTokenOnly(html)
  })
})

/**
 * 2026-10-04 用户看图后的第 3 / 4 / 5 条。这一组盯三件事：
 *   ① 导航线框里的字必须**从下面那条文案里取**（用户原话：示意图中的文字和下方所选项的文案要统一）；
 *   ② 图例不再被拉满整宽（用户原话：保证合适大小即可，无需占满左右宽度）；
 *   ③ 两张新图：`add-project`（添加项目表单，注意点**写在框内**）/ `sidebar-manage`（工具条 + 管理面板）。
 */
describe('GuideArt：线框与文案同一套词（2026-10-04）', () => {
  it('八张导航线框里的每个词，都能在该条文案里找到（词是"抄"文案的，不是另起一套）', () => {
    for (const section of GUIDE_NAV_SECTIONS) {
      const copy = [section.label, section.text, section.note ?? ''].join(' ')
      expect(section.wireWords.length, `「${section.label}」没写线框词`).toBeGreaterThan(0)
      for (const word of section.wireWords) {
        expect(copy, `「${section.label}」线框里的「${word}」在文案里找不到`).toContain(word)
      }
    }
  })

  it('翻到哪一项，线框里就真的画出那几个词（不是只写在数据里）', () => {
    for (const section of GUIDE_NAV_SECTIONS) {
      const wrapper = mount(GuideArt, { props: { art: 'nav', focus: section.wire } })
      const text = wrapper.text()
      for (const word of section.wireWords) {
        expect(text, `focus=${section.wire} 的线框里少了「${word}」`).toContain(word)
      }
      expectTokenOnly(wrapper.html())
    }
  })

  it('图例不再占满整宽：根容器是 w-fit + max-w-full，不许再有 w-full', () => {
    // 只用 token / 尺寸这类"契约"断言（jsdom 没有排版引擎，宽度量不出来）
    for (const page of GUIDE_PAGES) {
      for (const art of page.blocks.flatMap((block) => [...(block.arts ?? []), ...(block.artsRow ?? [])])) {
        const wrapper = mount(GuideArt, { props: { art } })
        const root = wrapper.get('[data-testid="guide-art"]')
        expect(root.classes(), `${art} 还是拉满整宽`).not.toContain('w-full')
        expect(root.classes(), `${art} 应该是自然宽度`).toContain('w-fit')
        expect(root.classes(), `${art} 少了 max-w-full`).toContain('max-w-full')
      }
    }
    const nav = mount(GuideArt, { props: { art: 'nav' } })
    expect(nav.get('[data-testid="guide-art"]').classes()).toContain('w-fit')
    expect(nav.get('[data-testid="guide-art"]').classes()).not.toContain('w-full')
  })

  it('add-project：复刻添加项目表单 —— 四个字段都在，注意点写在框内', () => {
    const wrapper = mount(GuideArt, { props: { art: 'add-project' } })
    const text = wrapper.text()

    // 字段名与 `components/ProjectFormModal.vue` 的真实标签一致
    for (const label of ['项目所在文件夹路径', '漫画名称(父级)', '集数', '项目标题']) {
      expect(text).toContain(label)
    }
    // 四条注解 = 用户 2026-10-04 的原话（写在各自框内）
    for (const note of [
      '填入想选漫画对应的文件夹地址',
      '已有漫画下拉列表选择；新加漫画在此输入期望标题',
      '单话集数，可汉字（如番外）；初次新建无需填写。',
      '单话标题；初次新建无需填写。'
    ]) {
      expect(text).toContain(note)
    }
    expectTokenOnly(wrapper.html())
  })

  it('sidebar-manage：工具条 + 管理面板 + 父级行合成一张（原图三 + 图四）', () => {
    const wrapper = mount(GuideArt, { props: { art: 'sidebar-manage' } })
    const text = wrapper.text()

    for (const word of [
      '添加',
      '修改',
      '删除',
      '管理',
      '已嵌全部',
      '未嵌全部',
      '删除选中',
      '取消',
      '町野同学',
      '青梅亭亭',
      '重命名'
    ]) {
      expect(text).toContain(word)
    }
    expectTokenOnly(wrapper.html())
  })
})
