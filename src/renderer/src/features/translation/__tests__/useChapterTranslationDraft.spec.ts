// @vitest-environment jsdom
/**
 * 译文草稿（P2-b）：改动集 / 撤销 / 保存 / 冲突。
 *
 * 盯的是四件事：
 * · **改回原值 = 不算改动**（否则"未保存"会赖着不走）；
 * · **没有未保存改动时 undo() 必须返回 false** —— 把 Ctrl+Z 还给"撤销标记"，
 *   这是用户拍板那条"永远不会跨到第三种东西上"的落点；
 * · 保存成功后草稿清空、通知外面重读；
 * · **冲突时不许清草稿**（用户刚打的字不能被吃掉）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isReactive, nextTick, ref } from 'vue'
import type {
  ChapterTranslationFingerprint,
  ChapterTranslationSaveResult,
  ChapterTranslationUndoResult
} from '@shared/chapter-translation'
import type { LabelPlusDocument } from '@shared/labelplus-import'
import { draftKey, toPlainEdit, useChapterTranslationDraft } from '../useChapterTranslationDraft'

const BASE: ChapterTranslationFingerprint = { size: 100, mtimeMs: 1, sha256: 'a'.repeat(64) }
const NEXT: ChapterTranslationFingerprint = { size: 120, mtimeMs: 2, sha256: 'b'.repeat(64) }

function makeDocument(): LabelPlusDocument {
  return {
    sourcePath: 'D:\\话\\20.txt',
    version: { first: 1, last: 0 },
    groups: ['框内', '框外'],
    images: [
      {
        fileName: '20.jpg',
        labels: [
          { index: 1, group: '框内', text: '甲', position: { unit: 'normalized', x: 0.5, y: 0.5 } },
          { index: 2, group: '框外', text: '乙', position: { unit: 'normalized', x: 0.2, y: 0.3 } }
        ]
      }
    ],
    warnings: []
  }
}

function install(save: unknown, undo?: unknown): void {
  const target = window as unknown as { comicType: unknown }
  target.comicType = { saveChapterTranslation: save, undoChapterTranslation: undo }
}

function okSave(changed = true): ChapterTranslationSaveResult {
  return {
    ok: true,
    changed,
    backupPath: changed ? 'C:\\备份\\translation\\x.txt' : null,
    fingerprint: NEXT
  }
}

function setup(
  options: {
    save?: unknown
    undo?: unknown
    document?: LabelPlusDocument | null
    /** 当前这一话的 txt 路径（"换话"测试要能改它）。默认固定那一份。 */
    filePath?: () => string
    /** 这一话的目录 —— "换话"的判据（不是 txt 路径，见那条"重读不许清零"的锁）。 */
    chapterKey?: () => string | null
  } = {}
) {
  const document = options.document === undefined ? makeDocument() : options.document
  const onSaved = vi.fn()
  const draft = useChapterTranslationDraft({
    document: () => document,
    filePath: options.filePath ?? (() => 'D:\\话\\20.txt'),
    chapterKey: options.chapterKey ?? (() => 'D:\\话\\20'),
    base: () => BASE,
    onSaved
  })
  if (options.save !== undefined || options.undo !== undefined) {
    install(options.save, options.undo)
  }
  return { draft, onSaved, document }
}

beforeEach(() => {
  delete (window as unknown as { comicType?: unknown }).comicType
})

describe('草稿 · 记什么', () => {
  it('改文本 ⇒ 只记文本这一个字段，dirty 立起来', () => {
    const { draft } = setup()
    draft.setText('20.jpg', 1, '改过的')

    expect(draft.dirty.value).toBe(true)
    expect(draft.changedCount.value).toBe(1)
    expect(draft.edits.value.get(draftKey('20.jpg', 1))).toMatchObject({
      imageName: '20.jpg',
      labelIndex: 1,
      text: '改过的'
    })
  })

  it('改坐标 / 改分组 ⇒ 各自进改动集，且可以只带一个字段', () => {
    const { draft } = setup()
    draft.setPosition('20.jpg', 1, 0.11, 0.22)
    draft.setGroup('20.jpg', 1, '框外')

    expect(draft.edits.value.get(draftKey('20.jpg', 1))).toMatchObject({
      position: { x: 0.11, y: 0.22 },
      groupName: '框外'
    })
    expect(draft.isChanged('20.jpg', 1)).toBe(true)
    expect(draft.isChanged('20.jpg', 2)).toBe(false)
  })

  it('**改回原值 ⇒ 不算改动**（整条从改动集里消失）', () => {
    const { draft } = setup()
    draft.setText('20.jpg', 1, '改过的')
    draft.setText('20.jpg', 1, '甲')

    expect(draft.dirty.value).toBe(false)
    expect(draft.isChanged('20.jpg', 1)).toBe(false)
  })

  it('坐标改回原值（抖动级误差）也判定为"没动过"', () => {
    const { draft } = setup()
    draft.setPosition('20.jpg', 1, 0.5 + 1e-12, 0.5)

    expect(draft.dirty.value).toBe(false)
  })

  it('文档里没有这一条 ⇒ 不记（不猜、不新建条目）', () => {
    const { draft } = setup()
    draft.setText('20.jpg', 99, '甲')

    expect(draft.dirty.value).toBe(false)
  })
})

describe('草稿 · 撤销（Ctrl+Z 归属的落点）', () => {
  it('改两条 → 撤一次回一条 → 再撤回零', () => {
    const { draft } = setup()
    draft.setText('20.jpg', 1, 'A')
    draft.setText('20.jpg', 2, 'B')

    expect(draft.undo()).toBe(true)
    expect(draft.isChanged('20.jpg', 2)).toBe(false)
    expect(draft.isChanged('20.jpg', 1)).toBe(true)

    expect(draft.undo()).toBe(true)
    expect(draft.dirty.value).toBe(false)
  })

  it('**没有未保存改动时返回 false**（把 Ctrl+Z 让给"撤销标记"）', () => {
    const { draft } = setup()
    expect(draft.undo()).toBe(false)

    draft.setText('20.jpg', 1, 'A')
    draft.undo()
    expect(draft.dirty.value).toBe(false)
    expect(draft.undo()).toBe(false)
  })

  it('原样重写一遍不算一步撤销（免得按好几下才动一次）', () => {
    const { draft } = setup()
    draft.setText('20.jpg', 1, 'A')
    draft.setText('20.jpg', 1, 'A')
    draft.undo()

    expect(draft.dirty.value).toBe(false)
  })

  /**
   * ⚠️ 这条是**变异验证补出来的**（2026-10-06）：
   * 原先只有上面那条归属用例，判据其实从没被真正逼到 —— `dirty=false` 时撤销栈恰好也是空的，
   * 于是把 `if (!dirty.value) return false` 整句改成永假，用例照样全绿（**假锁**）。
   *
   * 而"改动集空、撤销栈非空"这个状态**真的能达到**：把一条改回原值就是。
   * 那时少了那道判据，Ctrl+Z 会把用户刚改回去的那条**又翻出来** ——
   * 既不归标记、也不是用户想要的撤销。
   */
  it('改回原值之后（文档已无改动）也得让位：不许把刚改回去的那条又翻出来', () => {
    const { draft } = setup()
    draft.setText('20.jpg', 1, 'A')
    draft.setText('20.jpg', 1, '甲') // 改回原值 ⇒ 改动集空，但撤销栈里还留着历史
    expect(draft.dirty.value).toBe(false)

    expect(draft.undo()).toBe(false)
    expect(draft.dirty.value).toBe(false)
  })

  it('放弃改动 ⇒ 全清，且之后 Ctrl+Z 不再归译文', () => {
    const { draft } = setup()
    draft.setText('20.jpg', 1, 'A')
    draft.discard()

    expect(draft.dirty.value).toBe(false)
    expect(draft.undo()).toBe(false)
  })
})

describe('草稿 · 保存', () => {
  it('把改动集原样发出去（含基指纹），成功后清草稿 + 通知外面重读', async () => {
    const save = vi.fn(async () => okSave())
    const { draft, onSaved } = setup({ save })
    draft.setText('20.jpg', 1, '改过的')
    draft.setGroup('20.jpg', 1, '框外')

    await draft.save()

    expect(save).toHaveBeenCalledWith({
      filePath: 'D:\\话\\20.txt',
      base: BASE,
      edits: [{ imageName: '20.jpg', labelIndex: 1, text: '改过的', groupName: '框外' }],
      force: false
    })
    expect(draft.dirty.value).toBe(false)
    expect(onSaved).toHaveBeenCalledTimes(1)
    // **成功静默**（用户 2026-10-06 真机反馈："能让这个保存静默进行吗"）：
    // 成功不写字，状态条保持原样，界面才不会"闪一下保存流程"。
    expect(draft.notice.value).toBe('')
  })

  it('盘上已经一致（changed:false）⇒ 不算失败，照样清草稿', async () => {
    const { draft, onSaved } = setup({ save: vi.fn(async () => okSave(false)) })
    draft.setText('20.jpg', 1, '改过的')

    await draft.save()

    expect(draft.dirty.value).toBe(false)
    expect(draft.notice.value).toContain('没有需要写入')
    expect(onSaved).toHaveBeenCalled()
  })

  it('冲突 ⇒ **草稿一条都不许丢**，只把决定摆出来', async () => {
    const conflictResult = {
      ok: false as const,
      kind: 'conflict' as const,
      message: '这个 txt 在你读进来之后被改过了',
      current: NEXT
    }
    const { draft, onSaved } = setup({ save: vi.fn(async () => conflictResult) })
    draft.setText('20.jpg', 1, '我打的字')

    await draft.save()

    expect(draft.conflict.value?.message).toContain('被改过')
    expect(draft.dirty.value).toBe(true)
    expect(draft.edits.value.get(draftKey('20.jpg', 1))).toMatchObject({ text: '我打的字' })
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('冲突选「重新读取」⇒ 丢我这边 + 通知外面重读', async () => {
    const { draft, onSaved } = setup({
      save: vi.fn(async () => ({
        ok: false as const,
        kind: 'conflict' as const,
        message: '被改过'
      }))
    })
    draft.setText('20.jpg', 1, '我打的字')
    await draft.save()

    draft.resolveConflict('reload')

    expect(draft.conflict.value).toBeNull()
    expect(draft.dirty.value).toBe(false)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('冲突选「强制覆盖」⇒ 带上 force 再发一次，且这次的改动就是原草稿', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, kind: 'conflict' as const, message: '被改过' })
      .mockResolvedValueOnce(okSave())
    const { draft, onSaved } = setup({ save })
    draft.setText('20.jpg', 1, '我打的字')
    await draft.save()

    draft.resolveConflict('force')
    await Promise.resolve()
    await Promise.resolve()

    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        force: true,
        edits: [expect.objectContaining({ text: '我打的字' })]
      })
    )
    expect(draft.dirty.value).toBe(false)
    expect(onSaved).toHaveBeenCalled()
  })

  it('别的失败（invalid / io）⇒ 草稿留着，把服务层那句人话显示出来', async () => {
    const { draft } = setup({
      save: vi.fn(async () => ({
        ok: false as const,
        kind: 'invalid' as const,
        message: '没有写入：找不到要改的那一条'
      }))
    })
    draft.setText('20.jpg', 1, '我打的字')

    await draft.save()

    expect(draft.dirty.value).toBe(true)
    expect(draft.notice.value).toContain('找不到要改的那一条')
  })

  it('没有改动就点保存 ⇒ 直接说"没有要保存的改动"，一次通道都不发', async () => {
    const save = vi.fn(async () => okSave())
    const { draft } = setup({ save })

    await draft.save()

    expect(save).not.toHaveBeenCalled()
    expect(draft.notice.value).toContain('没有要保存的改动')
  })

  it('后台是旧版本（缺这条新通道）⇒ 人话，草稿留着', async () => {
    const { draft } = setup()
    draft.setText('20.jpg', 1, '我打的字')

    await draft.save()

    expect(draft.notice.value).toContain('旧版本')
    expect(draft.dirty.value).toBe(true)
  })
})

describe('草稿 · ⑦ 失焦即存（用户 2026-10-06 改的口径）', () => {
  it('commit()：有改动就**立刻写盘**', async () => {
    const save = vi.fn(async () => okSave())
    const { draft, onSaved } = setup({ save })
    draft.setText('20.jpg', 1, '甲改')

    await draft.commit()

    expect(save).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('commit()：**没有改动时一个通道都不发**（切来切去不该反复写用户文件）', async () => {
    const save = vi.fn(async () => okSave())
    const { draft } = setup({ save })

    await draft.commit()

    expect(save).not.toHaveBeenCalled()
  })

  it('commit() 撞上冲突 ⇒ 走同一条路（草稿留着 + 把决定摆出来）', async () => {
    const { draft, onSaved } = setup({
      save: vi.fn(async () => ({
        ok: false as const,
        kind: 'conflict' as const,
        message: '被改过'
      }))
    })
    draft.setText('20.jpg', 1, '我打的字')

    await draft.commit()

    expect(draft.conflict.value?.message).toContain('被改过')
    expect(draft.dirty.value).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('草稿 · ⑤ 分组有效值（选了要留在界面上）', () => {
  it('改过的分组按编号给出来（面板据此显示，否则会弹回旧值）', () => {
    const { draft } = setup()
    draft.setGroup('20.jpg', 1, '框外')

    expect(draft.groupOverridesFor('20.jpg', [{ index: 1 }, { index: 2 }])).toEqual({ 1: '框外' })
  })

  it('没改过的分组不出现在里面（面板用文档里的原值）', () => {
    const { draft } = setup()
    expect(draft.groupOverridesFor('20.jpg', [{ index: 1 }])).toEqual({})
  })

  it('改回原分组 ⇒ 该条从覆盖里消失（与"改回原值不算改动"同一条口径）', () => {
    const { draft } = setup()
    draft.setGroup('20.jpg', 1, '框外')
    draft.setGroup('20.jpg', 1, '框内')

    expect(draft.groupOverridesFor('20.jpg', [{ index: 1 }])).toEqual({})
  })
})

describe('草稿 · ② 载荷必须能被结构化克隆（本仓第 4 次踩这个坑）', () => {
  it('送出去的是**普通对象**：structuredClone 不抛，也不是响应式代理', async () => {
    const save = vi.fn(async (_request: unknown) => okSave())
    const { draft } = setup({ save })
    draft.setText('20.jpg', 1, '改过的')
    draft.setGroup('20.jpg', 1, '框外')
    draft.setPosition('20.jpg', 2, 0.1234, 0.5678)

    await draft.save()

    const request = save.mock.calls[0]?.[0] as { edits: unknown[] }
    // ① 真的能克隆（IPC 就是靠它把参数送过进程边界）
    expect(() => structuredClone(request)).not.toThrow()
    // ② 不是响应式代理本身
    expect(isReactive(request.edits)).toBe(false)
    // ③ 字段一个不少、也没多出渲染层的私有东西
    expect(request.edits).toEqual([
      { imageName: '20.jpg', labelIndex: 1, text: '改过的', groupName: '框外' },
      { imageName: '20.jpg', labelIndex: 2, position: { x: 0.1234, y: 0.5678 } }
    ])
  })

  it('白名单：只带约定的五个字段（多出来的字段发不出去，别悄悄漏进 IPC）', () => {
    const plain = toPlainEdit({
      imageName: '20.jpg',
      labelIndex: 3,
      text: '甲',
      // @ts-expect-error 故意塞一个渲染层才有的字段，必须在摊平时被丢掉
      __fromReactive: true
    })

    expect(plain).toEqual({ imageName: '20.jpg', labelIndex: 3, text: '甲' })
  })
})

describe('草稿 · 静默保存（真机反馈："能让这个保存静默进行吗"）', () => {
  it('自动保存**几十毫秒就完事** ⇒ 界面上的未保存态**始终不出现**', async () => {
    vi.useFakeTimers()
    try {
      const { draft } = setup({ save: vi.fn(async () => okSave()) })
      draft.setText('20.jpg', 1, '改过的')
      await nextTick()

      // 数据层确实脏了，但**界面还没显示**（这是"慢一拍"的全部意义）
      expect(draft.dirty.value).toBe(true)
      expect(draft.dirtyVisible.value).toBe(false)

      await draft.commit()
      await vi.advanceTimersByTimeAsync(2000)
      await nextTick()

      // 存完了 ⇒ 那个"未保存"从来没被画出来过
      expect(draft.dirtyVisible.value).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('保存**失败** ⇒ 过了阈值才把未保存态摆出来（成功静默、失败出声）', async () => {
    vi.useFakeTimers()
    try {
      const { draft } = setup({
        save: vi.fn(async () => ({ ok: false as const, kind: 'io' as const, message: '盘掉了' }))
      })
      draft.setText('20.jpg', 1, '改过的')
      await draft.commit()

      // 还没到阈值：先不出声
      expect(draft.dirtyVisible.value).toBe(false)
      await vi.advanceTimersByTimeAsync(500)
      // 到点了、而且确实没存成 ⇒ 如实摆出来（含原因）
      expect(draft.dirtyVisible.value).toBe(true)
      expect(draft.dirty.value).toBe(true)
      expect(draft.notice.value).toContain('盘掉了')
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * 回退最近一次保存（2026-10-07）—— **每按一次 Ctrl+Z 退一步**，退到本会话开始（栈空）为止。
 *
 * 这一层留的是**渲染层的镜像**（"这一话还剩几步可退"）：热键要**同步**决定"这一下该不该拦下来"，
 * 不能等一次 IPC 往返。真值在主进程那个堆栈里（见 chapter-translation-write）。
 * 分歧时以主进程为准：它说"没有可回退的"，镜像就对齐成 0。
 */
describe('草稿 · 回退最近一次保存（会话内，每按一次退一步）', () => {
  const okUndo = (changed = true): ChapterTranslationUndoResult => ({
    ok: true,
    changed,
    backupPath: changed ? 'C:\\备份\\translation\\x.txt' : null,
    fingerprint: BASE
  })

  it('保存**真的写盘**（changed:true）⇒ 立起"本会话有可退的保存"', async () => {
    const { draft } = setup({
      save: vi.fn().mockResolvedValue(okSave(true)),
      undo: vi.fn()
    })
    draft.setText('20.jpg', 1, '甲改')

    await draft.save()

    expect(draft.canUndoSaved.value).toBe(true)
  })

  it('保存时盘上已一致（changed:false）⇒ **不立历史**（没写盘就没有"保存"可言）', async () => {
    const { draft } = setup({
      save: vi.fn().mockResolvedValue(okSave(false)),
      undo: vi.fn()
    })
    draft.setText('20.jpg', 1, '甲改')

    await draft.save()

    expect(draft.canUndoSaved.value).toBe(false)
  })

  it('**连退**：每退一次少一步；退到空之后**一个通道都不发**', async () => {
    const undo = vi.fn().mockResolvedValue(okUndo(true))
    const { draft } = setup({ save: vi.fn().mockResolvedValue(okSave(true)), undo })

    draft.setText('20.jpg', 1, '第一次')
    await draft.save()
    draft.setText('20.jpg', 1, '第二次')
    await draft.save()
    expect(draft.canUndoSaved.value).toBe(true)

    await draft.undoSaved()
    expect(draft.canUndoSaved.value).toBe(true) // 还有一步

    await draft.undoSaved()
    expect(draft.canUndoSaved.value).toBe(false) // 退到本会话开始
    expect(undo).toHaveBeenCalledTimes(2)

    // 栈空之后再按 ⇒ 由上层落到原有行为（这里不再发通道）
    await draft.undoSaved()
    expect(undo).toHaveBeenCalledTimes(2)
    expect(draft.canUndoSaved.value).toBe(false)
  })

  it('回退成功 ⇒ 通知外面重读（否则下一句保存会拿着过期指纹，白撞一次冲突）', async () => {
    const { draft, onSaved } = setup({
      save: vi.fn().mockResolvedValue(okSave(true)),
      undo: vi.fn().mockResolvedValue(okUndo(true))
    })
    draft.setText('20.jpg', 1, '甲改')
    await draft.save()
    onSaved.mockClear()

    await draft.undoSaved()

    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('回退撞上冲突 ⇒ **历史照旧留着**（没退成不该消耗），并把服务层那句话显示出来', async () => {
    const undo = vi.fn().mockResolvedValue({
      ok: false,
      kind: 'conflict',
      message: '这个 txt 在你读进来之后被改过了（可能是 LabelPlusFX 存的），所以没有回退。'
    })
    const { draft } = setup({ save: vi.fn().mockResolvedValue(okSave(true)), undo })
    draft.setText('20.jpg', 1, '甲改')
    await draft.save()

    await draft.undoSaved()

    expect(draft.canUndoSaved.value).toBe(true)
    expect(draft.notice.value).toContain('被改过')
  })

  it('主进程说"没有可回退的" ⇒ 镜像对齐成 0（分歧时以主进程为准）', async () => {
    const undo = vi.fn().mockResolvedValue({
      ok: false,
      kind: 'invalid',
      message: '本会话还没有可回退的保存。'
    })
    const { draft } = setup({ save: vi.fn().mockResolvedValue(okSave(true)), undo })
    draft.setText('20.jpg', 1, '甲改')
    await draft.save()
    expect(draft.canUndoSaved.value).toBe(true)

    await draft.undoSaved()

    expect(draft.canUndoSaved.value).toBe(false)
    expect(draft.notice.value).toContain('没有可回退')
  })

  it('换话 ⇒ 可退历史归零（不许跨话退）', async () => {
    const folder = ref('D:\\话\\20')
    const path = ref('D:\\话\\20\\译文.txt')
    const { draft } = setup({
      save: vi.fn().mockResolvedValue(okSave(true)),
      undo: vi.fn(),
      filePath: () => path.value,
      chapterKey: () => folder.value
    })
    draft.setText('20.jpg', 1, '甲改')
    await draft.save()
    expect(draft.canUndoSaved.value).toBe(true)

    // 换话 = **目录变了**（不只是文件名变了，见下面那条锁）
    folder.value = 'D:\\话\\21'
    path.value = 'D:\\话\\21\\译文.txt'
    await nextTick()

    expect(draft.canUndoSaved.value).toBe(false)
  })

  /**
   * ⚠️ **2026-10-07 真机 bug 的第三层根因**（前两层见 `views/Project.vue` 的 `onTranslationAddFrame`
   * 与这条注释下面的说明）：原来这里是 `watch(input.filePath())`，而**一次普通的重读**
   * （保存成功 / 新增框成功 / 回退成功之后都会 `reloadChapterTranslation()`）会让
   * `filePath` 从 `null` 变成路径、或路径对象换个实例 —— 于是"可退历史"被**清零**。
   *
   * 真机现场因此长这样：**状态条写着「Ctrl+Z 可撤销」、按下去什么都不发生**，
   * 而且那个提示时有时无（取决于别处还留着几层）。
   * 判据改成 **"这一话的目录"**之后，重读不再误伤，换话照旧清零。
   */
  it('同一次会话里**重读**（路径由 null 变成真路径）⇒ 可退历史**不许**被清掉', async () => {
    const path = ref<string | null>(null)
    const { draft } = setup({
      save: vi.fn().mockResolvedValue(okSave(true)),
      undo: vi.fn(),
      filePath: () => path.value as string,
      chapterKey: () => 'D:\\话\\20'
    })
    // 模拟"翻译模式刚打开、还在读"那一刻先存过一次（keys 落在当时那个路径上）
    path.value = 'D:\\话\\20\\译文.txt'
    await nextTick()
    draft.setText('20.jpg', 1, '甲改')
    await draft.save()
    expect(draft.canUndoSaved.value).toBe(true)

    // 一次重读：路径短暂回落到 null，再回来（真机上"新增框之后重读"就是这条路）
    path.value = null
    await nextTick()
    path.value = 'D:\\话\\20\\译文.txt'
    await nextTick()

    expect(draft.canUndoSaved.value).toBe(true)
  })

  it('新增框那种"别处写了一次盘"也能记进镜像（`noteSavedWrite`）', async () => {
    const { draft } = setup({ save: vi.fn(), undo: vi.fn() })
    expect(draft.canUndoSaved.value).toBe(false)

    draft.noteSavedWrite()

    expect(draft.canUndoSaved.value).toBe(true)
  })
})

/**
 * 第 5 批 5e（2026-10-07）：删除一条译文时，**草稿要跟着动**（用户拍板的两件事）。
 *
 * ① **先丢它自己的未落盘改动**（"先丢"）——这条都删了，草稿里那份改动没有任何去处；
 * ② **键重映射**：封面里"按序号存"的键是 `图名 \u0000 序号`，而序号在删除后**重排**过
 *   ⇒ 大于被删序号的那些必须 -1，否则改动会落到**另一句话**上（那是静默改错数据）。
 */
describe('删除一条译文时的草稿处理（5e）', () => {
  it('① 删掉第 3 条 ⇒ 它自己的改动被丢掉', () => {
    const { draft } = setup({ save: vi.fn() })
    draft.setText('20.jpg', 3, '这条要被删掉的改动')

    draft.dropEntry('20.jpg', 3)

    expect(draft.edits.value.has(draftKey('20.jpg', 3))).toBe(false)
    expect(draft.dirty.value).toBe(false)
  })

  it('② 键重映射：> 被删序号的 -1（同一张图），其余**一个都不动**', () => {
    // ⚠️ 草稿只会记"**文档里真的有**的条目"（`writeEdit` 先 `findLabel`）⇒
    //    这里得给一份"序号 1/5/9 都在"的文档，否则改动静默不入账（本仓栽过这种"测了个空气"）。
    const doc: LabelPlusDocument = {
      sourcePath: 'D:\\话\\20.txt',
      version: { first: 1, last: 0 },
      groups: ['框内', '框外'],
      images: [
        {
          fileName: '20.jpg',
          labels: [1, 5, 9].map((index) => ({
            index,
            group: '框内',
            text: `第 ${index} 句`,
            position: { unit: 'normalized' as const, x: 0.5, y: 0.5 }
          }))
        },
        {
          fileName: '21.jpg',
          labels: [
            {
              index: 5,
              group: '框内',
              text: '别的图的第 5 句',
              position: { unit: 'normalized' as const, x: 0.5, y: 0.5 }
            }
          ]
        }
      ],
      warnings: []
    }
    const { draft } = setup({ save: vi.fn(), document: doc })
    draft.setText('20.jpg', 1, '甲')
    draft.setText('20.jpg', 5, '这条要跟着挪')
    draft.setText('20.jpg', 9, '这条也要跟着挪')
    draft.setPosition('21.jpg', 5, 0.1, 0.2) // **别的图**：不许动

    draft.remapEntryKeys('20.jpg', 3)

    expect([...draft.edits.value.keys()].sort()).toEqual([
      draftKey('20.jpg', 1),
      draftKey('20.jpg', 4),
      draftKey('20.jpg', 8),
      draftKey('21.jpg', 5)
    ])
    // 挪过的那条：**其余字段一个不丢**（文本原样）
    expect(draft.edits.value.get(draftKey('20.jpg', 4))).toMatchObject({ text: '这条要跟着挪' })
    expect(draft.edits.value.get(draftKey('20.jpg', 8))).toMatchObject({ text: '这条也要跟着挪' })
  })

  it('② 补：被删序号**之下**的那些（≤ 被删序号）一个都不动', () => {
    const { draft } = setup({ save: vi.fn() })
    draft.setText('20.jpg', 1, '甲改')
    draft.setText('20.jpg', 2, '乙改')

    draft.remapEntryKeys('20.jpg', 5)

    expect(draft.edits.value.get(draftKey('20.jpg', 1))).toMatchObject({ text: '甲改' })
    expect(draft.edits.value.get(draftKey('20.jpg', 2))).toMatchObject({ text: '乙改' })
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('draft ownership and write acknowledgments', () => {
  it('preserves separate drafts and conflict bases across chapters and files', async () => {
    const chapter = ref('A')
    const path = ref('A/translation.txt')
    const save = vi.fn(async (_request: unknown) => ({ ok: false as const, kind: 'conflict' as const, message: 'external edit' }))
    const { draft } = setup({ chapterKey: () => chapter.value, filePath: () => path.value, save })
    draft.setText('20.jpg', 1, 'A work')
    await draft.save()
    chapter.value = 'B'; path.value = 'B/translation.txt'
    expect(draft.dirty.value).toBe(false)
    draft.setText('20.jpg', 2, 'B work')
    await draft.save()
    expect(save.mock.calls[1][0]).toMatchObject({ filePath: 'B/translation.txt', edits: [{ labelIndex: 2, text: 'B work' }] })
    chapter.value = 'A'; path.value = 'A/translation.txt'
    expect(draft.edits.value.get(draftKey('20.jpg', 1))?.text).toBe('A work')
    expect(draft.conflict.value?.message).toBe('external edit')
    path.value = 'A/other.txt'
    expect(draft.dirty.value).toBe(false)
    path.value = 'A/translation.txt'
    expect(draft.dirty.value).toBe(true)
  })

  it('serializes commits, advances the fingerprint, and preserves a later conflicting edit', async () => {
    const first = deferred<ChapterTranslationSaveResult>()
    const second = deferred<ChapterTranslationSaveResult>()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { draft } = setup({ save })
    draft.setText('20.jpg', 1, 'first')
    const one = draft.save()
    draft.setText('20.jpg', 2, 'second')
    const two = draft.save()
    expect(save).toHaveBeenCalledTimes(1)
    first.resolve(okSave())
    await one
    await nextTick()
    expect(draft.saving.value).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].base).toEqual(NEXT)
    expect(save.mock.calls[1][0].edits).toEqual([{ imageName: '20.jpg', labelIndex: 2, text: 'second' }])
    second.resolve({ ok: false, kind: 'conflict', message: 'changed again' })
    await two
    expect(draft.edits.value.get(draftKey('20.jpg', 2))?.text).toBe('second')
    expect(draft.conflict.value?.message).toBe('changed again')
    expect(draft.saving.value).toBe(false)
  })

  it('retains a same-field edit made while saving, including reverting to the old disk value', async () => {
    const first = deferred<ChapterTranslationSaveResult>()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(okSave())
    const { draft } = setup({ save })
    draft.setText('20.jpg', 1, 'in flight')
    const one = draft.save()
    draft.setText('20.jpg', 1, '甲')
    first.resolve(okSave())
    await one
    expect(draft.edits.value.get(draftKey('20.jpg', 1))?.text).toBe('甲')
    await draft.save()
    expect(save.mock.calls[1][0].edits[0].text).toBe('甲')
  })

  it('late success acknowledges only its original chapter and does not reload another chapter', async () => {
    const response = deferred<ChapterTranslationSaveResult>()
    const chapter = ref('A'), path = ref('A/translation.txt')
    const { draft, onSaved } = setup({ chapterKey: () => chapter.value, filePath: () => path.value, save: vi.fn(() => response.promise) })
    draft.setText('20.jpg', 1, 'A')
    const operation = draft.save()
    chapter.value = 'B'; path.value = 'B/translation.txt'
    draft.setText('20.jpg', 1, 'B')
    response.resolve(okSave()); await operation
    expect(onSaved).not.toHaveBeenCalled()
    expect(draft.edits.value.get(draftKey('20.jpg', 1))?.text).toBe('B')
    chapter.value = 'A'; path.value = 'A/translation.txt'
    expect(draft.dirty.value).toBe(false)
  })

  it('waits for refresh and review recording before starting the next queued save', async () => {
    const refresh = deferred<void>(), review = deferred<void>()
    const save = vi.fn(async () => okSave())
    const { draft, onSaved } = setup({ save })
    onSaved.mockImplementationOnce(() => refresh.promise)
    draft.setText('20.jpg', 1, 'first')
    const one = draft.commit(async () => review.promise)
    draft.setText('20.jpg', 2, 'second')
    const two = draft.commit()
    await nextTick()
    expect(save).toHaveBeenCalledTimes(1)
    refresh.resolve(); await nextTick()
    expect(save).toHaveBeenCalledTimes(1)
    review.resolve(); await one; await two
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('failed deletion preserves label keys and undo snapshots; success remaps both', async () => {
    const remove = vi.fn().mockResolvedValueOnce({ ok: false, kind: 'io', message: 'read only' }).mockResolvedValueOnce({ ...okSave(), deletedIndex: 1, renumbered: [1] })
    const { draft } = setup()
    Object.assign(window as unknown as { comicType: unknown }, { comicType: { deleteChapterTranslation: remove } })
    draft.setText('20.jpg', 2, 'second edit')
    draft.setText('20.jpg', 2, 'latest edit')
    await draft.deleteEntry('20.jpg', 1)
    expect(draft.edits.value.get(draftKey('20.jpg', 2))?.text).toBe('latest edit')
    await draft.deleteEntry('20.jpg', 1)
    expect(draft.edits.value.get(draftKey('20.jpg', 1))?.text).toBe('latest edit')
    expect(draft.edits.value.has(draftKey('20.jpg', 2))).toBe(false)
    draft.undo()
    expect(draft.edits.value.get(draftKey('20.jpg', 1))?.text).toBe('second edit')
  })

  it('does not start a structural delete while a text save is pending', async () => {
    const pending = deferred<ChapterTranslationSaveResult>(), remove = vi.fn()
    const { draft } = setup({ save: () => pending.promise })
    Object.assign(window.comicType, { deleteChapterTranslation: remove })
    draft.setText('20.jpg', 1, 'pending')
    const saving = draft.save()
    expect(await draft.deleteEntry('20.jpg', 1)).toBeNull()
    expect(remove).not.toHaveBeenCalled()
    pending.resolve(okSave()); await saving
  })
})


it('a no-op field change during a failed save does not erase the in-flight text', async () => {
  const response = deferred<ChapterTranslationSaveResult>()
  const { draft } = setup({ save: () => response.promise })
  draft.setText('20.jpg', 1, 'keep me')
  const pending = draft.save()
  draft.setGroup('20.jpg', 1, '框内')
  response.resolve({ ok: false, kind: 'io', message: 'disk failed' })
  await pending
  expect(draft.edits.value.get(draftKey('20.jpg', 1))?.text).toBe('keep me')
})
