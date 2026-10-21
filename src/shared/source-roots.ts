import type { ParentProject } from './types'
import { isStrictlyInside, normalizePathKey } from './paths'

/**
 * 「记住的扫描根」（`sourceRoots` + 旧字段 `sourceRoot`）的规则 —— 全项目**唯一一处**
 * （2026-10-05 收编）。
 *
 * 为什么要单独一个文件（而不是塞进 `project-repository.ts` 或 `paths.ts`）：
 *   ① 这一组规则**纯**（不碰数据库、不碰磁盘），主进程与渲染层都要用 ——
 *      放在仓库那一层，任何把仓库整个 mock 掉的测试都会连带把它也 mock 掉
 *      （`project-self-check.spec.ts` 就是这种写法，当场把两条锁打红了）；
 *   ② 与 `shared/duties.ts`（职责规则）、`shared/pair.ts`（配对键）同一套做法：
 *      **一个领域规则一个文件**，主进程与渲染层共用，谁也不许再抄第二份。
 *
 * 背景（为什么两个字段必须一起写）：`sourceRoots` 是主字段（多根自检靠它），
 * `sourceRoot` 是旧版单根字段（旧读取方只认它，读取时拼在 `sourceRoots` 后面）。
 * 收敛前只有一条"写单个根"的通道，而且它**只改旧字段** ——
 * 自检弹窗那条「记住此目录并检测」在"检测到 0 个新章节 / 检测失败"这类**提前退出**的
 * 路上会留下半截状态：新目录写进旧字段，`sourceRoots` 里几个旧根还在，
 * 下次自动检测时**旧根排在前面照样被扫**（用户以为已经换掉了）。
 */

/**
 * 读父级的"记住的扫描根"（渲染层用的**轻清洗**）—— 只做"是不是一串**非空字符串**"。
 *
 * ⚠️ **去重与归一化不在这里**（那是 `normalizeRememberedRoots` 的事，归主进程写入侧）。
 * 渲染层只需要把字段**原样带过去** —— 它不参与自检推导，但**整树保存会把它写回去**，
 * 丢了就等于把用户记住的多个根抹成单根（2026-10-03 修的那个丢字段 bug）。
 */
export function readRememberedRoots(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

/**
 * 清洗「记住的扫描根」：丢掉非字符串 / 空串 / 纯空白，按 `normalizePathKey` 去重，
 * **保留第一次出现的原样写法与顺序**（存进库的是用户当初选的那条路径）。
 *
 * ⚠️ 顺序有意义：`sourceRoots[0]` 会同步成兼容字段 `sourceRoot`。
 * ⚠️ 与 `readRememberedRoots()` 的分工**别混**：那一份是渲染层"原样带过去"用的；
 * 这一份是**写入与推导前**的完整清洗。**两条写入通道都必须过这一份** ——
 * 各洗各的，就会出现"存进去的根"与"扫出来的根"不是同一批。
 */
export function normalizeRememberedRoots(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const raw of values) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const key = normalizePathKey(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    roots.push(trimmed)
  }
  return roots
}

/**
 * 把"记住的扫描根"写进**一个父级对象**上 —— 唯一的写入口。
 *
 * 传空 / 全是垃圾值 ⇒ **删掉两个字段** = 恢复"按各话路径自动推导"，
 * 不留一个空数组在库里（与 `setParentDuties` 的"空数组 = 清空"同一口径）。
 *
 * 提成纯函数（而不是只在仓库事务里写一遍）是为了让 `importParentSelfCheck` 那个
 * 已经在事务里的 mutator 也能用它 —— 否则那处会变成第二份"写一对字段"的实现。
 */
export function applyParentSourceRoots(
  parent: ParentProject,
  roots: readonly unknown[] | null
): void {
  const clean = normalizeRememberedRoots(roots ?? [])
  if (clean.length === 0) {
    delete parent.sourceRoots
    delete parent.sourceRoot
    return
  }
  parent.sourceRoots = clean
  // 兼容旧读取方：单根字段同步成主根。
  parent.sourceRoot = clean[0]
}

/**
 * `root` 这个目录下面，住着**别的父级**的话吗？返回**那一部作品**（不是布尔）。
 *
 * 这是"反推出的根是不是容器层（分类目录 / 作品目录）"那条判据，**全项目唯一一处**：
 *   · 主进程自检 `project-self-check.ts` 用它丢掉容器层（B1，2026-10-04 拍板）；
 *   · 「修改扫描目录」弹窗用它把"这个目录里住着《鹅妈妈》的话"红字说出来
 *     （2026-10-05）—— 同一把尺子，别的作品的名字也就有了着落。
 *
 * ⚠️ **自己的话不算**：扫描根本来就是"各话所在的那一层"，它必然是自己那些话的上级；
 *    若把这一步也算命中，**任何**根都会被判成容器层，B1 会全盘失效。
 * ⚠️ 判据刻意**只用路径关系**（`isStrictlyInside`），不用"像不像章节"的启发式 ——
 *    那类启发式（`hasRootProjectFiles`）正是 2026-10-04 那次 28 条误报的来源。
 * ⚠️ 跨卷（盘符 / UNC 服务器共享）永远不算"在里面"，见 `isStrictlyInside`。
 */
export function findOtherParentInside(
  root: string,
  parentId: string,
  projects: readonly ParentProject[]
): ParentProject | undefined {
  for (const other of projects) {
    if (other.id === parentId) continue
    for (const child of other.children) {
      if (isStrictlyInside(root, child.folderPath)) return other
    }
  }
  return undefined
}
