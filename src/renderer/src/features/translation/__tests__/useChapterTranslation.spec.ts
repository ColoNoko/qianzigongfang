// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { ChapterTranslationReadResult } from '@shared/chapter-translation'
import { useChapterTranslation } from '../useChapterTranslation'

function okResult(text: string): ChapterTranslationReadResult {
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
      groups: ['框内'],
      images: [
        {
          fileName: '20.jpg',
          labels: [
            {
              index: 1,
              group: '框内',
              text,
              position: { unit: 'normalized', x: 0.5, y: 0.5 }
            }
          ]
        }
      ],
      warnings: []
    }
  }
}

function notFound(message: string): ChapterTranslationReadResult {
  return { status: 'not-found', file: null, txtCount: 0, message, document: null }
}

function install(read: unknown): void {
  const target = window as unknown as { comicType: unknown }
  target.comicType = { readChapterTranslation: read }
}

/** 在独立 effectScope 里跑 composable（测完停掉它的 watch，别漏到下一个用例）。 */
async function mountComposable(folderPath: string | null, enabled: boolean) {
  const folder = ref(folderPath)
  const on = ref(enabled)
  const scope = effectScope()
  const state = scope.run(() =>
    useChapterTranslation({ folderPath: () => folder.value, enabled: () => on.value })
  )!
  await nextTick()
  return { state, folder, on, stop: () => scope.stop() }
}

beforeEach(() => {
  delete (window as unknown as { comicType?: unknown }).comicType
})

describe('useChapterTranslation · 读这一话的译文', () => {
  it('拿到 ok 结果就填进 result（读的是这一话的目录）', async () => {
    const read = vi.fn(async () => okResult('难道是我说错话了?'))
    install(read)
    const { state, stop } = await mountComposable('D:\\话', true)

    expect(read).toHaveBeenCalledWith('D:\\话')
    expect(state.result.value?.status).toBe('ok')
    stop()
  })

  it('嵌字 / 监修模式下（enabled=false）一次都不读，result 保持空', async () => {
    const read = vi.fn(async () => okResult('不该被读到'))
    install(read)
    const { state, stop } = await mountComposable('D:\\话', false)

    expect(read).not.toHaveBeenCalled()
    expect(state.result.value).toBeNull()
    stop()
  })

  it('没选话（folderPath 为空）时不读', async () => {
    const read = vi.fn(async () => okResult('不该被读到'))
    install(read)
    const { state, stop } = await mountComposable(null, true)

    expect(read).not.toHaveBeenCalled()
    expect(state.result.value).toBeNull()
    stop()
  })

  it('后台是旧版本（缺这条新通道）⇒ 结果里给"重启程序"的人话，而不是抛异常', async () => {
    install(undefined)
    const { state, stop } = await mountComposable('D:\\话', true)

    expect(state.result.value?.status).toBe('error')
    const message = state.result.value?.message ?? ''
    // 锁"说人话 + 给动作"：提到后台是旧版本、要求关掉程序重新启动
    expect(message).toContain('旧版本')
    expect(message).toContain('重新启动')
    // 而且不许把原始报错甩给用户
    expect(message).not.toContain('is not a function')
    stop()
  })

  it('通道自己抛错 ⇒ 变成 error 结果（不冒泡成未捕获 rejection）', async () => {
    install(
      vi.fn(async () => {
        throw new Error('盘掉了')
      })
    )
    const { state, stop } = await mountComposable('D:\\话', true)

    expect(state.result.value?.status).toBe('error')
    expect(state.result.value?.message).toContain('盘掉了')
    stop()
  })

  it('换话之后晚到的旧结果不许盖掉新结果（连着翻话时会撞上）', async () => {
    const pending: Array<(value: ChapterTranslationReadResult) => void> = []
    install(
      vi.fn(() => new Promise<ChapterTranslationReadResult>((resolve) => pending.push(resolve)))
    )
    const { state, folder, stop } = await mountComposable('D:\\话A', true)

    folder.value = 'D:\\话B'
    await nextTick()
    expect(pending).toHaveLength(2)

    // 新的先回、旧的后回 —— 最终必须留"新"的那份
    pending[1](notFound('来自话 B 的新结果'))
    await nextTick()
    pending[0](notFound('来自话 A 的旧结果'))
    await nextTick()

    expect(state.result.value?.message).toBe('来自话 B 的新结果')
    stop()
  })
})


it('invalidates the old chapter synchronously before the next chapter finishes loading', async () => {
  let finish!: (result: ChapterTranslationReadResult) => void
  const read = vi.fn().mockResolvedValueOnce(okResult('A')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  install(read)
  const { state, folder, stop } = await mountComposable('A', true)
  expect(state.result.value?.document?.images[0].labels[0].text).toBe('A')
  folder.value = 'B'
  expect(state.result.value).toBeNull()
  expect(state.loading.value).toBe(true)
  finish(okResult('B'))
  await nextTick(); await nextTick()
  expect(state.result.value?.document?.images[0].labels[0].text).toBe('B')
  stop()
})
