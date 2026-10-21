/**
 * 键盘快捷键的"这一下该不该管"判断（2026-10-06）。
 *
 * 从 `views/Project.vue` 的撤销热键里抽出来 —— 对照视图那条"方向键翻页"要用**同一个**判断，
 * 而"哪些元素算正在输入"这种事写两份必然漂（本仓库为"同一条规则两处各写一份"栽过不止一次）。
 *
 * 判据刻意保持**纯粹**：只看元素本身，不看"用户是不是在打字"这种猜不出来的东西。
 * 也不去拦 `select` —— 那是既有那条撤销热键的原始口径，抽出来是为了共用，不是为了改它。
 */
export function isTextEntryTarget(target: EventTarget | null | undefined): boolean {
  const element = target as (HTMLElement & { isContentEditable?: boolean }) | null | undefined
  const tag = element?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea') return true
  return element?.isContentEditable === true
}

/**
 * 「新增框」的 **Tab 入口**该不该管（第 5 批 5d-2，2026-10-07）。
 *
 * ## 口径 A：**只认"焦点在原图栏内"**（用户拍板）
 *
 * 这个函数**不做**"鼠标停在哪"的判断 —— 那是口径 B，用户没选。
 * 「在栏内」由 DOM 结构保证：监听挂在**原图栏根容器**上，而 Tab 的 keydown 只发给聚焦元素。
 *
 * ## ⚠️ 2026-10-07 真机更正：光有"焦点在栏内"**不够** —— 必须锚在**图片那张可聚焦层**上
 *
 * 第一版只判了 `container.contains(target)`（容器 = 原图栏根）。真机上完全是坏的，两条都坏：
 *
 * 1. **点图之后按 Tab 不会切模式，而是把焦点跳到右栏第一条译文上**。
 *    原因：手势层是个普通 `div`，**根本收不到焦点** —— 点它之后 `document.activeElement`
 *    还是 `<body>`，于是 keydown 落在 body 上，压根没进原图栏这个容器；
 *    浏览器按默认 Tab 顺序走，第一个停靠点正是右栏那排行按钮。
 *    ⇒ 治法：手势层加 `tabindex="0"`（**能聚焦才谈得上"焦点在栏内"**），并把它当判据的锚点。
 * 2. **进去之后出不来**：原来 `preventDefault()` 无条件挡掉默认行为 ⇒ 焦点被焊在栏内，
 *    只能拿鼠标去点页头那枚开关退出。
 *    ⇒ 治法：`PreventDefault` 只发生在真的**切了模式**那一下；此后焦点在栏内别的地方
 *    （行按钮 / 档位 / 缩放控件）时**一律放行**，Tab 恢复成正常的移焦 —— 这就是"能退出去"。
 *
 * 这两条合起来才是完整的口径：**Tab 在原图上切模式，在栏内别处正常移焦**。
 *
 * ## 它负责的三条闸
 *
 * 1. **锚点**：事件目标必须**就是**那个可聚焦的图片层（不是"在容器内就行"）。
 * 2. **修饰键一律不认** —— `Ctrl/Alt/Meta+Tab` 是别的快捷键（切标签、切窗口）；
 *    `Shift+Tab` 是**反向移焦**，认了会让人找不到焦点跑到哪去。
 * 3. **焦点其实在输入框里 ⇒ 不认** —— 复用 `isTextEntryTarget`（**不新写一份判据**）。
 */
export function shouldToggleAddModeByTab(
  event: Pick<KeyboardEvent, 'key' | 'target' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  anchor: Element | null | undefined
): boolean {
  if (event.key !== 'Tab') return false
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  if (isTextEntryTarget(event.target)) return false
  if (!anchor) return false
  // ⚠️ 是"**就是它**"，不是"在它里面"：容器判据会让"焦点在某条译文行上"也算数，
  //    那正是真机上"按一下 Tab 焦点跳到译文上、再按一下才切模式"的由来。
  return event.target === anchor
}
