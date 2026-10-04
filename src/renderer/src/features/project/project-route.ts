/**
 * Chapter URLs and the opening screen.
 *
 * `childWorkbenchPath()` is the single place that builds a workbench URL, and
 * `resolveStartupPath()` decides where a fresh window lands. Both are pure
 * (same shape as `card-action.ts`) so the whole decision table is testable
 * without a router or a DOM.
 */
import type { ParentProject } from '@shared/types'

/** Path of the project picker (also the landing page when nothing is known). */
export const PROJECT_LIST_PATH = '/project'

/**
 * Canonical workbench path for one chapter.
 *
 * `parentTitle` is decorative — `Project.vue` resolves the chapter from its id
 * alone — but every entry point (dashboard card, picker row, sidebar click,
 * startup restore) has to build the URL the same way, so they all use this.
 */
export function childWorkbenchPath(parentTitle: string, childId: string): string {
  return `${PROJECT_LIST_PATH}/${encodeURIComponent(parentTitle)}/${childId}`
}

/** Route name of the app's default landing page (the dashboard). */
const DEFAULT_ROUTE_NAME = 'dashboard'

export interface StartupRouteInput {
  /**
   * Route name the window resolved to before the app mounted. Callers must
   * await `router.isReady()` first — until the initial navigation settles this
   * is still `undefined` and the decision would be wrong.
   */
  routeName: string | undefined
  /** Chapter ids the user actually opened, newest first (`recentProjectIds`). */
  recentChildIds: readonly string[]
  parents: readonly ParentProject[]
}

export function resolveStartupPath(input: StartupRouteInput): string | null {
  // An explicit entry point wins: deep links (`#/project/...`) and the
  // standalone LabelPlus preview window must never be redirected.
  if (input.routeName !== DEFAULT_ROUTE_NAME) return null

  const chapters = input.parents.flatMap((parent) =>
    parent.children.map((child) => ({ parentTitle: child.parentTitle, childId: child.id }))
  )

  // 1) Where the user left off — skipping records whose chapter is gone
  //    (deleted project, or a rebuilt registry with fresh ids).
  for (const childId of input.recentChildIds) {
    const hit = chapters.find((chapter) => chapter.childId === childId)
    if (hit) return childWorkbenchPath(hit.parentTitle, hit.childId)
  }

  // 2) Nothing remembered: a single-chapter library has one sensible home.
  if (chapters.length === 1) {
    return childWorkbenchPath(chapters[0].parentTitle, chapters[0].childId)
  }

  // 3) Otherwise the picker — which also shows the "还没有项目" empty state.
  return PROJECT_LIST_PATH
}

export interface ProjectNavInput {
  /** 当前所在的路由名（`route.name`）。 */
  routeName: string | undefined
  /** 本会话里正在查看的那一话（`workspace.activeChild`），没有则 null。 */
  activeChild: { id: string; parentTitle: string } | null
  /**
   * 当前注册表。用来确认那一话**还在** —— 注册表可能被重建（id 会变），
   * 而 store 只在 loadParents 命中时才更新 activeChild，没命中时不会清空，
   * 所以这里必须自己校验一次（与 `resolveStartupPath` 校验 recentProjectIds 同理）。
   */
  parents: readonly ParentProject[]
}

/**
 * 「项目」导航按钮的落点。
 *
 * 用户报的痛点：从首页/成就切回「项目」只看到列表，必须先点开父级、再点章节，
 * 才能回到刚才在编辑的那一话。
 *
 * 规则（按顺序）：
 * 1. **已经**在项目相关页面（列表或详情）→ 回列表页。没有这条，一旦进过详情页
 *    列表页就再也到不了了（导航里只有这一个入口）。
 * 2. 从别的页面切回来，且本会话看过某一话 → 直接回那一话。
 * 3. 否则 → 列表页。
 *
 * 与 §4.4 不冲突：那里删掉的是"按文件 mtime **猜**最新的一话"（自动、随机、
 * 不可预期）；这里是"回到用户本会话**真正打开过**的那一话"，与 §4.5 的启动
 * 落点是同一条原则。
 */
export function resolveProjectNavPath(input: ProjectNavInput): string {
  if (input.routeName === 'project' || input.routeName === 'projectIndex') {
    return PROJECT_LIST_PATH
  }
  const active = input.activeChild
  if (active && input.parents.some((p) => p.children.some((c) => c.id === active.id))) {
    return childWorkbenchPath(active.parentTitle, active.id)
  }
  return PROJECT_LIST_PATH
}
