// @vitest-environment jsdom
/**
 * 「刷新并检测新章节」弹窗的**透明度**（2026-10-05，方向 A 第③条）。
 *
 * 这个弹窗此前**没有直接测试**（只有 `useProjectSelfCheck.spec` 间接盖到状态机）。
 * 这里补两件事 —— 都是"那次 28 条误报"暴露出来的信息缺口：
 *
 *   ① **被跳过的已登记目录要说话**：它们被静默计数（`duplicatePaths`），弹窗只报
 *      "检测到 N 个新章节"。用户看不到"另外还有 3 个目录因为已登记被跳过"，
 *      也就无法判断"这次检测到底看全了没有"。
 *   ② **候选数量反常要提醒**：2026-10-04 现场一次报出 **28 条**，全是别人的作品。
 *      根错到高层时就是这个形状。这是**提醒**，不是替用户决策 —— 所以它
 *      **不许禁用导入按钮**（这条也写在用例里：提醒出现时按钮仍可点）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { config, enableAutoUnmount, mount } from '@vue/test-utils'
config.global.stubs.teleport = true
config.global.renderStubDefaultSlot = true
enableAutoUnmount(afterEach)
import SelfCheckDialog from '../SelfCheckDialog.vue'
import type {
  SelfCheckCandidate,
  SelfCheckPreviewResult,
  SelfCheckRenameHint
} from '@shared/ipc-api'

function candidate(index: number): SelfCheckCandidate {
  return {
    folderName: `新章节${index}`,
    folderPath: `D:\\漫画库\\作品\\新章节${index}`,
    chapterNumber: `${index}`,
    projectTitle: `新章节${index}`,
    conflict: 'none'
  }
}

function previewWith(count: number, duplicatePaths = 0): SelfCheckPreviewResult {
  return {
    canDetect: true,
    sourceRoot: 'D:\\漫画库\\作品',
    sourceRoots: ['D:\\漫画库\\作品'],
    candidates: Array.from({ length: count }, (_, index) => candidate(index + 1)),
    duplicatePaths
  }
}

function render(
  preview: SelfCheckPreviewResult,
  renameHints: Record<string, SelfCheckRenameHint> = {}
) {
  // ⚠️ 那几个默认值只在**运行时**有意义：`vue-tsc` 眼里它们仍是必填
  // （宿主 Project.vue 也是全部显式传）。少传会红在类型门上、而不是用例里 ——
  // 本文件第一版就是这么被 `vue-tsc` 抓住的（vitest 不做类型检查）。
  return mount(SelfCheckDialog, {
    props: {
      visible: true,
      busy: false,
      running: false,
      preview,
      sourceRoot: '',
      conflictActions: {},
      neverAsk: false,
      silentSelfCheck: false,
      renameHints
    }
  })
}

describe('SelfCheckDialog：跳过的已登记目录要说明白', () => {
  it('有目录因"已登记"被跳过时，明确报出条数', () => {
    const wrapper = render(previewWith(2, 3))

    const line = wrapper.find('[data-testid="self-check-skipped"]')
    expect(line.exists(), '被跳过的目录数没有告诉用户').toBe(true)
    expect(line.text()).toContain('3')
    expect(line.text()).toContain('已登记')
  })

  it('一个都没跳过时不写这句（别给用户一句"已跳过 0 个"的废话）', () => {
    const wrapper = render(previewWith(2, 0))
    expect(wrapper.find('[data-testid="self-check-skipped"]').exists()).toBe(false)
  })
})

describe('SelfCheckDialog：冲突行要说出"撞上的是哪一话"', () => {
  function conflictPreview(): SelfCheckPreviewResult {
    return {
      canDetect: true,
      sourceRoot: 'D:\\漫画库\\作品',
      sourceRoots: ['D:\\漫画库\\作品'],
      candidates: [
        {
          folderName: 'HIGH 08',
          folderPath: 'D:\\漫画库\\作品\\HIGH 08',
          chapterNumber: '8',
          projectTitle: 'HIGH 08',
          conflict: 'same-chapter',
          existingChapterNumber: '8',
          existingChapterTitle: '14歲 08',
          existingChapterPath: 'D:\\漫画库\\作品\\14歲 08'
        }
      ],
      duplicatePaths: 41
    }
  }

  /**
   * 2026-10-05 现场：用户库里同一个父级放着多部作品 + 同一系列的两套命名
   * （`… - 姐煩19` / `… - 戀上19`），"同集数"**不等于**同一话。
   * 所以提示只能报事实（哪一话占了号、它在哪），判断留给用户。
   */
  it('写出撞上的那一话的标题与路径', () => {
    const wrapper = render(conflictPreview())

    const line = wrapper.find('[data-testid="conflict-existing"]')
    expect(line.exists(), '冲突行没说出撞上的是哪一话').toBe(true)
    expect(line.text()).toContain('14歲 08')
    expect(line.text()).toContain('D:\\漫画库\\作品\\14歲 08')

    // 处理方式照旧可选，一个字不改
    expect(wrapper.find('[data-testid="conflict-second-version"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="conflict-skip"]').exists()).toBe(true)
    // 也不许趁机替用户下结论
    expect(wrapper.text()).not.toContain('同一话')
  })
})

describe('SelfCheckDialog：候选数量反常时提醒"扫描根可能选高了"', () => {
  it('恰好 20 条 ⇒ 提醒出现（阈值取 20：现场那次是 28 条）', () => {
    const wrapper = render(previewWith(20))

    const warning = wrapper.find('[data-testid="self-check-many-candidates"]')
    expect(warning.exists(), '20 条候选没有提醒 —— 阈值失效了？').toBe(true)
    expect(warning.text()).toContain('扫描')
  })

  it('19 条 ⇒ 不提醒（阈值是"从 20 条开始"，不是"大约 20 条"）', () => {
    const wrapper = render(previewWith(19))
    expect(wrapper.find('[data-testid="self-check-many-candidates"]').exists()).toBe(false)
  })

  it('提醒**只是提醒**：出现时导入按钮照样能点（不替用户做决定）', () => {
    const wrapper = render(previewWith(20))

    expect(wrapper.find('[data-testid="self-check-many-candidates"]').exists()).toBe(true)
    const confirm = wrapper.find('[data-testid="confirm-self-check-import"]')
    expect(confirm.exists()).toBe(true)
    expect(
      confirm.attributes('disabled'),
      '提醒变成了拦截 —— 那会挡住合法的批量导入'
    ).toBeUndefined()
  })

  it('候选很少时既不提醒、也不影响原有的"检测到 N 个新章节"', () => {
    const wrapper = render(previewWith(3))
    expect(wrapper.find('[data-testid="self-check-many-candidates"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('检测到')
    expect(wrapper.text()).toContain('3')
  })
})

/**
 * 认领（2026-10-05，R2）：本地文件夹改名后，注册表里那话的旧路径不存在、
 * 改名后的文件夹成了"新章节候选"。用户在候选上指认"它其实是《…》"，
 * 程序**只把那一话的 folderPath 换成这个文件夹**（childId / 标记历史 / 进度都不动）。
 */
describe('SelfCheckDialog：认领（这不是新章节，它是…）', () => {
  function previewWithExisting(): SelfCheckPreviewResult {
    return {
      canDetect: true,
      sourceRoot: 'D:\\漫画库',
      sourceRoots: ['D:\\漫画库'],
      candidates: [
        {
          folderName: '新名字 19',
          folderPath: 'D:\\漫画库\\新名字 19',
          chapterNumber: '19',
          projectTitle: '新名字 19',
          conflict: 'none'
        }
      ],
      duplicatePaths: 0,
      existingChapters: [
        {
          id: 'c-old',
          chapterNumber: '19',
          projectTitle: '旧名字 19',
          folderPath: 'D:\\漫画库\\旧名字 19',
          missing: true
        },
        {
          id: 'c-other',
          chapterNumber: '20',
          projectTitle: '另一话 20',
          folderPath: 'D:\\漫画库\\另一话 20',
          missing: false
        }
      ]
    }
  }

  it('每条候选都有认领入口，面板默认是收着的', () => {
    const wrapper = render(previewWithExisting())
    expect(wrapper.find('[data-testid="reclaim-toggle"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reclaim-panel"]').exists()).toBe(false)
  })

  it('面板列出既有话，并标出"目录不在"（这就是改名的第一线索）', async () => {
    const wrapper = render(previewWithExisting())
    await wrapper.find('[data-testid="reclaim-toggle"]').trigger('click')

    const options = wrapper.findComponent({ name: 'AppSelect' }).props('options').map((option: { label: string }) => option.label)
    expect(options.some((text) => text.includes('旧名字 19') && text.includes('目录不在'))).toBe(
      true
    )
    expect(options.some((text) => text.includes('另一话 20') && !text.includes('目录不在'))).toBe(
      true
    )
  })

  it('选了那一话再确认 ⇒ emit reclaim（候选路径 + 那一话的 id）', async () => {
    const wrapper = render(previewWithExisting())
    await wrapper.find('[data-testid="reclaim-toggle"]').trigger('click')
    wrapper.findComponent({ name: 'AppSelect' }).vm.$emit('update:modelValue', 'c-old')
    await wrapper.vm.$nextTick()

    const confirm = wrapper.find('[data-testid="reclaim-confirm"]')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')

    expect(wrapper.emitted('reclaim')?.[0]).toEqual(['D:\\漫画库\\新名字 19', 'c-old'])
  })

  it('没选人时确认是灰的（不许误认领）', async () => {
    const wrapper = render(previewWithExisting())
    await wrapper.find('[data-testid="reclaim-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="reclaim-confirm"]').attributes('disabled')).toBeDefined()
  })

  it('面板文案说清"只换门牌"，且不含 markdown 星号', async () => {
    const wrapper = render(previewWithExisting())
    await wrapper.find('[data-testid="reclaim-toggle"]').trigger('click')

    const text = wrapper.find('[data-testid="reclaim-panel"]').text()
    expect(text).toContain('标记')
    expect(text).not.toContain('**')
  })
})

/**
 * 「疑似改名」提示（2026-10-05，R1）。
 *
 * 触发条件只有一种："有旧话的目录已经不在"（那是改名的形状）—— 这时才给检测按钮，
 * 否则点了也检测不出东西，不如不显示（免得看起来像坏了）。
 */
describe('SelfCheckDialog：疑似改名（R1）', () => {
  function previewWith(missing: boolean): SelfCheckPreviewResult {
    return {
      canDetect: true,
      sourceRoot: 'D:\\漫画库',
      sourceRoots: ['D:\\漫画库'],
      candidates: [
        {
          folderName: '新名字 19',
          folderPath: 'D:\\漫画库\\新名字 19',
          chapterNumber: '19',
          projectTitle: '新名字 19',
          conflict: 'none'
        }
      ],
      duplicatePaths: 0,
      existingChapters: [
        {
          id: 'c-old',
          chapterNumber: '19',
          projectTitle: '旧名字 19',
          folderPath: 'D:\\漫画库\\旧名字 19',
          missing
        }
      ]
    }
  }

  it('有目录不在的旧话 ⇒ 出现「检查是不是改名」，点了 emit', async () => {
    const wrapper = render(previewWith(true))
    const button = wrapper.find('[data-testid="detect-renames"]')
    expect(button.exists()).toBe(true)

    await button.trigger('click')
    expect(wrapper.emitted('detectRenames')).toBeTruthy()
  })

  it('没有目录不在的旧话 ⇒ 不给这个按钮', () => {
    const wrapper = render(previewWith(false))
    expect(wrapper.find('[data-testid="detect-renames"]').exists()).toBe(false)
  })

  it('给了提示 ⇒ 写明"疑似是《…》改名了"，点"就是它"只**预填**、仍要用户确认', async () => {
    const hint: SelfCheckRenameHint = {
      folderPath: 'D:\\漫画库\\新名字 19',
      childId: 'c-old',
      chapterTitle: '旧名字 19',
      chapterNumber: '19'
    }
    const wrapper = render(previewWith(true), { [hint.folderPath]: hint })

    const box = wrapper.find('[data-testid="rename-hint"]')
    expect(box.exists()).toBe(true)
    expect(box.text()).toContain('旧名字 19')
    expect(box.text()).toContain('完全相同')

    // 直接点"就是它"**不会**直接认领（不替用户做决定）
    await wrapper.find('[data-testid="rename-hint-apply"]').trigger('click')
    expect(wrapper.emitted('reclaim')).toBeFalsy()

    // 面板已预选好那一话；用户点确认才真的 emit
    const confirm = wrapper.find('[data-testid="reclaim-confirm"]')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    expect(wrapper.emitted('reclaim')?.[0]).toEqual([hint.folderPath, 'c-old'])
  })
})
