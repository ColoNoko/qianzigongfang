/**
 * 「这一话的译文」取数（P1「译文对照」）。
 *
 * 只管一件事：话变了 / 模式开关变了，就去读一次；把结果与 loading 交给界面。
 *
 * 两条刻意的设计：
 * 1. **只在翻译 / 校对模式读**（`enabled()`）—— 嵌字 / 监修模式下右栏仍是 PSD，
 *    没必要为一次看不见的读盘付代价；切模式时也自然重读一次。
 * 2. **晚到的旧结果不许盖掉新结果**：连着翻话时两个请求会重叠，
 *    没有序号守卫的话，先发后到的那份会让右栏显示**上一话**的译文（张冠李戴）。
 */
import { onScopeDispose, ref, watch } from 'vue'
import type { ChapterTranslationReadResult } from '@shared/chapter-translation'
import { readChapterTranslation } from './translationBridge'

export interface ChapterTranslationInput {
  /** 话自己的目录（`ChildProject.folderPath`）；没选话时给 `null`。 */
  folderPath: () => string | null
  /** 只有翻译 / 校对模式才需要译文。 */
  enabled: () => boolean
}

export function useChapterTranslation(input: ChapterTranslationInput) {
  const loading = ref(false)
  const result = ref<ChapterTranslationReadResult | null>(null)
  /** 请求序号：只有最后一次发出的那个才允许写结果。 */
  let sequence = 0

  async function load(): Promise<void> {
    const folder = input.enabled() ? input.folderPath() : null
    if (!folder) {
      // 不算"正在加载"：没有话可读，右栏什么都不该显示
      sequence += 1
      result.value = null
      loading.value = false
      return
    }
    const token = (sequence += 1)
    loading.value = true
    const next = await readChapterTranslation(folder)
    if (token !== sequence) return
    result.value = next
    loading.value = false
  }

  watch(
    () => [input.enabled(), input.folderPath()] as const,
    () => {
      result.value = null
      void load()
    },
    { immediate: true, flush: 'sync' }
  )

  // 组件（或 effectScope）销毁后，晚到的响应不该再改状态
  onScopeDispose(() => {
    sequence += 1
  })

  return { loading, result, load }
}
