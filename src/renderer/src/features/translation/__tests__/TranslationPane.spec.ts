// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ChapterTranslationReadResult } from '@shared/chapter-translation'
import type { LabelPlusImageEntry } from '@shared/labelplus-import'
import TranslationPane from '../TranslationPane.vue'
import { REVIEW_MISSING_ORIGINAL } from '@shared/translation-review'

function entry(labels: Array<{ index: number; group: string; text: string }>): LabelPlusImageEntry {
  return {
    fileName: '20.jpg',
    labels: labels.map((label) => ({
      index: label.index,
      group: label.group,
      text: label.text,
      position: { unit: 'normalized', x: 0.5, y: 0.5 }
    }))
  }
}

function ok(documentImages: LabelPlusImageEntry[] = []): ChapterTranslationReadResult {
  return {
    status: 'ok',
    file: {
      path: 'D:\\话\\20.txt',
      name: '20.txt',
      mtimeMs: 1,
      size: 1024,
      sha256: 'a'.repeat(64)
    },
    txtCount: 1,
    message: '',
    document: {
      sourcePath: 'D:\\话\\20.txt',
      version: { first: 1, last: 0 },
      groups: ['框内', '框外'],
      images: documentImages,
      warnings: []
    }
  }
}

function mountPane(overrides?: {
  loading?: boolean
  result?: ChapterTranslationReadResult | null
  entry?: LabelPlusImageEntry | null
  groups?: string[]
  activeIndex?: number | null
  editingIndex?: number | null
  groupOverrides?: Record<number, string>
  dirty?: boolean
  changedCount?: number
  saving?: boolean
  notice?: string
  changedIndices?: number[]
  /** 第 2 批：档位（默认翻译档 = 现状）。 */
  mode?: 'translate' | 'review'
  /** 第 2 批：这一页里校对过的那些（按条目编号索引）。 */
  reviews?: Record<number, { originalText: string; reason: string }>
  /** 第 2 批：整话已校条数。 */
  reviewCount?: number
  /** 2026-10-07：本会话还有可退的保存（状态条那枚只表示有/无的小标）。 */
  canUndoSaved?: boolean
  /** 第 5 批 5d-2：页头「新增框」开关（默认关）。 */
  addFrameMode?: boolean
  /** 第 5 批 5d-2：刚新增的那一条（瞬时高亮，父层持有）。 */
  justAddedIndex?: number | null
  /**
   * 挂到真实文档上。
   * ⚠️ jsdom 里 `element.focus()` **只对挂在文档上的元素生效** —— 不挂的话 `document.activeElement`
   * 永远是 body，凡"靠 activeElement 判断"的行为都测不到（本轮那条"焦点还在编辑器里就不收"就踩了这个）。
   */
  attachTo?: HTMLElement
}) {
  return mount(TranslationPane, {
    global: { stubs: { PopoverContent: { name: "PopoverContent", template: "<div><slot /></div>" } } },
    ...(overrides?.attachTo ? { attachTo: overrides.attachTo } : {}),
    props: {
      loading: overrides?.loading ?? false,
      result: overrides?.result ?? null,
      entry: overrides?.entry ?? null,
      groups: overrides?.groups ?? ['框内', '框外'],
      activeIndex: overrides?.activeIndex ?? null,
      editingIndex: overrides?.editingIndex ?? null,
      groupOverrides: overrides?.groupOverrides ?? {},
      dirty: overrides?.dirty ?? false,
      changedCount: overrides?.changedCount ?? 0,
      saving: overrides?.saving ?? false,
      notice: overrides?.notice ?? '',
      changedIndices: overrides?.changedIndices ?? [],
      mode: overrides?.mode ?? 'translate',
      reviews: overrides?.reviews ?? {},
      reviewCount: overrides?.reviewCount ?? 0,
      canUndoSaved: overrides?.canUndoSaved ?? false,
      addFrameMode: overrides?.addFrameMode ?? false,
      justAddedIndex: overrides?.justAddedIndex ?? null
    }
  })
}

describe('右栏译文 · 四种"没有内容"的原因分开说', () => {
  it('还在读 ⇒ 说"读取中"，不冒充"没有译文"', () => {
    const wrapper = mountPane({ loading: true, result: null })
    expect(wrapper.get('[data-testid="translation-pane-empty"]').text()).toContain('读取中')
  })

  it('读不了（error）⇒ 用结果里的那句人话', () => {
    const wrapper = mountPane({
      result: {
        status: 'error',
        file: null,
        txtCount: 0,
        message: '读不了话目录：盘掉了',
        document: null
      }
    })
    expect(wrapper.get('[data-testid="translation-pane-empty"]').text()).toContain('盘掉了')
  })

  it('目录里没有能用的 txt（not-found）⇒ 用结果里的那句人话', () => {
    const wrapper = mountPane({
      result: {
        status: 'not-found',
        file: null,
        txtCount: 3,
        message: '找到 3 份 txt，但没有一份能当 LabelPlus 文本读',
        document: null
      }
    })
    expect(wrapper.get('[data-testid="translation-pane-empty"]').text()).toContain(
      '没有一份能当 LabelPlus 文本读'
    )
  })

  it('本页没译文 ⇒ 说"本页无译文"（不是"未找到译文"——那是整话的事）', () => {
    const wrapper = mountPane({ result: ok(), entry: null })
    expect(wrapper.get('[data-testid="translation-pane-empty"]').text()).toBe('本页无译文')
  })

  it('这一页有记录但一条都没填 ⇒ 也算"本页无译文"', () => {
    const wrapper = mountPane({ result: ok([entry([])]), entry: entry([]) })
    expect(wrapper.get('[data-testid="translation-pane-empty"]').text()).toBe('本页无译文')
  })
})

describe('右栏译文 · 清单本身', () => {
  const page = entry([
    { index: 1, group: '框内', text: '难道是我说错话了?' },
    { index: 4, group: '框外', text: '嘟囔' },
    { index: 9, group: '框外', text: '' }
  ])

  it('一条一行：编号补零 + 分组名 + 译文', () => {
    const wrapper = mountPane({ result: ok([page]), entry: page })
    const rows = wrapper.findAll('[data-testid^="translation-row-"]')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('01')
    expect(rows[0].text()).toContain('框内')
    expect(rows[0].text()).toContain('难道是我说错话了?')
    expect(rows[1].text()).toContain('04')
    expect(rows[1].text()).toContain('框外')
  })

  it('空译文照实标"（未填写）"，不假装没有这一条', () => {
    const wrapper = mountPane({ result: ok([page]), entry: page })
    expect(wrapper.get('[data-testid="translation-row-9"]').text()).toContain('（未填写）')
    expect(wrapper.findAll('[data-testid^="translation-row-"]')).toHaveLength(3)
  })

  it('底部写出用的是哪一份 txt（目录里有多份时这是唯一的凭据）', () => {
    const wrapper = mountPane({ result: ok([page]), entry: page })
    expect(wrapper.get('[data-testid="translation-status-text"]').text()).toContain('20.txt')
  })

  it('没拿到 txt 时不显示来源行（不编一个文件名）', () => {
    const wrapper = mountPane({
      result: {
        status: 'not-found',
        file: null,
        txtCount: 0,
        message: '话目录里没有 .txt 文件',
        document: null
      },
      entry: null
    })
    // 状态条**永远在**（高度固定是"不抖"的前提），只是这一刻没有字。
    // ⚠️ 用 `get()` 而不是 `find()`：它**找不到就抛**，所以这里不需要再断言 exists。
    expect(wrapper.get('[data-testid="translation-status-text"]').text()).toBe('')
  })

  it('点一条 ⇒ emit pick(编号)；移入移出 ⇒ emit hover(编号 / null)', async () => {
    const wrapper = mountPane({ result: ok([page]), entry: page })
    const row = wrapper.get('[data-testid="translation-row-4"]')

    await row.trigger('click')
    expect(wrapper.emitted('pick')?.at(-1)).toEqual([4])

    await row.trigger('pointerenter')
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([4])
    await row.trigger('pointerleave')
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([null])
  })

  it('选中的那一条带 data-active（点锚点后右栏要看得出来是哪条）', () => {
    const wrapper = mountPane({ result: ok([page]), entry: page, activeIndex: 4 })
    expect(wrapper.get('[data-testid="translation-row-4"]').attributes('data-active')).toBe('true')
    expect(wrapper.get('[data-testid="translation-row-1"]').attributes('data-active')).toBe('false')
  })

})

describe('右栏译文 · P2 编辑（选中那一条在它自己下方展开）', () => {
  const page = entry([
    { index: 1, group: '框内', text: '甲' },
    { index: 2, group: '框外', text: '乙\n丙' }
  ])
  const withPage = () => ok([page])

  it('没选中任何一条 ⇒ 一个编辑器都不出现（只读长相与 P1 一致）', () => {
    const wrapper = mountPane({ result: withPage(), entry: page })
    expect(wrapper.find('[data-testid="translation-editor-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="translation-editor-2"]').exists()).toBe(false)
  })

  it('选中第 2 条 ⇒ 只有它的编辑器出现，且**多行文本原样带进来**', () => {
    const wrapper = mountPane({ result: withPage(), entry: page, editingIndex: 2 })
    expect(wrapper.find('[data-testid="translation-editor-1"]').exists()).toBe(false)
    const textarea = wrapper.get('[data-testid="translation-textarea-2"]')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('乙\n丙')
  })

  it('编辑文字只在 Ctrl+S 或关闭时提交，点击分组不提前保存文本', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page, editingIndex: 1 })
    const textarea = wrapper.get('[data-testid="translation-textarea-1"]')
    await textarea.setValue('改过的甲')
    await textarea.trigger('blur')
    expect(wrapper.emitted('editText')).toBeUndefined()
    await textarea.trigger('keydown', { key: 's', ctrlKey: true })
    expect(wrapper.emitted('editText')?.at(-1)).toEqual([1, '改过的甲'])
  })

  it('文本框里按 Esc ⇒ 退回文档里的值（半截输入不被保留）', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page, editingIndex: 1 })
    const textarea = wrapper.get('[data-testid="translation-textarea-1"]')

    /**
     * ⚠️ 这里**故意不用 `setValue()`**：VTU 的 `setValue` 会同时派发 `input` 与 `change`，
     * 而真实浏览器里 `change` 只在**失焦**时才发 —— 用它建模"打字打到一半"会让
     * 提交提前发生，测出来的就不是 Esc 的行为了（这条用例第一次就是这么写错的）。
     * 所以直接派发 `input`（真实浏览器里打字发的就是它）。
     */
    ;(textarea.element as HTMLTextAreaElement).value = '打了一半'
    await textarea.trigger('input')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('打了一半')

    wrapper.findComponent({ name: 'PopoverContent' }).vm.$emit('escapeKeyDown', new Event('keydown'))
    await wrapper.vm.$nextTick()
    expect((textarea.element as HTMLTextAreaElement).value).toBe('甲')
    // 半截输入**一个字节都没提交出去**
    expect(wrapper.emitted('editText')).toBeUndefined()
  })

  it('选中那条才有分组开关，且它带自己的 testid（沿用 P1 的 `translation-group-N`）', () => {
    const selected = mountPane({ result: withPage(), entry: page, editingIndex: 1 })
    expect(selected.find('[data-testid="translation-group-1"]').exists()).toBe(true)

    const idle = mountPane({ result: withPage(), entry: page })
    expect(idle.find('[data-testid="translation-group-1"]').exists()).toBe(false)
  })

  it('状态条**永远在、且高度固定**（这一行就是"不闪不抖"的保证）', () => {
    const idle = mountPane({ result: withPage(), entry: page })
    const busy = mountPane({ result: withPage(), entry: page, dirty: true, changedCount: 2 })

    // 两种状态**同一行、同一套类**（高度不可能变）—— 谁给它加 v-if / 条件高度，这条就红
    expect(idle.find('[data-testid="translation-status-bar"]').exists()).toBe(true)
    expect(busy.find('[data-testid="translation-status-bar"]').exists()).toBe(true)
    expect(idle.get('[data-testid="translation-status-bar"]').classes().sort()).toEqual(
      busy.get('[data-testid="translation-status-bar"]').classes().sort()
    )
    // 空闲时没有按钮；有改动时按钮才出现（它们靠 mr-auto 落在最右端，不推动左边的字）
    expect(idle.find('[data-testid="translation-save"]').exists()).toBe(false)
    expect(busy.find('[data-testid="translation-save"]').exists()).toBe(true)
  })

  it('没有未保存改动 ⇒ 徽标不出现', () => {
    const wrapper = mountPane({ result: withPage(), entry: page })
    expect(wrapper.find('[data-testid="translation-dirty-badge"]').exists()).toBe(false)
  })

  it('有未保存改动 ⇒ 草稿条 + 徽标出现，并写清"改了几条"', () => {
    const wrapper = mountPane({ result: withPage(), entry: page, dirty: true, changedCount: 2 })
    expect(wrapper.get('[data-testid="translation-status-bar"]').text()).toContain('已改 2 条')
    expect(wrapper.get('[data-testid="translation-dirty-badge"]').text()).toContain('未保存 2 条')
  })

  it('改过的那一条打记号，没改的不打（一看就知道动了哪几条）', () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      dirty: true,
      changedCount: 1,
      changedIndices: [2]
    })
    expect(wrapper.find('[data-testid="translation-row-changed-2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="translation-row-changed-1"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="translation-row-2"]').attributes('data-changed')).toBe('true')
    expect(wrapper.get('[data-testid="translation-row-1"]').attributes('data-changed')).toBe(
      'false'
    )
  })

  it('三个按钮各自 emit 自己的事件（组件不认识"保存去哪"这件事）', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page, dirty: true, changedCount: 1 })
    await wrapper.get('[data-testid="translation-undo"]').trigger('click')
    await wrapper.get('[data-testid="translation-discard"]').trigger('click')
    await wrapper.get('[data-testid="translation-save"]').trigger('click')

    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.emitted('discard')).toHaveLength(1)
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('保存中 ⇒ 保存按钮禁用并改写文案（防连点写两次）', () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      dirty: true,
      changedCount: 1,
      saving: true
    })
    const button = wrapper.get('[data-testid="translation-save"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toContain('保存中')
  })

  it('**鼠标划过（只高亮）不许展开编辑器** —— 这是真机上"一直闪"的根因', () => {
    const wrapper = mountPane({ result: withPage(), entry: page, activeIndex: 2 })
    expect(wrapper.find('[data-testid="translation-editor-2"]').exists()).toBe(false)
  })

  it('**双击**才 emit edit（单击只 pick，两个事件分开）', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page })
    const row = wrapper.get('[data-testid="translation-row-2"]')
    await row.trigger('click')
    await row.trigger('dblclick')

    expect(wrapper.emitted('pick')?.at(-1)).toEqual([2])
    expect(wrapper.emitted('edit')?.at(-1)).toEqual([2])
  })

  it('分组开关显示的是**草稿里的有效值**（不是文档里的旧值，否则一选就弹回去）', () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      editingIndex: 1,
      groupOverrides: { 1: '框外' }
    })
    const toggle = wrapper.get('[data-testid="translation-group-1"]')
    expect(toggle.text()).toContain('框外')
  })

  it('点一下开关 ⇒ 报上去的是**另一个分组的名字**（框内 ⇄ 框外，1 起按表里的位置）', async () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      editingIndex: 1,
      groups: ['框内', '框外']
    })
    // page 的第 1 条是「框内」⇒ 点一下该切到「框外」
    await wrapper.get('[data-testid="translation-group-1"] button[value="框外"]').trigger('click')

    expect(wrapper.emitted('editGroup')?.at(-1)).toEqual([1, '框外'])
  })

  it('**第三组及以后不给切换入口**：点它一个事件都不发，且显示的是**真实分组名**', async () => {
    const third = entry([{ index: 1, group: '旁白', text: '甲' }])
    const wrapper = mountPane({
      result: ok([third]),
      entry: third,
      editingIndex: 1,
      groups: ['框内', '框外', '旁白']
    })
    const shown = wrapper.get('[data-testid="translation-group-1"]')
    expect(shown.text()).toContain('旁白')

    await shown.trigger('click')
    // ⚠️ 这条是**负向锁**：宁可没有入口，也绝不做"一点就把旁白静默改成框内"
    expect(wrapper.emitted('editGroup')).toBeUndefined()
  })

  it('表里只有一组 ⇒ 也不给切换（没有"另一个"可切）', async () => {
    const one = entry([{ index: 1, group: '框内', text: '甲' }])
    const wrapper = mountPane({
      result: ok([one]),
      entry: one,
      editingIndex: 1,
      groups: ['框内']
    })
    await wrapper.get('[data-testid="translation-group-1"]').trigger('click')
    expect(wrapper.emitted('editGroup')).toBeUndefined()
  })

  it('保存反馈**并入状态条**（不另起一行 —— 另起一行就会让列表区变矮再变高）', () => {
    const idle = mountPane({ result: withPage(), entry: page })
    expect(idle.get('[data-testid="translation-status-text"]').text()).not.toContain('已保存')

    const withNotice = mountPane({
      result: withPage(),
      entry: page,
      notice: '已保存（写前已备份）'
    })
    expect(withNotice.get('[data-testid="translation-status-text"]').text()).toContain('已保存')
    // 反馈出现时**行数没变**（还是那一条状态条）
    expect(withNotice.findAll('[data-testid="translation-status-bar"]')).toHaveLength(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 第 2 批：两档开关（翻译 / 校对）＋ 校对记录（铅笔 / 上原下校 / 理由 / 导出）
// ══════════════════════════════════════════════════════════════════════════════

describe('第2批 · 档位：校对档是只读对照，双击才出编辑器', () => {
  const page = entry([
    { index: 1, group: '框内', text: '甲' },
    { index: 3, group: '框外', text: '丙' }
  ])
  const withPage = () => ok([page])
  const reviews = { 3: { originalText: '丙的原文', reason: '语气太软' } }

  it('翻译档 ⇒ 行上标着 data-readonly=false；校对过的条目**仍是单行**（不去展开两行）', () => {
    const wrapper = mountPane({ result: withPage(), entry: page, reviews, reviewCount: 1 })
    expect(wrapper.get('[data-testid="translation-row-1"]').attributes('data-readonly')).toBe(
      'false'
    )
    expect(wrapper.get('[data-testid="translation-row-3"]').attributes('data-reviewed')).toBe(
      'true'
    )
    // 翻译档**不显示**上原下校那两块
    expect(wrapper.find('[data-testid="translation-review-compare-3"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="translation-row-3"]').text()).toContain('丙')
  })

  it('校对档 ⇒ 条目只读（data-readonly=true）**且一个输入框都没有**；双击才出编辑器', async () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      mode: 'review',
      reviews,
      reviewCount: 1
    })
    expect(wrapper.get('[data-testid="translation-row-3"]').attributes('data-readonly')).toBe(
      'true'
    )
    // 只读 = 页面上一个可打字的地方都没有（理由编辑器也没打开）
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('[data-testid="translation-editor-3"]').exists()).toBe(false)

    await wrapper.get('[data-testid="translation-row-3"]').trigger('dblclick')
    expect(wrapper.emitted('edit')?.at(-1)).toEqual([3])
    // 编辑器由**父层**决定开不开（`editing-index`）：双击只是把请求发上去
    const opened = mountPane({
      result: withPage(),
      entry: page,
      mode: 'review',
      reviews,
      editingIndex: 3
    })
    expect(opened.find('[data-testid="translation-editor-3"]').exists()).toBe(true)
    expect(opened.get('[data-testid="translation-textarea-3"]').element).toBeTruthy()
  })
})

describe('第2批 · 上原下校：有记录两行 + 一条细分割线，没记录一行', () => {
  function reviewPage(): LabelPlusImageEntry {
    return entry([
      { index: 1, group: '框内', text: '甲' },
      { index: 3, group: '框外', text: '丙（校过的样子）' },
      { index: 6, group: '框内', text: '漏翻那条的校文' }
    ])
  }
  function mountReview() {
    const page = reviewPage()
    return mountPane({
      result: ok([page]),
      entry: page,
      mode: 'review',
      reviews: {
        3: { originalText: '丙（原文）', reason: '语气太软' },
        6: { originalText: '', reason: '' }
      },
      reviewCount: 2
    })
  }

  it('没记录的条目 ⇒ 一行，**没有分割线**（不能把"没校对过"画成"校对成一样"）', () => {
    const wrapper = mountReview()
    expect(wrapper.find('[data-testid="translation-review-compare-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="translation-review-divider-1"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="translation-row-1"]').text()).toContain('甲')
  })

  it('有记录的条目 ⇒ 「翻：」在上、「校：」在下，中间恰好一条细分割线', () => {
    const wrapper = mountReview()
    const row = wrapper.get('[data-testid="translation-row-3"]')
    expect(row.get('[data-testid="translation-review-original-3"]').text()).toBe('翻：丙（原文）')
    expect(row.get('[data-testid="translation-review-reviewed-3"]').text()).toBe(
      '校：丙（校过的样子）'
    )
    expect(row.findAll('[data-testid="translation-review-divider-3"]')).toHaveLength(1)
    // 上下顺序：原文那行在前
    const html = row.html()
    expect(html.indexOf('translation-review-original-3')).toBeLessThan(
      html.indexOf('translation-review-reviewed-3')
    )
    // 「翻」用弱化色、「校」加重（用户拍板：线以上弱、线以下重）
    expect(row.get('[data-testid="translation-review-original-3"]').classes()).toContain(
      'text-text-tertiary'
    )
    expect(row.get('[data-testid="translation-review-reviewed-3"]').classes()).toContain(
      'text-text-primary'
    )
  })

  it('原文为空 ⇒ 「翻：」那一行**恰好**是漏翻那句（与导出同一句文案）', () => {
    const wrapper = mountReview()
    expect(wrapper.get('[data-testid="translation-review-original-6"]').text()).toBe(
      `翻：${REVIEW_MISSING_ORIGINAL}`
    )
    expect(REVIEW_MISSING_ORIGINAL).toBe('（无 —— 翻译漏了这处）')
  })
})

describe('第2批 · 行首铅笔：只有校对过的条目有；点它写理由、悬停才浮现理由', () => {
  const page = entry([
    { index: 1, group: '框内', text: '甲' },
    { index: 3, group: '框外', text: '丙' }
  ])
  const withPage = () => ok([page])
  const reviews = { 3: { originalText: '丙的原文', reason: '语气太软，改成肯定句' } }
  const mountWith = (extra: Record<string, unknown> = {}) =>
    mountPane({ result: withPage(), entry: page, reviews, reviewCount: 1, ...extra })

  it('**只有**校对过的条目有铅笔（没校对过的行连按钮都没有）', () => {
    const wrapper = mountWith()
    expect(wrapper.find('[data-testid="translation-review-icon-3"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="translation-review-icon-1"]').exists()).toBe(false)
    // 那一格每行都在（等宽空档）—— 不然一出现第一条记录，整页文字会集体右移
    expect(wrapper.find('[data-testid="translation-review-gutter-1"]').exists()).toBe(true)
    // 铅笔在**行尾那一格**（用户 2026-10-06 真机截图里框定的位置：贴着「校」那一格）
    const html = wrapper.html()
    expect(html.indexOf('translation-review-icon-3')).toBeGreaterThan(
      html.indexOf('translation-row-3')
    )
  })

  /**
   * 铅笔三态（**2026-10-07 用户拍板，方案 G**）
   *
   * 用户原话要的是"**已有理由这个状态可见**"。做法是让**图标本身**的形状说话
   * （空心 ↔ 实心），而不是把它升成强色、也不是在旁边再加一个图形：
   *
   * | 态 | 什么时候 | 长什么样 |
   * |---|---|---|
   * | **① 编辑中**（既有） | 正点开理由编辑器 | **实心 accent 底 + 白字**（`bg-accent` / `text-text-on-accent`） |
   * | **② 有理由**（新） | 这条写了理由 | **淡紫底 + 主色**（`bg-primary-soft` / `text-accent`）＋ **铅笔实心**（`fill-current`） |
   * | **③ 没理由**（新） | 校过但没写 | **无底、中性色**（`bg-transparent` / `text-text-tertiary`）＋ **铅笔只有线条**（`fill-none`） |
   *
   * ⚠️ 为什么"有理由"仍保持**淡紫底**（而不是升成强色）：三级按钮语言里主色实心是**最高级**
   * ——全栏只有「保存」一枚实心；一个弱入口变成主色会跟保存抢重量。这一条与用户选中方案 G 的理由一致。
   */
  it('① 编辑中（既有态没被改坏）：实心 accent 底 + 白字', async () => {
    const wrapper = mountWith()
    // 走**真实交互**打开理由编辑器（点铅笔），不新加测试专用入口
    await wrapper.get('[data-testid="translation-review-icon-3"]').trigger('click')
    const pencil = wrapper.get('[data-testid="translation-review-icon-3"]')
    expect(pencil.classes()).toContain('bg-accent')
    expect(pencil.classes()).toContain('text-text-on-accent')
  })

  it('② **有理由** ⇒ 淡紫底 + 主色 + **铅笔实心**（形状在说话）', () => {
    const wrapper = mountWith()
    const pencil = wrapper.get('[data-testid="translation-review-icon-3"]')
    expect(pencil.classes()).toContain('bg-primary-soft')
    expect(pencil.classes()).toContain('text-accent')
    // 20px 见方（命中区与这一栏其余图标同档）
    expect(pencil.classes()).toContain('h-5')
    expect(pencil.classes()).toContain('w-5')
    // 它**不该**跟着行悬停才出现：进门动作一直在（"方案二"的规矩）
    expect(pencil.classes()).not.toContain('opacity-40')
    // **实心**：这一笔才是"有理由"的形状线索
    expect(pencil.get('svg').classes()).toContain('fill-current')
    expect(pencil.get('svg').classes()).not.toContain('fill-none')
  })

  it('③ **没理由** ⇒ 无底、中性色、**铅笔只有线条**（空心）', () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      reviews: { 3: { originalText: '丙的原文', reason: '' } },
      reviewCount: 1
    })
    const pencil = wrapper.get('[data-testid="translation-review-icon-3"]')

    expect(pencil.classes()).toContain('bg-transparent')
    expect(pencil.classes()).toContain('text-text-tertiary')
    // 不许再是"有理由"那一套
    expect(pencil.classes()).not.toContain('bg-primary-soft')
    expect(pencil.classes()).not.toContain('text-accent')
    // **空心**：只有描边
    expect(pencil.get('svg').classes()).toContain('fill-none')
    expect(pencil.get('svg').classes()).not.toContain('fill-current')
  })

  it('③ 补：**没理由**时铅笔仍然在、仍然点得动（只是长得更淡）—— 入口不许消失', () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      reviews: { 3: { originalText: '丙的原文', reason: '   ' } },
      reviewCount: 1
    })
    // `get()` 找不到就会抛 ⇒ 能读到它本身就是"入口还在"
    const pencil = wrapper.get('[data-testid="translation-review-icon-3"]')
    // 全空白理由也算"没理由"（`reasonFor` 会 trim）
    expect(pencil.get('svg').classes()).toContain('fill-none')
  })

  /**
   * **2026-10-07 用户拍板（方向 B）：删掉"悬停浮现理由"那个自定义浮层。**
   *
   * 为什么：悬停铅笔时**同时**弹出两样东西 —— 浏览器自带的原生提示（铅笔的 `title`）
   * 与这个自定义小盒子，**同一句话画了两遍**，是纯视觉噪音。
   * 保留原生那一个（它**键盘 Tab 聚焦时也会弹**，键盘用户照样看得到全文）。
   *
   * ⇒ 这条是**负向锁**：那个浮层**永远不许再出现**（加回来就红）。
   * 全文的出口只剩两个：铅笔的原生提示（悬停/聚焦）+ 点开编辑器（点击）。
   */
  it('负向锁：理由浮层**永远不许再出现**（悬停也不许，加回来就红）', async () => {
    const wrapper = mountWith()
    const pencil = wrapper.get('[data-testid="translation-review-icon-3"]')
    await pencil.trigger('pointerenter')
    await pencil.trigger('focus')
    expect(wrapper.find('[data-testid^="translation-reason-popover-"]').exists()).toBe(false)
    // 全文仍然拿得到 —— 走铅笔的原生提示（悬停 / 键盘聚焦都会弹）
    expect(pencil.attributes('title')).toContain('语气太软，改成肯定句')
  })

  it('**点**铅笔 ⇒ 打开理由编辑器；提交时 emit editReason(编号, 理由)', async () => {
    const wrapper = mountWith()
    expect(wrapper.find('[data-testid="translation-reason-editor-3"]').exists()).toBe(false)

    await wrapper.get('[data-testid="translation-review-icon-3"]').trigger('click')
    const textarea = wrapper.get('[data-testid="translation-reason-textarea-3"]')
    // 打开时带出记录里已有的理由（不是空白框）
    expect((textarea.element as HTMLTextAreaElement).value).toBe('语气太软，改成肯定句')

    await textarea.setValue('这句我改的是主语')
    await textarea.trigger('change')
    expect(wrapper.emitted('editReason')?.at(-1)).toEqual([3, '这句我改的是主语'])
  })

  it('理由编辑器里明说"不会写进 txt"（用户最该知道的一句）', async () => {
    const wrapper = mountWith()
    await wrapper.get('[data-testid="translation-review-icon-3"]').trigger('click')
    expect(wrapper.get('[data-testid="translation-reason-editor-3"]').text()).toContain(
      '不会写进 txt'
    )
  })

  it('校对过但**没写理由**的条目：铅笔在（"没理由"该长什么样见上面那组三态锁）', () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      reviews: { 3: { originalText: '丙的原文', reason: '' } },
      reviewCount: 1
    })
    expect(wrapper.find('[data-testid="translation-review-icon-3"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid^="translation-reason-popover-"]').exists()).toBe(false)
  })
})

describe('第2批 · 导出入口：**仅校对档出现**，点开才出菜单', () => {
  const page = entry([{ index: 1, group: '框内', text: '甲' }])
  const withPage = () => ok([page])

  it('翻译档**没有**那枚按钮（负向锁）', () => {
    const wrapper = mountPane({ result: withPage(), entry: page, reviewCount: 3 })
    expect(wrapper.find('[data-testid="translation-review-export"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="translation-review-menu"]').exists()).toBe(false)
  })

  it('校对档有，且写着「已校：N」；菜单**默认是关着的**', () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      mode: 'review',
      reviewCount: 3
    })
    const button = wrapper.get('[data-testid="translation-review-export"]')
    expect(button.text()).toContain('修改记录')
    // 计数从"已校：3"改成**小徽章**（方案 C 的写法：数字在淡紫圆片里，用 accent 色）
    expect(wrapper.get('[data-testid="translation-review-count"]').text()).toBe('3')
    expect(wrapper.get('[data-testid="translation-review-count"]').classes()).toContain(
      'bg-primary-soft'
    )
    expect(wrapper.find('[data-testid="translation-review-menu"]').exists()).toBe(false)
  })

  it('点一下开菜单（里面是「导出校对记录…」），再点菜单项 ⇒ emit exportReviews 并关掉菜单', async () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      mode: 'review',
      reviewCount: 3
    })
    await wrapper.get('[data-testid="translation-review-export"]').trigger('click')
    const menu = wrapper.get('[data-testid="translation-review-menu"]')
    expect(menu.text()).toContain('导出校对记录…')

    await wrapper.get('[data-testid="translation-review-export-action"]').trigger('click')
    expect(wrapper.emitted('exportReviews')).toHaveLength(1)
    expect(wrapper.find('[data-testid="translation-review-menu"]').exists()).toBe(false)
  })

  it('按 Esc 关菜单；点到页头外面也关（不留下一个悬着的浮层）', async () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      mode: 'review',
      reviewCount: 1
    })
    await wrapper.get('[data-testid="translation-review-export"]').trigger('click')
    await wrapper.get('[data-testid="translation-review-export"]').trigger('keydown.esc')
    expect(wrapper.find('[data-testid="translation-review-menu"]').exists()).toBe(false)

    await wrapper.get('[data-testid="translation-review-export"]').trigger('click')
    expect(wrapper.find('[data-testid="translation-review-menu"]').exists()).toBe(true)
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="translation-review-menu"]').exists()).toBe(false)
  })
})

describe('第3批 · 「另存…」：永远在状态条右端，点一下只把事报上去', () => {
  const page = entry([{ index: 1, group: '框内', text: '甲' }])
  const withPage = () => ok([page])

  it('它搬进了**页头那条连体工具条**（用户选定"方案 C"），两种档位都在', () => {
    for (const mode of ['translate', 'review'] as const) {
      const wrapper = mountPane({ result: withPage(), entry: page, mode })
      const tools = wrapper.get('[data-testid="translation-header-tools"]')
      expect(tools.get('[data-testid="translation-save-as"]').text()).toContain('另存')
      // ⚠️ 负向锁：状态条里**不许**再有这枚常驻按钮（那一行回归"纯状态"）
      expect(
        wrapper
          .get('[data-testid="translation-status-bar"]')
          .find('[data-testid="translation-save-as"]')
          .exists()
      ).toBe(false)
      // 状态条还是**一条固定高度**的行
      expect(wrapper.findAll('[data-testid="translation-status-bar"]')).toHaveLength(1)
    }
  })

  it('读不到译文时它也在（空态下更该留一条出口：把这一话另存成一份空底稿）', () => {
    const wrapper = mountPane({
      result: {
        status: 'not-found',
        file: null,
        txtCount: 0,
        message: '话目录里没有 .txt 文件',
        document: null
      },
      entry: null
    })
    expect(wrapper.find('[data-testid="translation-save-as"]').exists()).toBe(true)
  })

  it('点一下 ⇒ emit saveAs（弹框那件事由父层做，组件层不认识文件系统）', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page })
    await wrapper.get('[data-testid="translation-save-as"]').trigger('click')
    expect(wrapper.emitted('saveAs')).toHaveLength(1)
  })

  it('有未保存改动时：另存与撤销 / 放弃 / 保存**同时在**，谁也不挡谁', () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      dirty: true,
      changedCount: 1
    })
    expect(wrapper.find('[data-testid="translation-save-as"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="translation-undo"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="translation-save"]').exists()).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 第 4 批：行高固定 / 选中态看得见 / 断句还原 / 撤销校对（**右键菜单**）/ 编辑态收口
// ══════════════════════════════════════════════════════════════════════════════

describe('第4批 · 两条横条高度固定（切档位不许跳）', () => {
  const page = entry([{ index: 1, group: '框内', text: '甲' }])

  it('前半「已校 ② ▾」是**收窄过的**（`px-1.5` / `gap-0.5` / 徽章 14px），与后半「另存」等宽', () => {
    const wrapper = mountPane({ result: ok([page]), entry: page, mode: 'review', reviewCount: 2 })
    const seg = wrapper.get('[data-testid="translation-review-export"]')
    expect(seg.classes()).toContain('px-1.5')
    expect(seg.classes()).toContain('gap-0.5')
    expect(seg.classes()).not.toContain('px-2.5')
    expect(seg.classes()).not.toContain('gap-1')
    expect(wrapper.get('[data-testid="translation-review-count"]').classes()).toContain('h-[14px]')
  })

  it('**没有未保存改动时，状态条里一个按钮都没有**（"纯状态"—— 另存搬去页头了）', () => {
    const wrapper = mountPane({ result: ok([page]), entry: page })
    expect(wrapper.get('[data-testid="translation-status-bar"]').findAll('button')).toHaveLength(0)
  })
})

describe('第4批 · 选中态：持久选中的 token + 左侧竖条 + 字重（日间也看得见）', () => {
  const page = entry([
    { index: 1, group: '框内', text: '甲' },
    { index: 4, group: '框外', text: '乙' }
  ])

  it('选中的那条用 bg-selected-bg（持久选中）而不是 bg-card-bg-hover（悬停）', () => {
    const wrapper = mountPane({ result: ok([page]), entry: page, activeIndex: 4 })
    const active = wrapper.get('[data-testid="translation-row-4"]')
    expect(active.classes()).toContain('bg-selected-bg')
    expect(active.classes()).not.toContain('bg-card-bg-hover')
    expect(active.classes()).toContain('border-accent')
    expect(active.classes()).toContain('font-medium')
  })

  it('没选中的行留**透明**左边框（有 2px 边框才不会一选就整行位移）', () => {
    const wrapper = mountPane({ result: ok([page]), entry: page, activeIndex: 4 })
    const idle = wrapper.get('[data-testid="translation-row-1"]')
    expect(idle.classes()).toContain('border-transparent')
    expect(idle.classes()).toContain('hover:bg-card-bg-hover')
    expect(idle.classes()).not.toContain('bg-selected-bg')
  })

  it('整栏是**白面板**（bg-card-bg）：日间"灰画布 + 白面板"的惯例，也是选中/悬停看得见的前提', () => {
    const wrapper = mountPane({ result: ok([page]), entry: page })
    expect(wrapper.get('[data-testid="translation-pane"]').classes()).toContain('bg-card-bg')
  })
})

describe('第4批 · 断句还原：译文里的换行要真的换行', () => {
  const twoLine = entry([
    { index: 1, group: '框内', text: '第一句\n第二句' },
    { index: 4, group: '框外', text: '甲\n乙' }
  ])

  it('翻译档单行：文本节点里保留 \\n，且那块有 whitespace-pre-wrap', () => {
    const wrapper = mountPane({ result: ok([twoLine]), entry: twoLine })
    const row = wrapper.get('[data-testid="translation-row-1"]')
    expect(row.text()).toContain('第一句\n第二句')
    const textBlock = row.findAll('span').find((el) => el.text().includes('第一句'))
    expect(textBlock?.classes()).toContain('whitespace-pre-wrap')
  })

  it('校对档的「翻」「校」两行都保留换行', () => {
    const wrapper = mountPane({
      result: ok([twoLine]),
      entry: twoLine,
      mode: 'review',
      reviews: { 1: { originalText: '原文一\n原文二', reason: '' } },
      reviewCount: 1
    })
    expect(wrapper.get('[data-testid="translation-review-original-1"]').text()).toBe(
      '翻：原文一\n原文二'
    )
    expect(wrapper.get('[data-testid="translation-review-original-1"]').classes()).toContain(
      'whitespace-pre-wrap'
    )
    expect(wrapper.get('[data-testid="translation-review-reviewed-1"]').classes()).toContain(
      'whitespace-pre-wrap'
    )
  })

  /**
   * ⚠️ **2026-10-07 用户拍板（方向 B）**：原来这里锁的是"理由浮层保留换行"。
   * 浮层删掉之后，多行理由的**全文出口**只剩铅笔的原生提示（`title`）与点开的编辑器
   * ⇒ 这条锁改成"多行理由照样拿得到全文（走原生提示）"，并顺手钉住浮层不再出现。
   */
  it('多行理由照样拿得到全文：走铅笔的原生提示（浮层已删，负向钉住）', async () => {
    const wrapper = mountPane({
      result: ok([twoLine]),
      entry: twoLine,
      reviews: { 1: { originalText: '原文', reason: '第一行\n第二行' } },
      reviewCount: 1
    })
    const pencil = wrapper.get('[data-testid="translation-review-icon-1"]')
    await pencil.trigger('pointerenter')
    expect(pencil.attributes('title')).toContain('第一行\n第二行')
    expect(wrapper.find('[data-testid^="translation-reason-popover-"]').exists()).toBe(false)
  })
})

describe('第4批 · 撤销校对：**右键菜单**是唯一入口（✕ 按钮已于 2026-10-07 删除）', () => {
  const page = entry([
    { index: 1, group: '框内', text: '甲' },
    { index: 4, group: '框外', text: '乙' }
  ])
  const reviews = { 4: { originalText: '乙的原样', reason: '语气太软' } }
  const mountReviewed = (extra: Record<string, unknown> = {}) =>
    mountPane({ result: ok([page]), entry: page, reviews, reviewCount: 1, ...extra })

  it('**✕ 按钮已删除**（负向锁）：整栏一个 `translation-review-remove-*` 都不许有', () => {
    const wrapper = mountReviewed()
    expect(wrapper.find('[data-testid="translation-review-remove-4"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('translation-review-remove')
    // 那一格还在（等宽空档，文字不左右跳），里面装的是铅笔
    expect(wrapper.find('[data-testid="translation-review-gutter-4"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="translation-review-gutter-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="translation-review-icon-4"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="translation-review-icon-1"]').exists()).toBe(false)
  })

  it('行按钮的 title 里写着"右键可撤销校对"（✕ 删掉之后，这是入口还在的最低限度告知）', () => {
    const wrapper = mountReviewed()
    expect(wrapper.get('[data-testid="translation-row-4"]').attributes('title')).toContain(
      '右键可撤销校对'
    )
    // 没校对过的行不提这一句（它右键没菜单，提了就是骗人）
    expect(wrapper.get('[data-testid="translation-row-1"]').attributes('title')).not.toContain(
      '右键可撤销校对'
    )
  })

  it('铅笔落在**「校」那一格的右侧**：`self-stretch` + `items-end`，两个都必须在', () => {
    const wrapper = mountReviewed()
    const gutter = wrapper.get('[data-testid="translation-review-gutter-4"]')

    // ① **承重墙**：父级是 `items-start` ⇒ 这一格默认只有内容那么高，必须先撑满整行
    //    （少了它，下面的 `items-end` 是对着空气对齐 —— 真机现场"改了跟没改一样"就是这么来的）
    const rowLine = wrapper.get('[data-testid="translation-pane-body"] ul li > div')
    expect(rowLine.classes()).toContain('items-start')
    expect(gutter.classes()).toContain('self-stretch')

    // ② 撑满之后，靠底部对齐落到「校」那一格的高度上（行多高就多在下面）
    expect(gutter.classes()).toContain('items-end')
    // 只剩一枚铅笔 ⇒ 列宽收到 24px（正文因此白赚 20px），居中摆
    expect(gutter.classes()).toContain('w-6')
    expect(gutter.classes()).toContain('justify-center')

    // ③ 而且**不再是**顶部对齐（那正是真机里"像在撤【翻】"的那个位置）
    expect(gutter.classes()).not.toContain('pt-[7px]')
  })

  it('单行档位（翻译档）下铅笔也在：那时"校那一格"不存在，贴着这一行的右侧就对', () => {
    const wrapper = mountPane({
      result: ok([page]),
      entry: page,
      reviews,
      reviewCount: 1
    })
    expect(wrapper.find('[data-testid="translation-review-icon-4"]').exists()).toBe(true)
  })

  /**
   * 第 5 批 · 右键菜单**贴着你右键的那一行**出来（`top-full` = 这一行的底）。
   *
   * ⚠️ **2026-10-07 变更（用户拍板 A）**：这条锁原名"**两个**浮层都挂在行上" ——
   * 理由浮层按方向 B 删掉之后，只剩菜单这一个浮层，所以删掉浮层那半句。
   * 菜单那半句（DOM 归属）保留，并**加严**成"定位类的承重墙也在"：
   * 祖先带 `relative`、菜单自己带 `top-full` —— 少了任何一个，菜单就会掉到编辑器底下
   * （第 6 轮真机现场：菜单顶 603 = 编辑器底 607 − 4，鼠标得挪很远）。
   *
   * 📏 **数值口径由视觉工装量**（真浏览器 `getBoundingClientRect`，见 §"共用区①"那块面板
   * 与 `temp/probe-5e-shared.js`）：**菜单顶 = 行底 − 4px**（那 4px 是菜单自己的 `-mt-1`）。
   * 这里不量像素（jsdom 的 rect 全是 0），只钉住"贴行定位"这件事的两个结构条件。
   */
  it('第5批 · 右键菜单**贴着那一行**出来：祖先带 relative、菜单带 top-full（定位的承重墙）', async () => {
    const wrapper = mountPane({
      result: ok([page]),
      entry: page,
      reviews,
      reviewCount: 1,
      editingIndex: 4
    })
    const row = wrapper.get('[data-testid="translation-row-4"]')
    const anchor = row.element.parentElement as HTMLElement
    // 定位祖先是"行"那一层，而且它自己带 relative
    expect(anchor.contains(row.element)).toBe(true)
    expect(anchor.className).toContain('relative')

    await row.trigger('contextmenu')
    const menu = wrapper.get('[data-testid="translation-review-row-menu-4"]')
    expect(menu.element.parentElement).toBe(anchor) // 菜单挂在行上
    // ⚠️ 这两条是"贴行的底"的承重墙：`top-full` 指"定位祖宗的底"，
    //    少一个就会退回"挂到编辑器底下"那个真机 bug
    expect(menu.classes()).toContain('top-full')
    expect(menu.classes()).toContain('-mt-1')
  })

  /**
   * ⚠️ **2026-10-07（5e）语义变更，用户拍板**：菜单从"只有校对过的行才弹"改成
   * **"每行都弹；前两项只对校对过的行显示；删除译文每行都有"**。
   * 旧锁的语义（"没校对过 ⇒ 不弹"）已按新口径改写 —— 变异验证也照新语义重做
   * （见交接记录里 5e-4 那一节的 Q1/Q2）。
   */
  it('右键**校对过的**行 ⇒ 三项（含删除译文）；右键**没校对过**的行 ⇒ 也弹，但只有「删除译文」一项', async () => {
    const wrapper = mountReviewed()
    expect(wrapper.find('[data-testid="translation-review-row-menu-4"]').exists()).toBe(false)
    await wrapper.get('[data-testid="translation-row-4"]').trigger('contextmenu')
    const reviewed = wrapper.get('[data-testid="translation-review-row-menu-4"]')
    expect(reviewed.text()).toContain('撤销校对')
    expect(reviewed.text()).toContain('只删记录')
    expect(reviewed.text()).toContain('删除译文')
    expect(reviewed.findAll('[role="menuitem"]')).toHaveLength(3)

    // 换到"没校对过"的那一行：菜单**照弹**，但只有删除那一项
    await wrapper.get('[data-testid="translation-row-1"]').trigger('contextmenu')
    const plain = wrapper.get('[data-testid="translation-review-row-menu-1"]')
    expect(plain.findAll('[role="menuitem"]')).toHaveLength(1)
    expect(plain.text()).toContain('删除译文')
    expect(wrapper.find('[data-testid="translation-review-row-unreview-1"]').exists()).toBe(false)
    // 而且原来那个菜单也收掉了（同一时刻只弹一个）
    expect(wrapper.find('[data-testid="translation-review-row-menu-4"]').exists()).toBe(false)
  })

  it('菜单第一项 ⇒ emit unreview；第二项 ⇒ emit dropReview；两项都顺手关菜单', async () => {
    const wrapper = mountReviewed()
    await wrapper.get('[data-testid="translation-row-4"]').trigger('contextmenu')
    await wrapper.get('[data-testid="translation-review-row-unreview-4"]').trigger('click')
    expect(wrapper.emitted('unreview')?.at(-1)).toEqual([4])
    expect(wrapper.find('[data-testid="translation-review-row-menu-4"]').exists()).toBe(false)

    await wrapper.get('[data-testid="translation-row-4"]').trigger('contextmenu')
    await wrapper.get('[data-testid="translation-review-row-drop-4"]').trigger('click')
    expect(wrapper.emitted('dropReview')?.at(-1)).toEqual([4])
    expect(wrapper.find('[data-testid="translation-review-row-menu-4"]').exists()).toBe(false)
  })

  it('点菜单外面 / Esc 都能收（不留下一个悬着的浮层）', async () => {
    const wrapper = mountReviewed()
    await wrapper.get('[data-testid="translation-row-4"]').trigger('contextmenu')
    expect(wrapper.find('[data-testid="translation-review-row-menu-4"]').exists()).toBe(true)
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="translation-review-row-menu-4"]').exists()).toBe(false)

    await wrapper.get('[data-testid="translation-row-4"]').trigger('contextmenu')
    await wrapper.get('[data-testid="translation-pane"]').trigger('keydown.esc')
    expect(wrapper.find('[data-testid="translation-review-row-menu-4"]').exists()).toBe(false)
  })
})

describe('第4批 · 编辑态收口：点外面 / Esc 都要把它收掉', () => {
  const page = entry([{ index: 1, group: '框内', text: '甲' }])
  const withPage = () => ok([page])

  it('点击框外先保存，保存失败不关闭且草稿保留，重试成功才关闭', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page, editingIndex: 1 })
    await wrapper.get('[data-testid="translation-textarea-1"]').setValue('悬浮草稿')
    const outside = () => wrapper.findComponent({ name: 'PopoverContent' }).vm.$emit('interactOutside', new Event('pointerdown'))
    outside()
    expect(wrapper.emitted('closeEditor')).toBeUndefined()
    const call = wrapper.emitted('editText')!.at(-1)!
    expect(call.slice(0, 2)).toEqual([1, '悬浮草稿'])
    ;(call[2] as (saved: boolean) => void)(false)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('closeEditor')).toBeUndefined()
    expect((wrapper.get('[data-testid="translation-textarea-1"]').element as HTMLTextAreaElement).value).toBe('悬浮草稿')
    outside()
    ;(wrapper.emitted('editText')!.at(-1)![2] as (saved: boolean) => void)(true)
    expect(wrapper.emitted('closeEditor')).toHaveLength(1)
  })

  it('点编辑器**自己身上** ⇒ 不 emit（不然正在打的字会被自己的点击打断）', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page, editingIndex: 1 })
    await wrapper.get('[data-testid="translation-textarea-1"]').trigger('pointerdown')
    expect(wrapper.emitted('closeEditor')).toBeUndefined()
  })

  it('点**正在编辑的那一行** ⇒ 不 emit（那一下只是选中它）', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page, editingIndex: 1 })
    await wrapper.get('[data-testid="translation-row-1"]').trigger('pointerdown')
    expect(wrapper.emitted('closeEditor')).toBeUndefined()
  })



  it('第5批 · 但**焦点还落在编辑器内部**（去点分组开关）⇒ 不收：别打断"先改分组再接着打字"', async () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      editingIndex: 1,
      attachTo: document.body
    })
    // 模拟"焦点转到编辑器里的分组开关上"（blur 之后才落定，所以判据在下个宏任务里读）
    const toggle = wrapper.get('[data-testid="translation-group-1"] button').element as HTMLElement
    // ⚠️ 按**真实浏览器的顺序**来：先 blur（这一刻 activeElement 已经是 body），**随后**才落到分组开关上。
    //    所以判据不能当场读 activeElement（当场读必然误判成"点外面了"），必须等一个宏任务。
    await wrapper.get('[data-testid="translation-textarea-1"]').trigger('blur')
    toggle.focus()
    expect(document.activeElement).toBe(toggle)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.emitted('closeEditor')).toBeUndefined()
  })

  it('Esc ⇒ emit closeEditor', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page, editingIndex: 1 })
    await wrapper.get('[data-testid="translation-pane"]').trigger('keydown.esc')
    expect(wrapper.emitted('closeEditor')).toHaveLength(1)
  })

  it('理由编辑器：点外面**先提交再收**（收起是卸载，卸载不触发 blur ⇒ 不提交就丢字）', async () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      reviews: { 1: { originalText: '甲的原样', reason: '旧理由' } },
      reviewCount: 1
    })
    await wrapper.get('[data-testid="translation-review-icon-1"]').trigger('click')
    // ⚠️ **只发 `input`**（v-model 更新），**不发 `change` / 不 blur** ——
    // 模拟的正是"字打了、还没提交，这时点了别处"那一刻。
    // （`setValue()` 会顺手把 `change` 也发了 ⇒ 用它就测不到这条锁：那测的是 setValue。）
    const textarea = wrapper.get('[data-testid="translation-reason-textarea-1"]')
    ;(textarea.element as HTMLTextAreaElement).value = '刚敲的新理由'
    await textarea.trigger('input')
    expect(wrapper.emitted('editReason')).toBeUndefined()

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('editReason')?.at(-1)).toEqual([1, '刚敲的新理由'])
    expect(wrapper.find('[data-testid="translation-reason-editor-1"]').exists()).toBe(false)
  })

  it('理由没改动就收起 ⇒ **一次都不发**（免得白写一遍库）', async () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      reviews: { 1: { originalText: '甲的原样', reason: '旧理由' } },
      reviewCount: 1
    })
    await wrapper.get('[data-testid="translation-review-icon-1"]').trigger('click')
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('editReason')).toBeUndefined()
  })
})

/**
 * 2026-10-07：状态条那枚「本会话还有可退的保存」小标。
 *
 * 只表示**有/无** —— **不做步数显示、也不是按钮**（用户拍板）。
 * 那一行的高与静是"不闪不抖"的保证，所以它必须是一枚弱色小 span。
 */
describe('译文栏 · 回退保存的小标（只表示有/无）', () => {
  const page = entry([{ index: 1, group: '框内', text: '甲' }])
  const withPage = () => ok([page])

  it('本会话有可退的保存 ⇒ 状态条出现小标，而且它**不是按钮**', () => {
    const wrapper = mountPane({ result: withPage(), entry: page, canUndoSaved: true })

    const hint = wrapper.get('[data-testid="translation-undo-saved-hint"]')
    expect(hint.text()).toContain('可退')
    expect(hint.element.tagName).toBe('SPAN')
    // 它在状态条这一行里（不另起一行 ⇒ 不把列表区挤矮）
    expect(
      wrapper.get('[data-testid="translation-status-bar"]').element.contains(hint.element)
    ).toBe(true)
  })

  it('没有可退的保存 ⇒ 小标不出现（只有有/无两态）', () => {
    const wrapper = mountPane({ result: withPage(), entry: page, canUndoSaved: false })

    expect(wrapper.find('[data-testid="translation-undo-saved-hint"]').exists()).toBe(false)
  })

  it('**不做步数显示**：小标里一个数字都没有', () => {
    const wrapper = mountPane({ result: withPage(), entry: page, canUndoSaved: true })

    expect(wrapper.get('[data-testid="translation-undo-saved-hint"]').text()).not.toMatch(/\d/)
  })
})

/**
 * 第 5 批 5d-2（2026-10-07）：页头那枚「**新增框**」开关。
 *
 * 三条被锁住的东西（都是"改坏了会在真机上咬人"的那种）：
 * ① **默认关**；② **24px 档、不许撑高 `h-7` 那一行**；③ 点了 emit 出去、由父层接。
 * 另加一条结构性锁：**导出菜单不在 `overflow-x` 那个滚动容器里** ——
 * 在里面会被滚动容器的 `overflow-y`（CSS 规范：visible 与 auto 不能混用）裁掉。
 */
describe('译文栏 · 页头「新增框」开关', () => {
  const page = entry([{ index: 1, group: '框内', text: '甲' }])
  const withPage = () => ok([page])

  it('窄窗兜底：`overflow-x-auto` 挂在页头那一行上', () => {
    const wrapper = mountPane({ result: withPage(), entry: page })

    expect(wrapper.get('[data-testid="translation-pane-header"]').classes()).toContain(
      'overflow-x-auto'
    )
  })

  it('导出菜单挂在**滚动容器外面**（在里面会被 `overflow-y` 裁掉）', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page, mode: 'review' })

    // 先打开菜单
    await wrapper.get('[data-testid="translation-review-export"]').trigger('click')
    const menu = wrapper.get('[data-testid="translation-review-menu"]')
    const header = wrapper.get('[data-testid="translation-pane-header"]')
    const scroller = header.element

    // 断言 1：不是那个滚动容器的后代
    expect(scroller.contains(menu.element)).toBe(false)
    // 断言 2：但仍在页头那一块里（否则 `top-full` 的参照系就跑了）
    const headerBlock = wrapper.get('[data-testid="translation-pane-header-block"]')
    expect(headerBlock.element.contains(menu.element)).toBe(true)
    // 断言 3：还是绝对定位于"那一行的底"
    expect(menu.classes()).toContain('top-full')
  })
})

/**
 * 第 5 批 5e（2026-10-07）：**右栏行菜单的第三项「删除译文」** + **菜单改成每行都弹**。
 *
 * 用户拍板的定稿：
 * ① 前两项（撤销校对 / 只删记录）**只对校对过的行**显示 —— 它们本来就以"有校过"为前提；
 * ② **「删除译文」每行都有**（删的是这条译文，与"有没有校过"无关）；
 * ③ 文案短、**不带括号**，完整解释放 `title`（用户追的那条）；
 * ④ **没有可解析的 txt ⇒ 不出现**（没有文件就没有"这条译文"可删）。
 */
describe('译文栏 · 5e 删除译文（行菜单第三项）', () => {
  const page = entry([
    { index: 1, group: '框内', text: '第一句' },
    { index: 3, group: '框外', text: '第三句' }
  ])
  const withPage = () => ok([page])

  it('① 校对过的行：菜单**三项**，第三项是「删除译文」且**不带括号**、解释在 title 里', async () => {
    const wrapper = mountPane({
      result: withPage(),
      entry: page,
      reviews: { 1: { originalText: '原句', reason: '' } },
      reviewCount: 1
    })
    await wrapper.get('[data-testid="translation-row-1"]').trigger('contextmenu')

    const menu = wrapper.get('[data-testid="translation-review-row-menu-1"]')
    expect(menu.findAll('[role="menuitem"]')).toHaveLength(3)
    const del = wrapper.get('[data-testid="translation-row-delete-1"]')
    expect(del.text()).toBe('删除译文')
    expect(del.text()).not.toContain('（')
    expect(del.attributes('title')).toBeTruthy()
  })

  it('② **没校对过的行也弹菜单**，而且那行**只有**「删除译文」一项（前两项不出现）', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page, reviews: {}, reviewCount: 0 })
    await wrapper.get('[data-testid="translation-row-3"]').trigger('contextmenu')

    const menu = wrapper.get('[data-testid="translation-review-row-menu-3"]')
    expect(menu.findAll('[role="menuitem"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="translation-review-row-unreview-3"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="translation-review-row-drop-3"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="translation-row-delete-3"]').exists()).toBe(true)
  })

  it('③ 点「删除译文」⇒ emit `deleteEntry`（带那一条的序号），并把菜单收掉', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page })
    await wrapper.get('[data-testid="translation-row-3"]').trigger('contextmenu')
    await wrapper.get('[data-testid="translation-row-delete-3"]').trigger('click')

    expect(wrapper.emitted('deleteEntry')).toEqual([[3]])
    expect(wrapper.find('[data-testid="translation-review-row-menu-3"]').exists()).toBe(false)
  })

  it('④ **没有可解析的 txt ⇒ 一项都不出现**', async () => {
    // ⚠️ 这一条**天然成立**（不是靠额外的守卫）：条目清单来自 txt 自己解析出来的 `entry`，
    // 没有 txt ⇒ 没有 entry ⇒ 连行都不存在 ⇒ 自然点不出菜单。
    // 所以这里锁的是**结果**（整栏没有任何删除项），而不是某个 `v-if` 的写法。
    for (const result of [
      { status: 'not-found' as const, file: null, txtCount: 0, message: '没有', document: null },
      { status: 'error' as const, file: null, txtCount: 0, message: '读不了', document: null }
    ]) {
      const wrapper = mountPane({ result, entry: null, groups: [] })
      expect(wrapper.find('[data-testid^="translation-row-"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid^="translation-row-delete-"]').exists()).toBe(false)
    }
  })

  it('切页 / 换话时菜单**跟着关掉**（5e 新增的清理：菜单项都以条目序号为参数，跨页会指错条）', async () => {
    const wrapper = mountPane({ result: withPage(), entry: page })
    await wrapper.get('[data-testid="translation-row-3"]').trigger('contextmenu')
    expect(wrapper.find('[data-testid="translation-review-row-menu-3"]').exists()).toBe(true)

    // 换话 = 宿主给这一栏换一份文档（`result` 变了）
    await wrapper.setProps({ result: ok([page]), entry: page })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="translation-review-row-menu-3"]').exists()).toBe(false)
  })
})


describe('译文输入快捷保存', () => {
  it('输入框未失焦时 Ctrl+S 提交当前文字并阻止外层抢先保存', async () => {
    const page = entry([{ index: 1, group: '框内', text: '旧文字' }])
    const wrapper = mountPane({ result: ok([page]), entry: page, editingIndex: 1 })
    const input = wrapper.get('[data-testid="translation-textarea-1"]')
    await input.setValue('尚未失焦的新文字')
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    input.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('editText')?.at(-1)).toEqual([1, '尚未失焦的新文字'])
  })
})

it('whole-page completion changes review badges without fabricating correction records', async () => {
 const wrapper = mount(TranslationPane, { props: { loading: false, result: ok(), entry: entry([{ index: 1, group: '框内', text: '译文' }]), groups: ['框内','框外'], mode: 'review' } })
 expect(wrapper.get('[data-testid=translation-labels-1]').text()).toContain('未校')
 await wrapper.setProps({ pageReviewed: true })
 expect(wrapper.get('[data-testid=translation-labels-1]').text()).toContain('已校')
 expect(wrapper.find('[data-testid=translation-review-compare-1]').exists()).toBe(false)
 await wrapper.setProps({ pageReviewed: false })
 expect(wrapper.get('[data-testid=translation-labels-1]').text()).toContain('未校')
 await wrapper.setProps({ mode: 'translate', pageReviewed: true })
 expect(wrapper.get('[data-testid=translation-labels-1]').text()).not.toMatch(/已校|未校|待翻/)
 wrapper.unmount()
})
