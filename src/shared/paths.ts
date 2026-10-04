/**
 * 路径整形（2026-10-01 重构 P1）—— 全项目**唯一一处**该逻辑。
 *
 * 为什么要收：同一个"取路径最后一段"在 11 个文件里各写了一遍，写法还分三种
 * （多数是 `.pop()`、几处是 `.filter(Boolean).pop()`、`Import.vue` 那份还多带一个 `/u`）。
 * 哪天要支持 UNC、或改大小写规则，就得改 11 处，必漏 —— 这就是"改一处漏九处"的典型。
 *
 * ⚠️ 这里**故意保留两种语义**，因为线上行为不能变、而它们真的不一样：
 *   · `basenameOf()`      与 `p.split(/[\\/]/).pop()` **逐字同义** —— 尾部分隔符会得到**空串**；
 *   · `lastPathSegment()` 与 `p.split(/[\\/]/).filter(Boolean).pop() ?? fallback` 同义 ——
 *     跳过空段，所以 `'E:\\漫画\\'` 得到 `'漫画'`。
 *
 * 新代码要显示"名字"时**一律用 `lastPathSegment`**（尾斜杠给出空标签是 bug，不是特性）；
 * `basenameOf` 的存在只为"与改前完全一致"，将来若要统一成一种语义，那是一次**行为变更**，
 * 要单独论证（照 §13 第 22 条的规矩走）。
 *
 * 这里**不做**的事：「路径当查找键」（`normalizeImportedPath` 那一类）。
 * 它在三个模块里是**三种不同语义**（见 §13 第 21 条），合并等于改行为，留给 P4。
 */

/** Windows 与 POSIX 的分隔符（与各处原来写的 `/[\\/]/` 逐字一致）。 */
const SEPARATORS = /[\\/]/

/** 取路径最后一段；与 `p.split(/[\\/]/).pop()` 完全同义（尾部分隔符 → 空串）。 */
export function basenameOf(path: string): string {
  return path.split(SEPARATORS).pop() ?? ''
}

/** 取最后一段**非空**内容；整条路径为空（或以分隔符结尾且前面没有内容）时返回 `fallback`。 */
export function lastPathSegment(path: string, fallback = ''): string {
  return path.split(SEPARATORS).filter(Boolean).pop() ?? fallback
}

/**
 * 读父级的"记住的扫描根"（`sourceRoots`）—— 只做"是不是一串**非空字符串**"这一层清洗。
 *
 * ⚠️ **去重与归一化不在这里**：那是主进程 `project-self-check.ts` 的 `normalizeRoots()`，
 * 它用的是"路径当 key"那套语义（大小写 / NFC / 尾斜杠，见 §13 第 21 条：同一规则只允许一处）。
 * 渲染层只需要把字段**原样带过去** —— 它不参与自检推导，但**整树保存会把它写回去**，
 * 丢了就等于把用户记住的多个根抹成单根（2026-10-03 修的那个丢字段 bug）。
 */
export function readRememberedRoots(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}
