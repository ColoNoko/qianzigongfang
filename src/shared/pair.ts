import { lastPathSegment } from './paths'

/**
 * 配对键（2026-10-01 重构 P2）—— 全项目**唯一一处**决定"哪张原图与哪个 PSD 是同一页"的规则。
 *
 * 收之前是**两本账**：
 *   · `main/services/scanner.ts` 的 `getStemLookupKey()`：`basename(p, extname(p))` → NFC → 小写；
 *   · `renderer/src/components/CompareViewer.vue` 的 `stemKey()`：取"最后一个点"之前的部分 → NFC → 小写。
 * 各写一遍的代价不是"不好看"：哪天只改了一边，**侧栏配好的对**与**对照视图显示的图**就可能不是同一张，
 * 而标记是按"当前显示的那张"落库的 —— 会落到错的页上。
 *
 * 语义取**扫描器那套**（即 node 的 `basename(p, extname(p))`），但用纯字符串实现：
 * `shared/` 不许 import node 内置（它要同时打进渲染层，见 §13 第 20 条的分层）。
 *
 * ⚠️ 用 `lastPathSegment`（跳过空段）而不是 `basenameOf`（朴素 pop）—— 这不是随手选的：
 * node 的 `basename()` 会**剥掉尾部分隔符**（`'E:\\a\\b\\'` → `'b'`），而朴素 pop 会给空串。
 * 2026-10-01 写这一组的锁时，正是这条差别当场把测试打红（语料里带了一个尾分隔符样本），
 * 才发现两种写法在"尾分隔符"这一类输入上并不等价 —— 所以这里选与 node 语义一致的那个。
 *
 * ⚠️ 与对照视图旧写法**已知的差异**（都**不可达**，两侧都只对"扩展名在白名单里"的文件求键）：
 *   ① 整段名字就是隐藏文件（`.hidden`，点在首位且只有这一个点）：旧写法给空串，本函数给 `.hidden`；
 *   ② 尾部分隔符路径（`E:\\a\\b\\`）：旧写法给空串，本函数给 `b`。
 * 两条都有专门的用例盯着（`shared/__tests__/pair.spec.ts`），别当成遗漏。
 *
 * 这里**不做**的事：「**怎么找**」—— 在哪些目录里找、并列时怎么排序，两侧各自保留自己的策略。
 * 顺带记录：扫描器的 `imageRank()` 与对照视图的 `imageRank()` 排序规则**并不相同**
 * （前者按 `relative()` 的段数、后者按自己 normalize 后的段数），合并它们属于另一场论证，不在 P2。
 */
export function pairKeyOf(absPath: string): string {
  return stemOf(lastPathSegment(absPath)).normalize('NFC').toLocaleLowerCase()
}

/** 砍掉最后一个扩展名；与 node 的 `basename(p, extname(p))` 同义（点在首位时不算扩展名）。 */
function stemOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}
