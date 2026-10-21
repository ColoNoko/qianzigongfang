/**
 * 译文分组色 —— 「第几组用哪个颜色」的**唯一出处**。
 *
 * 分组顺序来自 LabelPlus 文本自己的分组表（`document.groups`），
 * 第 1 组红、第 2 组蓝（照 LabelPlusFX 的"框内红 / 框外蓝"），第 3/4 组绿 / 琥珀，
 * 四个用完之后**循环**（第 5 组回到红）。颜色值在 `styles/tokens.css` 的 `--lp-group-1..4`。
 *
 * ⚠️ 这里**不做任何"像不像同一组"的推断**：认不出分组名就给第 1 档，不猜。
 */
export const LP_GROUP_PALETTE_SIZE = 4

/** 分组名 → 色槽编号（1..4）。找不到 / 名字为空 ⇒ 1。 */
export function lpGroupColorIndex(
  groups: readonly string[] | null | undefined,
  group: string | null | undefined
): number {
  const list = Array.isArray(groups) ? groups : []
  const name = typeof group === 'string' ? group.trim() : ''
  const position = name ? list.findIndex((item) => String(item).trim() === name) : -1
  const zeroBased = position >= 0 ? position : 0
  return (zeroBased % LP_GROUP_PALETTE_SIZE) + 1
}

/** 色槽编号 → CSS 变量名（模板里 `var(--lp-group-N)` 用）。 */
export function lpGroupColorVar(index: number): string {
  const safe = Number.isFinite(index) ? Math.trunc(index) : 1
  const slot = ((safe - 1 + LP_GROUP_PALETTE_SIZE) % LP_GROUP_PALETTE_SIZE) + 1
  return `--lp-group-${slot}`
}

/** 分组名 → 可直接写进 style 的 CSS 变量名。 */
export function lpGroupVarFor(groups: readonly string[] | null | undefined, group: string): string {
  return lpGroupColorVar(lpGroupColorIndex(groups, group))
}
