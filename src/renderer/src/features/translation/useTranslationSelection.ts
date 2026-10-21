import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'

/**
 * 译文栏「三个交互状态」的**唯一持有者 + 唯一写入口**（2026-10-07 方案 A）。
 *
 * ## 三个状态，各管一件事
 *
 * - **悬停** `hovered`：鼠标扫到哪条就亮哪条，一离开就灭 —— 临时。
 * - **固定选中** `active`：用户**单击**译文或锚点后钉住，用于两侧双向高亮 —— 持久。
 * - **编辑态** `editing`：**双击**某条后打开编辑器，正在改哪一条 —— 与高亮彻底分开。
 *
 * ## 屏幕上的"亮" = 悬停优先、悬停没有才用固定选中
 *
 * `highlightedIndex = hovered ?? active`。所以**残留的固定选中**会让一条在鼠标离开后
 * 自己亮起来 —— 这正是 2026-10-07 要根治的病根。
 *
 * ## 为什么要把状态收进这里（而不是散在组件里直接改 ref）
 *
 * 上一轮的口径 C 是"退出编辑时顺手清掉固定选中"，但退出编辑有**四条路**（失焦 / Esc /
 * 点栏外 / 再双击同一行），而补丁只盖住了前三条 —— 第四条走的是 `onEditTranslation`
 * 自己，根本没经过那个清空，所以残留照旧；而且"退出就清固定选中"这个动作本身就是错的，
 * 会把用户**亲手单击钉住的**那条一起误清。
 *
 * 根治 = 把两条错的写点拔掉，并让四条退出路径都走同一个 `exitEdit()`：
 *
 * 1. **双击进编辑不建立固定选中**（`enterEdit` 只动 `editing`）；
 * 2. **退出编辑只关编辑态，不动固定选中**（`exitEdit` 只动 `editing`）；
 * 3. 固定选中**只有** `pick`（单击）能改。
 *
 * 对外只暴露六个动作 + 两个只读派生值，**不暴露底层 ref** —— 外部再想直接写也没门。
 */
export function useTranslationSelection(): {
  /** 屏幕上该高亮谁（悬停优先，其次固定选中）—— 只读。 */
  highlightedIndex: ComputedRef<number | null>
  /** 正在编辑哪一条（`null` = 没在编辑）—— 只读。 */
  editingIndex: ComputedRef<number | null>
  setHover(index: number | null): void
  pick(index: number): void
  enterEdit(index: number): void
  exitEdit(): void
  resetForPage(): void
  resetForModeChange(): void
} {
  const hovered = ref<number | null>(null)
  const active = ref<number | null>(null)
  const editing = ref<number | null>(null)

  const highlightedIndex = computed(() => hovered.value ?? active.value)

  /** 悬停专用：只写 `hovered`，绝不碰固定选中与编辑态。 */
  function setHover(index: number | null): void {
    hovered.value = index
  }

  /**
   * 单击专用（点译文行 / 点锚点都走这里）—— **唯一能改固定选中的动作**。
   *
   * 语义：再点同一条 = 取消；点别的条 = 换成那条。顺带把"点别的行就收编辑器"
   * 一起做了（点正在编辑的那一条不算 —— 那一下只是选中它）。
   */
  function pick(index: number): void {
    if (editing.value !== null && editing.value !== index) {
      editing.value = null
    }
    active.value = active.value === index ? null : index
  }

  /** 双击进编辑：只开编辑器，**不建立固定选中**（固定选中只能由单击产生）。 */
  function enterEdit(index: number): void {
    editing.value = index
  }

  /**
   * 退出编辑的**唯一**入口：只关编辑器，**不动固定选中**。
   * 失焦 / Esc / 点栏外 / 再双击同一行 —— 四条路都必须到这里。
   */
  function exitEdit(): void {
    editing.value = null
  }

  /** 翻页（或打开新话）：编号是"这一页的第几条"，跨页保留会指到另一句话 ⇒ 三个全清。 */
  function resetForPage(): void {
    hovered.value = null
    active.value = null
    editing.value = null
  }

  /** 切档位（翻译 ⇄ 校对）：两档行长得不一样 ⇒ 编辑态与固定选中一起清（悬停是临时的、自我修正）。 */
  function resetForModeChange(): void {
    hovered.value = null
    editing.value = null
  }

  return {
    highlightedIndex,
    editingIndex: computed(() => editing.value),
    setHover,
    pick,
    enterEdit,
    exitEdit,
    resetForPage,
    resetForModeChange
  }
}
