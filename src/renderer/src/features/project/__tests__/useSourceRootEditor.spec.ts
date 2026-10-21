// @vitest-environment jsdom
/**
 * 「修改扫描目录」（2026-10-05，需求二）背后的规则与状态机。
 *
 * 这一片锁盯四件事（每一件都对应一个真会咬人的坑）：
 *   ① **折算规则**：勾了层就用那些层、一层没勾就用所选目录本身、选"恢复自动推导"就写 `null`；
 *   ② **冲突判据**：用 `@shared/source-roots` 的 `findOtherParentInside`（与主进程 B1 同一把尺子）——
 *      "别的作品的话在我选的目录里"要拦，"**自己的**话在里面"绝不能拦（那是扫描根的**正常形态**）；
 *   ③ **载荷是普通数组**：Electron 的结构化克隆过不了 Vue 响应式代理
 *      （2026-09-23 那次「An object could not be cloned」就是这么来的）；
 *   ④ **默认不替用户做决定**：有冲突时默认不许存，用户显式"我知道"之后才放行。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from '@renderer/stores/toast'
import type { ParentProject } from '@shared/types'
import {
  findRootConflicts,
  planSourceRootEdit,
  toWritePayload,
  useSourceRootEditor
} from '../useSourceRootEditor'

function childOf(parentTitle: string, folderPath: string) {
  return {
    id: `c-${folderPath}`,
    parentTitle,
    folderPath,
    chapterNumber: '',
    projectTitle: folderPath.split(/[\\/]/).pop() ?? '',
    lastMtimeMs: 0
  }
}

function work(id: string, title: string, childPaths: string[]): ParentProject {
  return {
    id,
    title,
    lastMtimeMs: 0,
    children: childPaths.map((p) => childOf(title, p))
  }
}

const SELF = work('p-self', '老师的人偶', ['D:\\漫画库\\嵌字\\老师的人偶（米饭\\老师的人偶5卷'])
const MAMA = work('p-mamaA', '某作品A', ['D:\\漫画库\\嵌字\\某作品A\\第1话'])
const NORDIC = work('p-nordic', '某作品C', ['Z:\\外部盘\\某作品C\\第1话'])

describe('planSourceRootEdit —「改成什么」的折算规则', () => {
  it('选"恢复自动推导" ⇒ auto（写库时对应 null）', () => {
    expect(planSourceRootEdit({ mode: 'auto', directory: 'D:\\随手填的', layers: [] })).toEqual({
      kind: 'auto'
    })
  })

  it('勾了层 ⇒ 就用那些层（保持勾选顺序，多选照原样）', () => {
    expect(
      planSourceRootEdit({
        mode: 'manual',
        directory: 'D:\\漫画库\\作品',
        layers: ['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有']
      })
    ).toEqual({ kind: 'roots', roots: ['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有'] })
  })

  it('一层都没勾 ⇒ 就用所选目录本身（"各话直接放在这一层"的布局）', () => {
    expect(
      planSourceRootEdit({ mode: 'manual', directory: '  D:\\漫画库\\作品  ', layers: [] })
    ).toEqual({ kind: 'roots', roots: ['D:\\漫画库\\作品'] })
  })

  it('选了手动但目录是空的 ⇒ invalid（不能悄悄当成"清空"）', () => {
    expect(planSourceRootEdit({ mode: 'manual', directory: '   ', layers: [] })).toEqual({
      kind: 'invalid',
      reason: 'no-directory'
    })
  })

  it('写库载荷：恢复自动推导给 null，手选给那一批根', () => {
    expect(toWritePayload({ kind: 'auto' })).toBeNull()
    expect(toWritePayload({ kind: 'roots', roots: ['D:\\漫画库\\作品\\无'] })).toEqual([
      'D:\\漫画库\\作品\\无'
    ])
  })
})

describe('findRootConflicts — 哪些根里住着别的作品', () => {
  const projects = [SELF, MAMA, NORDIC]

  it('别的作品的话在根下面 ⇒ 报出那一部（能直接说出名字）', () => {
    const conflicts = findRootConflicts(['D:\\漫画库\\嵌字'], 'p-self', projects)
    expect(conflicts).toEqual([
      { root: 'D:\\漫画库\\嵌字', parentId: 'p-mamaA', parentTitle: '某作品A' }
    ])
  })

  it('**自己的**话在根下面 ⇒ 不算冲突（扫描根本来就是各话的上一层）', () => {
    const conflicts = findRootConflicts(['D:\\漫画库\\嵌字\\老师的人偶（米饭'], 'p-self', projects)
    expect(conflicts).toEqual([])
  })

  it('别的作品的章节在另一个盘 ⇒ 不算冲突（跨盘不连坐）', () => {
    expect(findRootConflicts(['D:\\漫画库\\嵌字'], 'p-self', [SELF, NORDIC])).toEqual([])
  })

  it('多个根各自判：坏的那几个会被逐条报出来', () => {
    const conflicts = findRootConflicts(
      ['D:\\漫画库\\嵌字\\老师的人偶（米饭', 'D:\\漫画库\\嵌字'],
      'p-self',
      projects
    )
    expect(conflicts.map((c) => c.root)).toEqual(['D:\\漫画库\\嵌字'])
    expect(conflicts[0].parentTitle).toBe('某作品A')
  })
})

/* ───────────────────────── 组合式函数（真调 IPC 的状态机） ───────────────────────── */

const PREVIEW = {
  canDetect: true,
  sourceRoot: 'D:\\漫画库\\嵌字\\老师的人偶（米饭',
  sourceRoots: ['D:\\漫画库\\嵌字\\老师的人偶（米饭'],
  candidates: [
    {
      folderName: '老师的人偶6卷',
      folderPath: 'D:\\漫画库\\嵌字\\老师的人偶（米饭\\老师的人偶6卷',
      chapterNumber: '6',
      projectTitle: '老师的人偶6卷',
      conflict: 'none' as const
    }
  ],
  duplicatePaths: 2
}

function setupComicType(options?: { remembered?: boolean }): {
  setRoots: ReturnType<typeof vi.fn>
  listDir: ReturnType<typeof vi.fn>
  pickDirectory: ReturnType<typeof vi.fn>
} {
  const setRoots = vi.fn().mockResolvedValue(undefined)
  const listDir = vi.fn().mockResolvedValue([
    { name: '无', isDirectory: true, absPath: 'E:\\搬砖\\无' },
    { name: '有', isDirectory: true, absPath: 'E:\\搬砖\\有' },
    { name: '封面.jpg', isDirectory: false, absPath: 'E:\\搬砖\\封面.jpg' }
  ])
  const pickDirectory = vi.fn().mockResolvedValue('E:\\搬砖')
  window.comicType = {
    selfCheckPreview: vi.fn().mockResolvedValue(PREVIEW),
    listDir,
    pickDirectory,
    projectSetParentSourceRoots: setRoots
  } as unknown as typeof window.comicType
  void options
  return { setRoots, listDir, pickDirectory }
}

function parent(extra?: Partial<ParentProject>): ParentProject {
  return { ...SELF, ...extra }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

it('切换目录后忽略迟到的旧列表和旧错误', async () => {
  const { listDir } = setupComicType()
  const editor = useSourceRootEditor({ projects: () => [], refreshAfterSave: async () => {} })
  let resolveOld!: (value: unknown[]) => void
  listDir.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      })
  )
  editor.setDirectory('A')
  const pending = editor.loadLayers()
  editor.setDirectory('B')
  await editor.loadLayers()
  const current = [...editor.layers.value]
  resolveOld([{ name: '旧目录', isDirectory: true, absPath: 'A/旧目录' }])
  await pending
  expect(editor.layers.value).toEqual(current)

  let rejectOld!: (reason: Error) => void
  listDir.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject
      })
  )
  const failed = editor.loadLayers()
  editor.setDirectory('C')
  rejectOld(new Error('旧目录不可读'))
  await failed
  expect(editor.layerError.value).toBe('')
  expect(editor.layers.value).toEqual([])
})

describe('useSourceRootEditor — 打开时把"当前"摆出来', () => {
  it('打开先问主进程"当前实际会扫哪儿"，并说明来源是记住的还是自动推导', async () => {
    setupComicType()
    const editor = useSourceRootEditor({
      projects: () => [parent(), MAMA],
      refreshAfterSave: async () => undefined
    })

    await editor.open(parent())
    expect(window.comicType.selfCheckPreview).toHaveBeenCalledWith('p-self')
    expect(editor.currentRoots.value).toEqual(['D:\\漫画库\\嵌字\\老师的人偶（米饭'])
    expect(editor.currentIsRemembered.value).toBe(false)
    expect(editor.currentCandidateCount.value).toBe(1)
    expect(editor.acknowledged.value).toBe(false)
  })

  /**
   * ⚠️ 这条盯的是一个**很容易犯的错**：打开弹窗就默认成"恢复自动推导"的话，
   * 用户随手一点"保存"就把记住过的目录清了（真数据丢失）。所以初始状态必须是
   * "手动但还没选目录" ⇒ 保存按钮是灰的，什么都写不了。
   */
  it('刚打开时保存是灰的（不许一点保存就把记住的目录清掉）', async () => {
    const { setRoots } = setupComicType()
    const editor = useSourceRootEditor({
      projects: () => [],
      refreshAfterSave: async () => undefined
    })

    await editor.open(parent({ sourceRoots: ['E:\\搬砖\\无'] }))
    expect(editor.mode.value).toBe('manual')
    expect(editor.plan.value).toEqual({ kind: 'invalid', reason: 'no-directory' })
    expect(editor.canSave.value).toBe(false)

    await editor.save()
    expect(setRoots).not.toHaveBeenCalled()
  })

  it('库里记住过根 ⇒ 来源显示"记住的目录"（而不是"自动推导"）', async () => {
    setupComicType()
    const editor = useSourceRootEditor({
      projects: () => [],
      refreshAfterSave: async () => undefined
    })

    await editor.open(parent({ sourceRoots: ['E:\\搬砖\\无', 'E:\\搬砖\\有'] }))
    expect(editor.currentIsRemembered.value).toBe(true)
  })
})

describe('useSourceRootEditor — 选目录与候选层', () => {
  it('选目录后列出它的一级子目录当"候选层"（文件不算层）', async () => {
    const { listDir } = setupComicType()
    const editor = useSourceRootEditor({
      projects: () => [],
      refreshAfterSave: async () => undefined
    })
    await editor.open(parent())

    await editor.pickDirectory()
    expect(listDir).toHaveBeenCalledWith('E:\\搬砖')
    expect(editor.directory.value).toBe('E:\\搬砖')
    expect(editor.layers.value.map((layer) => layer.name)).toEqual(['无', '有'])
  })

  it('目录读不到 ⇒ 单独给一句提示，仍然允许"就用这个目录本身"', async () => {
    const { listDir } = setupComicType()
    listDir.mockRejectedValue(new Error('ENOENT'))
    const editor = useSourceRootEditor({
      projects: () => [],
      refreshAfterSave: async () => undefined
    })
    await editor.open(parent())

    await editor.pickDirectory()
    expect(editor.layerError.value).toBeTruthy()
    expect(editor.layers.value).toEqual([])
    expect(editor.plan.value.kind).toBe('roots')
  })
})

describe('useSourceRootEditor — 保存', () => {
  it('手动模式：写库载荷是**普通数组**（响应式代理过不了结构化克隆）', async () => {
    const { setRoots } = setupComicType()
    const refresh = vi.fn().mockResolvedValue(undefined)
    const editor = useSourceRootEditor({ projects: () => [], refreshAfterSave: refresh })
    await editor.open(parent())

    await editor.pickDirectory()
    editor.toggleLayer('E:\\搬砖\\无')
    expect(editor.canSave.value).toBe(true)

    await editor.save()
    expect(setRoots).toHaveBeenCalledTimes(1)
    const [parentId, roots] = setRoots.mock.calls[0] as [string, string[]]
    expect(parentId).toBe('p-self')
    expect(roots).toEqual(['E:\\搬砖\\无'])
    expect(() => structuredClone(roots), '载荷不可结构化克隆').not.toThrow()
    expect(Array.isArray(roots)).toBe(true)
    expect(refresh).toHaveBeenCalled()
  })

  it('恢复自动推导：载荷是 null（两个字段都撕掉），不是空数组', async () => {
    const { setRoots } = setupComicType()
    const editor = useSourceRootEditor({
      projects: () => [],
      refreshAfterSave: async () => undefined
    })
    await editor.open(parent({ sourceRoots: ['E:\\搬砖\\无'] }))

    await editor.resetToAuto()
    await editor.save()
    expect(setRoots).toHaveBeenCalledWith('p-self', null)
  })

  it('选的目录里住着别的作品 ⇒ 默认**不许存**；显式"我知道"之后才放行', async () => {
    const { setRoots } = setupComicType()
    const editor = useSourceRootEditor({
      projects: () => [parent(), MAMA],
      refreshAfterSave: async () => undefined
    })
    await editor.open(parent())

    editor.setDirectory('D:\\漫画库\\嵌字')
    expect(editor.conflicts.value.map((c) => c.parentTitle)).toEqual(['某作品A'])
    expect(editor.canSave.value, '有别的作品在里面却默认能存 —— 这正是要拦的那类').toBe(false)

    // 用户看懂了红字、显式确认
    editor.acknowledged.value = true
    expect(editor.canSave.value).toBe(true)
    await editor.save()
    expect(setRoots).toHaveBeenCalledWith('p-self', ['D:\\漫画库\\嵌字'])
  })

  /**
   * 2026-10-05 现场：开发模式下**界面热更新了、后台（preload）还是旧的编译产物**，
   * 一保存就报 `... is not a function` —— 用户看不懂、也想不到"要重启程序"。
   * 这里锁：那种情况下给出的提示必须**说人话 + 给出动作**。
   */
  it('后台是旧版本（缺这条新通道）⇒ 明确说"请重启程序"，而不是甩一句 is not a function', async () => {
    setupComicType()
    // 模拟"旧 preload"：这条新通道根本不存在
    delete (window.comicType as unknown as Record<string, unknown>).projectSetParentSourceRoots
    const toast = useToastStore()
    const editor = useSourceRootEditor({
      projects: () => [],
      refreshAfterSave: async () => undefined
    })
    await editor.open(parent())

    editor.setDirectory('E:\\搬砖')
    await editor.save()

    const message = toast.toasts.at(-1)?.message ?? ''
    // 锁"说人话 + 给动作"：提到后台是旧版本、要求关掉程序重新启动
    expect(message).toContain('旧版本')
    expect(message).toContain('重新启动')
    // 而且**不许**把原始报错甩给用户（他就是因为看不懂才来问的）
    expect(message).not.toContain('is not a function')
  })

  it('改过目录/勾选之后，"我知道"要重新确认（不许一路带着）', async () => {
    setupComicType()
    const editor = useSourceRootEditor({
      projects: () => [parent(), MAMA],
      refreshAfterSave: async () => undefined
    })
    await editor.open(parent())

    editor.setDirectory('D:\\漫画库\\嵌字')
    editor.acknowledged.value = true
    editor.toggleLayer('D:\\漫画库\\嵌字\\别的层')
    expect(editor.acknowledged.value).toBe(false)
  })
})
