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
 * 这里**不做**的事：「路径当查找键」（`normalizeImportedPath` 那一类）**尚未**全部收拢。
 * 它在三个模块里是**三种不同语义**（见 §13 第 21 条），合并等于改行为，留给 P4。
 *
 * ⚠️ 但 2026-10-05 起有**一处例外**：`project-self-check.ts` 与 `ProjectFormModal.vue`
 * 里那两份**逐字同义**的"路径当键"实现（反斜杠→斜杠 + NFC + 小写 + 剥尾斜杠）
 * 已合并为本文件的 `normalizePathKey()` —— 合并的是**同义**的两份，不是那三种不同语义；
 * `database.ts` / `CompareViewer.vue` 那两份照旧不动（它们各自还有别的差别）。
 * 新增代码要"把路径当键"时，一律用 `normalizePathKey()`。
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
 * 「路径当查找键」的归一化：反斜杠→正斜杠、NFC、小写、剥掉尾部分隔符。
 *
 * ⚠️ 这四步的顺序是**契约**（与收敛前那两份逐字同义，别顺手调顺序）：
 * 先转斜杠再剥尾斜杠，于是 `'D:\\'` 与 `'D:/'` 都归一成 `'d:'`（卷本身）。
 * ⚠️ 只在**同义的两份**之间做过合并；`database.ts` 的 `normalizeImportedPath` 与
 * `CompareViewer.vue` 的 `normalizePath` 语义仍有差别，**不许**顺手替换（§13 第 21 条）。
 */
export function normalizePathKey(path: string): string {
  return path.replace(/\\/g, '/').normalize('NFC').toLocaleLowerCase().replace(/\/+$/, '')
}

/**
 * 把路径切成「卷 + 各级目录」用于比较 —— 分段而不是比字符串，
 * 这样 `'D:\某作品'` 不会被当成 `'D:\某作品5卷'` 的父目录（字符串前缀的经典坑）。
 *
 * · 卷：盘符（`d:`）或 UNC 的「服务器 + 共享」（`//srv/share`）；
 * · `.` 段丢掉、`..` 段回退一级，但**卷那一段永远不参与回退**；
 * · 以 `//` 开头的按 UNC 解析（Windows 语义）。
 *
 * 输入应当已是绝对路径 —— 本项目的调用点全部如此（见下面"已知差异"）。
 */
function pathSegments(path: string): string[] {
  const key = normalizePathKey(path)
  if (!key) return []

  if (key.startsWith('//')) {
    const [host, share, ...rest] = key.slice(2).split('/').filter(Boolean)
    if (host === undefined) return []
    if (share === undefined) return [`//${host}`]
    return [`//${host}/${share}`, ...foldDotSegments(rest)]
  }

  const [volume, ...rest] = key.split('/').filter(Boolean)
  if (volume === undefined) return []
  return [volume, ...foldDotSegments(rest)]
}

/** 折叠 `.` 与 `..`（卷那一段由调用方保留，不在这里回退）。 */
function foldDotSegments(segments: readonly string[]): string[] {
  const folded: string[] = []
  for (const segment of segments) {
    if (segment === '.') continue
    if (segment === '..') folded.pop()
    else folded.push(segment)
  }
  return folded
}

/**
 * `candidate` 是否在 `container` 里面 —— **等于它自己也算**。
 *
 * 用在"这个候选是不是某个扫描根本身、或某个根的祖先"这类判定上
 * （`isGroupingLevel`：容器层不算章节，所以"根本身"必须也算命中）。
 *
 * ⚠️ 不同卷（盘符不同、盘符与 UNC、不同服务器）**永远**互不包含 ——
 * 这一条正是 2026-10-04 那个洞：`path.relative()` 跨盘时返回**绝对路径**，
 * 只判 `''` / `'..'` 的实现会把它当成"在里面"。
 */
export function isPathInside(container: string, candidate: string): boolean {
  const parent = pathSegments(container)
  const child = pathSegments(candidate)
  if (parent.length === 0 || child.length < parent.length) return false
  return parent.every((segment, index) => segment === child[index])
}

/**
 * `candidate` 是否**严格**在 `container` 里面（等于它自己**不算**）。
 *
 * ⚠️ 与 `isPathInside` 只差"能不能相等"这一条，但两者**不能互相替代**：
 * 录入侧拦"选到了别的章节的上级目录"、推导侧拦"反推出的根是容器层"都要求**严格**，
 * 而"根本身不算候选"那一处要求**非严格**。要改判据，先看清调用点要的是哪一种。
 */
export function isStrictlyInside(container: string, candidate: string): boolean {
  const parent = pathSegments(container)
  const child = pathSegments(candidate)
  if (parent.length === 0 || child.length <= parent.length) return false
  return parent.every((segment, index) => segment === child[index])
}
