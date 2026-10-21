/**
 * 右栏「译文」那一栏要吃的数据（P1 译文对照 → 第 2 批加档位与校对记录）。
 *
 * 单独抽成一个小模型，是为了让 `CompareViewer` 只认识**一个可选 prop**：
 * 传了 ⇒ 右栏是译文；不传 ⇒ 右栏还是 PSD（老行为，既有用例一字不用改）。
 */
import type { ChapterTranslationReadResult } from '@shared/chapter-translation'
import type { LabelPlusImageEntry } from '@shared/labelplus-import'
import type { TranslationPaneMode } from '@shared/translation-review'

export interface TranslationPaneModel {
  /** 正在读这一话的译文。 */
  loading: boolean
  /** 三态结果（`ok` / `not-found` / `error`）；第一次读完之前是 null。 */
  result: ChapterTranslationReadResult | null
  /** **当前这一页**在文本里对应的那条记录；本页没译文时为 null。 */
  entry: LabelPlusImageEntry | null
  /** 文本里声明的分组表（决定分组色，来自 `document.groups`）。 */
  groups: string[]
  /** P2：有没有未保存的改动。 */
  dirty: boolean
  /** P2：改动了几条。 */
  changedCount: number
  /** P2：正在写盘（按钮要禁用，防连点写两次）。 */
  saving: boolean
  /** P2：一行反馈（保存成功 / 失败原因）。 */
  notice: string
  /** P2：这一页里哪几条被改过（用来打记号）。 */
  changedIndices: number[]
  /**
   * P2-c：拖过之后的**有效坐标**（按条目编号索引）。
   *
   * 有值就用它画锚点，没有才用文本里的原坐标 —— 少了这一层，拖完的徽章会在
   * "草稿还没回来"的那一瞬弹回原处再跳过去。
   */
  positionOverrides: Record<number, { x: number; y: number }>
  /**
   * P2 修：改过分组的那些（按条目编号索引）。
   *
   * 面板的"分组"下拉必须显示**这个**而不是文档里的 `label.group` ——
   * 文档在保存前不会变，读它就会一选就弹回旧值，看着像"切换没反应"。
   */
  groupOverrides: Record<number, string>
  /**
   * 第 2 批：档位（翻译 / 校对）。
   *
   * 默认值跟着四模式走（`paneModeForWorkMode`），但**用户手动改过之后本会话内不再跟随** ——
   * 所以它是父层的一个 ref，不是"从模式算出来的纯值"。
   */
  mode: TranslationPaneMode
  /**
   * 第 2 批：**这一页**里校对过的那些（按条目编号索引）。
   *
   * 只带记录里的**原文与理由**：`校` 那一行显示的是文档里的当前值
   * （覆盖保存之后两者相等；若之后又改过，以 txt 现在这份为准）。
   */
  pageReviewed?: boolean
  reviews: Record<number, { originalText: string; reason: string }>
  /** 第 2 批：整话已校条数（页头「已校：N」按钮上的数字）。 */
  reviewCount: number
  /**
   * 2026-10-07：**本会话在这份 txt 上还有可退的保存**（Ctrl+Z 每按一次退一步）。
   *
   * 状态条据此放一枚**只表示有/无**的小标 —— **不做步数显示**（用户拍板）。
   */
  canUndoSaved: boolean
  /**
   * 第 5 批：页头那枚「新增框」开关开着没有。
   *
   * 开着 ⇒ 左键**点一下**图 = 新增框内、**右键**点图 = 新增框外，**拖一下**仍是平移；
   * 关着 ⇒ 图上一切照旧（平移/缩放不被任何东西打扰）—— 默认就是关。
   */
  addFrameMode: boolean
}
