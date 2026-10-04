/**
 * 新手引导的内容（纯数据，不含任何渲染）。
 *
 * 为什么单独一个文件：
 *   - `GuideDialog.vue` 只管"壳"（入口页、翻页、按钮、键盘），`GuideArt.vue` 只管"图例"；
 *     改文案不用碰这两个组件。
 *   - `GUIDE_VERSION` 与内容**同源**：加页 / 大改内容就在这里 +1，已经看过引导的用户会再看到一次
 *     （"看过"的状态存在 settings 的 `ui.guideSeenVersion`，见交接文档 §13.9）。
 *
 * ## 两层结构（2026-10-03 改版）
 *
 * ```text
 * 入口页（GUIDE_ENTRY）  ← 打开时停在这里：挑"上手"还是"进阶"，也可以直接跳过
 *   ├─ 上手栏 GUIDE_BASIC_PAGES（5 页）   左边导航 / 工作台按钮 / 四种模式 / 外部工具 / 另外三个模块
 *   └─ 进阶栏 GUIDE_ADVANCED_PAGES（4 页）职责 / 进度 / 标记有记录 / 看图与对照
 * ```
 *
 * 为什么分层：加了几块新功能之后，老用户不需要重看"左边这条是干什么的"，
 * 但新东西得讲 —— 于是先让人**挑一栏**，而不是每次都把整本翻一遍。
 * ⚠️ **页脚页码按栏各算各的**（上手栏「第 2 / 5 页」、进阶栏「第 2 / 3 页」），
 * 入口页不显示页码；`GUIDE_PAGES` 是两栏拼起来的**平铺视图**，只给"全量数据检查"与截图工装用。
 *
 * ## 结构与"一句说明就紧跟对应图例"
 *
 * 每页是一串 **block**：`kind: 'lead'` 是导语（大一点），`kind: 'point'` 是列表要点；
 * 每块后面可以跟 0~N 张图例（`arts`），渲染时**图例紧贴在它那段文字下面**。
 * 一个要点配两张图例是允许的（例如"管理"那条要同时给"工具条"和"多选条"）。
 *
 * ## 图例的来源（用户 2026-09-27 提供的 9 张参照图，一张都不能漏）
 *
 * | 用户的图 | 内容 | 落在哪 |
 * |---|---|---|
 * | 图一 | **改造前的第 2 页**（样式基准，不是图例） | 不进引导 —— 它是"改之前长什么样" |
 * | 图二 | 整张工作台（左树 + 右卡片网格） | 上手第 2 页导语 → `workbench` |
 * | 图三 | 侧栏工具条：添加/修改/删除 + 管理 | 上手第 2 页「管理」那条 → **2026-10-04 起与图四合成为一张** `sidebar-manage` |
 * | 图四 | 多选条 + 父级行的「重命名 / ⋮⋮」 | 同上（合进 `sidebar-manage`） |
 * | 图五 | 侧栏两行进度（翻译进度 0/24、16/16） | 上手第 2 页「每行进度」那条 → `row-progress` |
 * | 图六 | 「去嵌字」胶囊 | 上手第 2 页「去X」那条 → `card-actions`（与图七合成一张） |
 * | 图七 | 「去翻译」胶囊 | 同上 |
 * | 图八 | 对照视图（原图 \| PSD + 四个按钮） | 上手第 2 页「双击」那条 → `compare` |
 * | 图九 | 模式下拉展开（嵌字/翻译/校对/监修） | **上手第 3 页**导语 → `mode-dropdown` |
 *
 * 2026-10-03 新增四张（进阶栏）：`parent-duty`（父级职责胶囊 + 菜单）、
 * `progress`（进度页的欠账清单）、`mark-ledger`（撤销 / 台账 / 备份）、
 * `viewer-controls`（缩放 / 胶片条 / 播放 / 标记后下一张）。
 *
 * 2026-10-04（用户看图后 8 条）：新增 `add-project`（点「添加」后那张表单，
 * 注意点**写在框内**）；`sidebar-toolbar` + `sidebar-multiselect` 合成 `sidebar-manage`；
 * **删掉 `settings-form`**（第 4 页改成"一处介绍紧跟一处填写框"，不再放示意图）。
 * ⚠️ 线框里的字（`GUIDE_NAV_SECTIONS[].wireWords`）必须**从该条文案里取** ——
 * 图与文同一套词，`GuideArt.spec` 有锁盯着。
 *
 * （图二里还能看到「打开当前文件夹 / 刷新」，上手第 2 页最后一条用它 → `toolbar-strip`。）
 *
 * **图例一律是"复刻重画的迷你控件"**，不是截图：布局照着参照图，但漫画画面换成
 * **纯色块 + 中间两个字**（例如灰色矩形里写「原图」），所以昼夜模式自动都对、
 * 也不会把漫画画面和用户的硬盘路径打进安装包。
 *
 * ⚠️ 里面对应的界面文案都是**真实文案**，改界面时顺手搜一下这里：
 *   - 上手第 1 页 ←→ `App.vue` 的 `navItems`
 *   - 上手第 2 页 ←→ `views/Project.vue`（工具栏）、`components/ProjectSidebar.vue`、
 *                   `components/ThumbGrid.vue`（卡片上的「去X」与左下角状态点）、
 *                   `components/CompareViewer.vue`
 *   - 上手第 3 页 ←→ `@shared/modes`（模式名从这里取，不手抄）
 *   - **上手第 2 页「去X」那三条说的是"点下去会发生什么"** ←→ 唯一出处是
 *     `features/project/card-action.ts` 的路由矩阵（`card-action.spec.ts` 锁着 13 条）。
 *     矩阵一改，这里要跟着改 —— 别让说明书和程序说的不一样。
 *   - 上手第 4 页 ←→ `views/Settings.vue` 的「外部工具」区块
 *   - **进阶第 1 页 ←→ `components/ProjectTree.vue`（父级行那枚职责胶囊）+
 *     `views/Project.vue` 的"落脚对齐模式"（`shared/duties.ts`）**
 *   - **进阶第 2 页 ←→ `views/Progress.vue`（逐本欠账清单 + 时间线抽屉）与 `shared/progress.ts`**
 *   - **进阶第 3 页 ←→ `views/Settings.vue` 的「数据安全」卡（撤销 / 标记记录 / 备份 / 诊断）**
 *   - **进阶第 4 页 ←→ `components/CompareViewer.vue`（缩放 / 胶片条 / 播放 / `⇥ 标记后下一张`）
 *     与 `views/Settings.vue` 的「播放间隔」设置项** —— ⚠️ 「标记后下一张」**不在设置页**，
 *     它只在对照视图的工具条上（`compare-advance-toggle`），这里写错过一次。
 */
import { WORK_MODE_LABELS, WORK_MODES, WORK_MODE_SHORT_LABELS } from '@shared/modes'

export type GuideArtId =
  | 'nav'
  | 'workbench'
  | 'add-project'
  | 'sidebar-manage'
  | 'row-progress'
  | 'card-actions'
  | 'compare'
  | 'toolbar-strip'
  | 'mode-dropdown'
  | 'modules'
  | 'parent-duty'
  | 'progress'
  | 'mark-ledger'
  | 'viewer-controls'

/**
 * 一块文字。**三层**（用户 2026-09-27 定的写法，样式见 `GuideDialog.vue`）：
 *
 *   ① `label` 结论/标签 —— 浅底盒 + 主色字。短的会自然收缩成一枚小胶囊，
 *      长的就成一条盒子（一个写法两种效果）。
 *   ② `text` 解说 —— 正文色，必填。
 *   ③ `note` 例子 / 补充 —— 三级灰、小一号。可空。
 *
 * `lead`（导语）只用 `text`；`point`（列表要点）**每条都要有 `label`** ——
 * 这正是"先扫结论再看细节"的读法，`guide-pages.spec` 里有锁。
 */
export interface GuideBlock {
  kind: 'lead' | 'point'
  /** ① 结论 / 标签（浅底盒 + 主色字） */
  label?: string
  /** ② 解说（正文色） */
  text: string
  /** ③ 例子 / 补充（三级灰） */
  note?: string
  /** 紧跟在上面这块文字后面的图例（可 0~N 张，**竖着堆**） */
  arts?: readonly GuideArtId[]
  /**
   * 紧跟在上面这块文字后面的图例，但**左右并排**（用户 2026-10-04：两张图左右排列）。
   * 与 `arts` 二选一；并排时每张各占一半、各自居中。
   */
  artsRow?: readonly GuideArtId[]
  /**
   * 这一块后面**紧跟它自己的填写框**（第 4 页那三个外部工具路径）。
   * 用户 2026-10-04：一处介绍对应一处填写链接，而不是三处介绍完了再堆三个框。
   */
  toolField?: GuideToolFieldId
  /**
   * 配 `slides` 用：这一条对应"右边线框画哪一张 / 左边哪一项高亮"。
   * 第 1 页那 8 条各带一个，图与文案因此**不可能不同步**。
   */
  focus?: GuideNavWire
}

export interface GuidePage {
  id: string
  /** 页标题（**不带编号** —— 编号由 `guideTitleWithNo()` 按平铺顺序推出来） */
  title: string
  blocks: readonly GuideBlock[]
  /** 这一页的要点**一屏一条、左右翻**（而不是竖着堆）—— 目前只有第 1 页这么排 */
  slides?: boolean
  /** 配 `slides` 用：固定在文案上方的图例（不随翻页滚动） */
  fixedArt?: GuideArtId
}

export type GuideLaneId = 'basics' | 'advanced'

export interface GuideLane {
  id: GuideLaneId
  /** 入口页上那枚按钮的标题 */
  label: string
  /** 入口页上按钮下面那行小字（这一栏讲什么） */
  hint: string
  /** 可选小标，例如"本次新增" */
  tag?: string
  pages: readonly GuidePage[]
}

/**
 * 内容版本。
 *
 * 加页 / 大改内容时 +1：老用户的 `ui.guideSeenVersion` 比它小，就会再看到一次
 * **更新后的**引导（这正是用版本号而不是 true/false 的原因）。
 *
 * 2026-10-03：1 → 2（入口页 + 进阶栏 3 页 + 上手第 2 页那条纠错）。
 * 2026-10-03：2 → 3（新增「进度」页、导航清单补「进度」、台账页补「诊断」一句）。
 * 2026-10-03：3 → 4（向导化：标题带 01~09 编号、首次强制看基础、重看先给入口页、
 *   第 1 页改成"大图固定 + 文案左右翻 + 右线框跟着走"、第 4 页可就地填外部工具）。
 * 2026-10-04：4 → 5（用户看图后的 8 条：导语跟上 v4 的翻看交互、线框里写上同一批词、
 *   两张图左右排列 + 新增"添加项目"表单图、图例不再占满整宽、删掉讲圆点那一条、
 *   两条「去X」合并成一条、第 4 页删示意图改成"一处介绍紧跟一处填写框"）。
 */
export const GUIDE_VERSION = 5

/** 入口页（挑一栏的地方）。它**不是内容页**：不计入页码、没有上一步 / 下一步。 */
export const GUIDE_ENTRY = {
  title: '先看哪一部分？',
  lead: '这是「汉化工坊」的说明书。挑一部分开始 —— 之后随时可以在左下角点「指引」再进来。'
} as const

/** 上手第 3 页那排模式胶囊用的标签（与工具栏同源，改模式名不会两边不一致）。 */
export const GUIDE_MODE_CHIPS = WORK_MODES.map((mode) => ({
  mode,
  label: WORK_MODE_LABELS[mode]
}))

/**
 * 进阶第 1 页那张图例（职责胶囊 + 菜单）用的模式清单：全称给菜单、单字给胶囊。
 * 与 `ProjectTree.vue` 里的写法同源 —— 改模式名只改 `@shared/modes`。
 */
export const GUIDE_DUTY_CHIPS = WORK_MODES.map((mode) => ({
  mode,
  label: WORK_MODE_LABELS[mode],
  short: WORK_MODE_SHORT_LABELS[mode]
}))

/**
 * 进阶第 1 页那张图例里"已经选中的两个职责"（示例）。
 * 取「校对 + 监修」这个真实组合（用户库里 `青梅亭亭__校对&监修` 就是这么挂的）。
 */
export const GUIDE_DUTY_CHOSEN: readonly string[] = ['proofread', 'supervised']

/**
 * 进阶第 2 页那张图例里的台账示例行（示意，不是真实数据）。
 * 与上手第 2 页的 `GUIDE_WORKBENCH_ROWS` 一样：图例里的数字都是**举例子**。
 */
export const GUIDE_LEDGER_ROWS = [
  { when: '10-03 12:20', mode: '校对', files: '12 个文件', settled: '还原' },
  { when: '10-03 11:58', mode: '监修', files: '3 个文件', settled: '已还原' }
] as const

/**
 * 第 1 页（总功能介绍）的**唯一出处**：左边导航图 + 右边线框 + 下面那条一屏一条的文案，全从这里来。
 *
 * `wire` 同时是两件事的键：① 右边线框画哪一张 ② 左边哪一项高亮 —— 所以两者**必然同步**
 * （用户 2026-10-03 的要求：高亮跟着当前项走，右边也要显示那一项的"大概样貌"）。
 * 最后一条「指引」是左下角那枚按钮、不在导航里，所以下面 `GUIDE_NAV_ITEMS` 要把它滤掉。
 */
export type GuideNavWire =
  | 'dashboard'
  | 'project'
  | 'progress'
  | 'achievements'
  | 'fonts'
  | 'import'
  | 'settings'
  | 'guide'

export const GUIDE_NAV_SECTIONS: readonly {
  label: string
  wire: GuideNavWire
  text: string
  note?: string
  /**
   * 这一项**线框图里写哪几个词**（用户 2026-10-04：示意图中的文字要和下方所选项的文案统一）。
   * 规矩：每个词都必须能在本条的 `label` / `text` / `note` 里**原样找到** ——
   * 图负责"长什么样"、文案负责"叫什么"，两边共用同一批词。
   * `GuideArt.spec.ts` 有两条锁：词在文案里、且真的画进了图里。
   */
  wireWords: readonly string[]
}[] = [
  {
    label: '首页',
    wire: 'dashboard',
    text: '打开就看见「最近在做的」项目、「待办清单」和「成就概览」。',
    note: '右上那枚「统计模式」下拉，跟「成就」页是同一个口径。',
    wireWords: ['最近在做的', '待办清单', '成就概览']
  },
  {
    label: '项目',
    wire: 'project',
    text: '所有漫画都在这儿登记，是这个软件的家。',
    note: '点「父级」把一本展开，再点某一「话」才进工作台。',
    wireWords: ['父级', '话']
  },
  {
    label: '进度',
    wire: 'progress',
    text: '逐本看「欠账」：还欠几话没熟、多久没动，一眼扫完。',
    note: '点那枚「职责」小胶囊能换口径 —— 详情见进阶栏「进度」。',
    wireWords: ['欠账', '职责', '多久没动']
  },
  {
    label: '成就',
    wire: 'achievements',
    text: '「按月」「按年」看你一共标记了多少张。',
    note: '数字来自「标记记录」—— 删图、挪目录都不会让它缩水。',
    wireWords: ['按月', '按年']
  },
  {
    label: '字体',
    wire: 'fonts',
    text: '在这儿「扫描」「安装」「卸载」Windows 字体，嵌字时就从这里挑。',
    note: '动作行里还有个「识字网」按钮 —— 点它用系统浏览器打开识字网，认不出的字去那儿识别、下载。',
    wireWords: ['扫描', '安装', '卸载']
  },
  {
    label: '导入',
    wire: 'import',
    text: '读 LabelPlus 的「txt」，直接「生成 PSD」。',
    note: '本地出图快；想要真竖排，就交给 Photoshop。',
    wireWords: ['txt', '生成 PSD']
  },
  {
    label: '设置',
    wire: 'settings',
    text: '「外部工具链接」、「缩略图大小」、「集数排序」都在这里。',
    wireWords: ['外部工具链接', '缩略图大小', '集数排序']
  },
  {
    label: '指引（左下角）',
    wire: 'guide',
    text: '「指引」就是这份教程，随时能点开再看一遍。',
    note: '第一次打开软件时，它会自己弹出来。',
    wireWords: ['指引']
  }
]

/**
 * 第 1 页示意图里的七项 —— 与 `App.vue` 的 `navItems` 一一对应（顺序也一样）。
 * ⚠️ 少了一项（比如新增页面忘了加）会让说明书和真实导航对不上 —— App-navigation.spec 有锁盯着。
 */
export const GUIDE_NAV_ITEMS: readonly string[] = GUIDE_NAV_SECTIONS.filter(
  (section) => section.wire !== 'guide'
).map((section) => section.label)

/**
 * 线框图里要写的字，按 `wire` 取（`GuideArt.vue` 只渲染，不自己编词）。
 * 从 `GUIDE_NAV_SECTIONS[].wireWords` 推出来 —— 与文案**同源**，不可能各说各的。
 */
export const GUIDE_WIRE_WORDS: Record<GuideNavWire, readonly string[]> = Object.fromEntries(
  GUIDE_NAV_SECTIONS.map((section) => [section.wire, section.wireWords])
) as Record<GuideNavWire, readonly string[]>

/**
 * 显示用的标题 = **两位编号 + 页标题**（`01 总功能介绍`）。
 * 编号由**平铺顺序**推出来，不写在数据里 —— 以后插页/换顺序，编号自己跟着走、不会漂。
 */
export function guideTitleWithNo(page: GuidePage): string {
  const no = GUIDE_PAGES.findIndex((item) => item.id === page.id) + 1
  return `${String(no).padStart(2, '0')} ${page.title}`
}

/**
 * 左侧栏最下面那个「指引」按钮的文案。
 *
 * 第 1 页最后一条要点和示意图里的那一行**共用它** —— 改名字只需要改这里，
 * 不会出现"文字说指引、图里画的是别的"。按钮本体在 `App.vue`（`data-testid="guide-open"`）。
 */
export const GUIDE_HINT_LABEL = '指引'

/** 第 4 页那三个**可就地填**的字段 id 与 `views/Settings.vue` 的「外部工具」区块一致。 */
export type GuideToolFieldId = 'labelPlusFx' | 'photoshop' | 'importScript'

/**
 * 第 4 页正文里**可就地填**的三个字段（2026-10-03 用户要求：能在这儿填，也能留空跳过）。
 *
 * `pickKind` 直接喂给现成的 `comicType:pickToolFile`；**落库由宿主 App.vue 做** ——
 * 引导组件只画 + emit，它仍然不认识存储（仓库既有的"组件不认识存储"那条规矩）。
 *
 * 顺序 = 设置页真实顺序（翻译 / 校对 → Photoshop → 译文导入），2026-10-04 用户拍板。
 * ⚠️ 字段由 `GuideBlock.toolField` 指到具体那一块文字后面（一处介绍紧跟一处填写框），
 *    这里只留"名字 / 提示 / 挑文件的口径"，不再有"堆在页尾"的渲染方式。
 */
export const GUIDE_TOOL_FIELDS: readonly {
  id: GuideToolFieldId
  label: string
  hint: string
  pickKind: 'executable' | 'script'
}[] = [
  { id: 'labelPlusFx', label: '翻译 / 校对工具', hint: 'LabelPlusFX.exe', pickKind: 'executable' },
  { id: 'photoshop', label: 'Photoshop 程序', hint: 'Photoshop.exe', pickKind: 'executable' },
  { id: 'importScript', label: '译文导入脚本', hint: '你的 .jsx', pickKind: 'script' }
]

/** 第 5 页示意图里的三张小卡。 */
export const GUIDE_MODULE_CARDS = [
  { title: '字体', hint: '装 / 卸 Windows 字体' },
  { title: '导入', hint: 'txt → PSD' },
  { title: '成就', hint: '按月 / 年统计' }
] as const

/** 第 2 页导语配图（图二）里露出的几话，用来体现"每行末尾有进度"。 */
export const GUIDE_WORKBENCH_ROWS = [
  { chapter: '第20集 · conv', progress: '嵌字进度0/24' },
  { chapter: '第19集 · conv', progress: '嵌字进度0/16' },
  { chapter: '第18集 · conv', progress: '嵌字进度0/28' },
  { chapter: '第11集 · conv', progress: '嵌字进度4/20' },
  { chapter: '第10集 · conv', progress: '嵌字进度18/18' }
] as const

/** 进阶「进度页」那张图例里的示例行（示意，不是真实数据）。职责用真实胶囊原语画。 */
export const GUIDE_PROGRESS_ROWS = [
  { title: '青梅亭亭', duties: ['proofread', 'supervised'] as const, uncooked: '1 话', done: 2, total: 3 },
  { title: '快住手', duties: ['proofread'] as const, uncooked: '✓ 全熟', done: 24, total: 24 },
  { title: '零魔力的大贤者', duties: ['supervised'] as const, uncooked: '1 话', done: 8, total: 9 }
] as const

/** 上手栏（5 页）：第一次用这套工具要知道的东西。 */
export const GUIDE_BASIC_PAGES: readonly GuidePage[] = [
  {
    id: 'nav',
    title: '总功能介绍',
    // 图三改法（用户 2026-10-03 定）：上面那张导航图**固定不动**，
    // 下面那条文案**一屏一条、左右翻**，右边线框跟着当前项换 —— 三者共用 GUIDE_NAV_SECTIONS。
    slides: true,
    fixedArt: 'nav',
    blocks: [
      {
        kind: 'lead',
        // 2026-10-04（用户第 2 条）：导语原来只讲"七个方块…"，v4 才把这一页改成
        // **一屏一条左右翻**，导语却只字未提 ⇒ 那两个箭头没人会发现；
        // 2026-10-04 晚（用户看图后又指出）：导语说"七个功能页、这一页讲它们"，
        // 可下面明明翻出 8 条（第 8 条是「指引」）—— 口径裂缝。现在导语**明说八条**
        // 且点明"七个功能页 + 指引"，App-navigation.spec 有锁盯着两个数必须相等。
        text: '左边这排是七个功能页，左下角另有「指引」和夜间开关。这一页共八条：七个功能页加「指引」，点箭头一条条翻。'
      },
      ...GUIDE_NAV_SECTIONS.map((section) => ({
        kind: 'point' as const,
        label: section.label,
        focus: section.wire,
        text: section.text,
        ...(section.note ? { note: section.note } : {})
      }))
    ]
  },
  {
    id: 'workbench',
    title: '项目：工作台介绍',
    blocks: [
      {
        kind: 'lead',
        text: '左半边是项目树，右半边是这一话的图片卡片 —— 先在左边选话，再到右边干活。',
        arts: ['workbench']
      },
      {
        kind: 'point',
        label: '「添加 / 修改 / 删除」管的是项目记录',
        text: '「添加」= 登记新一话；「修改」= 改集数和标题；「删除」= 只删记录，不动你硬盘上的文件。',
        note: '「管理」里能批量删、批量标记、排序重命名；父级那行右边的 ⟳「刷新并检测新章节」用来发现新话。',
        // 2026-10-04（用户第 4 / 5 条）：这两张图**左右并排**（原来竖着堆），
        // 左边换成"点「添加」后那张表单"（注意点写在框内），右边是工具条 + 管理面板。
        artsRow: ['add-project', 'sidebar-manage']
      },
      {
        kind: 'point',
        label: '每一行右边的进度',
        text: '比如「翻译进度 16/24」= 这一话一共 24 张，你标了 16 张。',
        note: '这个数跟着当前模式走；父级那一行不显示进度。',
        arts: ['row-progress']
      },
      {
        // 2026-10-04（用户第 6 条）：原来这里有一条讲"卡片左下的小圆点"的要点，
        // 按用户要求**整条删掉**。留下的底线在 GuideDialog.spec：谁都不许再
        // 把那个圆点说成"勾选"（那是 2026-10-03 抓到的真错），
        // 勾选怎么作用到一批卡片由第 03 页那条讲。
        kind: 'point',
        label: '卡片右下「去嵌字 / 去翻译」',
        text: '点它直接跳到外部软件 —— Photoshop 或 LabelPlusFX。',
        note: '按钮上的字跟着当前模式变。',
        arts: ['card-actions']
      },
      {
        // 2026-10-04（用户第 7 条）：原来分两条讲（「翻译」「校对」点去翻译 /
        // 「嵌字」「监修」点去嵌字），合并精简成一条 —— 信息一条不少。
        kind: 'point',
        label: '「去X」点下去打开什么',
        text: '「翻译」「校对」模式 → 打开 LabelPlusFX，跟有没有 PSD 无关；「嵌字」「监修」模式 → 有 PSD 就直接开那张 PSD。',
        note: '没有 PSD 时：「嵌字」去跑译文导入脚本（.jsx）、「监修」直接空开 Photoshop；还没配脚本时会先弹窗问一次（第 4 页那条开关能免掉它）。'
      },
      {
        // 2026-10-04 晚（图位重排）：这张对照视图的图**搬到第 09 页**了 ——
        // 那一页整页都在讲"对照与播放"（导语说左边原图右边 PSD，却一直没有图），
        // 而这一页本来就有 7 张图、太重。同一张图不重复出现，只挪到更该在的地方。
        kind: 'point',
        label: '双击卡片',
        text: '进入对照模式，原图和 PSD 并排看。',
        note: '这一话还没有 PSD 时，进的是大图预览；进去以后还有缩放 / 胶片条 / 自动播放，见进阶栏「看图与对照」。'
      },
      {
        kind: 'point',
        label: '「打开当前文件夹」',
        text: '用资源管理器打开这一话的目录；「刷新」重新扫描文件；第三个按钮切模式。',
        arts: ['toolbar-strip']
      }
    ]
  },
  {
    id: 'modes',
    title: '模式：四种工序',
    blocks: [
      {
        kind: 'lead',
        text: '工具栏上那个下拉框就是模式开关。平时用默认的「嵌字」，要换工序再切。',
        arts: ['mode-dropdown']
      },
      {
        kind: 'point',
        label: '四条进度线互相独立',
        text: '同一张图可以既「已翻译」又「已校对」—— 四条线各记各的，互不覆盖。'
      },
      {
        kind: 'point',
        label: '切换模式后整个界面跟着变',
        text: '工具栏的「标记X」、卡片的「去X」、每行的进度、页脚的进度条、成就页的统计，全跟着切。'
      },
      {
        kind: 'point',
        label: '「标记X / 标记未X」作用在勾选中的卡片上',
        text: '侧栏「管理」里能一次勾选一大批话，再一起标。'
      },
      {
        kind: 'point',
        label: '先确认模式对不对，再动手标记',
        text: '标错模式不会丢数据，放心 —— 按正确的模式再标一遍就回来了。',
        note: '如果这一本你长期只干一道工序，可以给父级设个「职责」，进去就自动切过去 —— 见进阶栏。'
      }
    ]
  },
  {
    id: 'settings',
    title: '设置：外部工具链接',
    // 2026-10-04（用户第 8 条）：这一页**删掉示意图**，改成"一处介绍紧跟一处填写框"——
    // 每条要点用 `toolField` 指到自己那个框（渲染在 GuideDialog 里，落库仍归宿主 App.vue）。
    blocks: [
      {
        kind: 'lead',
        text: '在「设置 → 外部工具」里填一次，之后卡片上的「去X」才知道该开哪个程序。'
      },
      {
        kind: 'point',
        label: '翻译 / 校对工具',
        text: '填 LabelPlusFX.exe 的路径。',
        note: '不填的话，翻译 / 校对模式下点「去翻译」不会动。',
        toolField: 'labelPlusFx'
      },
      {
        kind: 'point',
        label: 'Photoshop 程序',
        text: '填 Photoshop.exe 的文件地址。',
        note: '示例：C:\\用户\\PS\\Adobe Photoshop 2026\\Photoshop.exe',
        toolField: 'photoshop'
      },
      {
        kind: 'point',
        label: '译文导入 / PSD 生成工具（.jsx）',
        text: '填你那个 .jsx 脚本。',
        note: '某一话还没有 PSD 时，用它现做一张。',
        toolField: 'importScript'
      },
      {
        kind: 'point',
        label: '勾上「不再提示」开关',
        text: '勾上「嵌字缺少 PSD 且未配置译文导入工具时不再提示，直接打开 Photoshop」，点「去嵌字」时就少一次确认弹窗。',
        note: '监修模式本来就直接打开、不会问。'
      }
    ]
  },
  {
    id: 'modules',
    title: '其它模块：字体 / 导入 / 成就',
    blocks: [
      { kind: 'lead', text: '这三块平时用不到，知道它们在哪儿、干什么就行。', arts: ['modules'] },
      { kind: 'point', label: '字体', text: '装 / 卸 Windows 字体，嵌字时就能选到这些字体。' },
      {
        kind: 'point',
        label: '导入',
        text: '读 LabelPlus 的 txt，本地快速出图。',
        note: '或者交给 Photoshop，出真竖排。'
      },
      {
        kind: 'point',
        label: '成就',
        text: '按月 / 按年看自己标记了多少张。',
        note: '数字跟着当前选的模式算；来自「标记记录」，删图、挪目录都不会缩水。'
      }
    ]
  }
]

/** 进阶栏（3 页）：上手之后才用得上的三块 —— 职责 / 记录 / 看图。 */
export const GUIDE_ADVANCED_PAGES: readonly GuidePage[] = [
  {
    id: 'duty',
    title: '职责：这本归我干什么',
    blocks: [
      {
        kind: 'lead',
        text: '一本漫画能挂 1~2 个「职责」，它回答的是"这本归我干哪道工序"。'
      },
      {
        kind: 'point',
        label: '父级行开头的小胶囊',
        text: '「校 监」= 这一本你负责校对和监修。它和工具栏那个模式下拉不是一回事。'
      },
      {
        // 2026-10-04 晚（图位重排）：这张图原来挂在最后一条（自动切模式）上，
        // 挪到这儿 —— 图里画的正是"胶囊 + 展开的菜单 + 最多 2 个"，
        // 而这一条才是这张图的正文（讲胶囊怎么点、怎么改）。
        kind: 'point',
        label: '点胶囊就能改',
        text: '最多选两个；已经两个时，另外那两项会变灰。',
        note: '清空也行 —— 它就回到"没设置"。',
        arts: ['parent-duty']
      },
      {
        kind: 'point',
        label: '进这一本会自动切模式',
        text: '从别处进工作台、或换到另一本漫画时，模式会按职责切过去（两个职责时挑完成度更低的那道）。',
        note: '同一本里换话、或你自己手动切走，都不会被拉回来。'
      }
    ]
  },
  {
    id: 'progress',
    title: '进度：还欠几话没熟',
    blocks: [
      {
        kind: 'lead',
        text: '一张「欠账清单」：一行一本漫画，回答"按这本的职责，我还欠几话没熟、多久没动了"。',
        arts: ['progress']
      },
      {
        kind: 'point',
        label: '「待烤」= 这一话还没做完',
        text: '按"这本归我干哪道工序"那个职责算：该话在这个职责下没做完，就算「待烤」；没设过职责的本会显示「未设职责」。'
      },
      {
        kind: 'point',
        label: '多职责就点胶囊分开展示',
        text: '点职责那枚小胶囊，整行数据切到那个职责 —— 不会硬凑成"两边都完成才算熟"。',
        note: '这一页只是换"看数据的角度"，不写库；真正的职责去「项目」页那枚胶囊上设。'
      },
      {
        kind: 'point',
        label: '「进展」= 最近收工的那一话',
        text: '收工 = 那一话在这个职责下全部做完。一话都没做完就显示「—」。',
        note: '「距上次」= 多久没动：30 天起变黄，90 天起变红。'
      },
      {
        kind: 'point',
        label: '点书名，跳到最近在干的那一话',
        text: '直接进工作台那本最近在干的一话，接着往下做。'
      },
      {
        kind: 'point',
        label: '工具条上的「时间线」',
        text: '右侧滑出抽屉，列出最近 80 条"某天 · 某本 · 某话 · 某职责完成 N 张"。'
      }
    ]
  },
  {
    id: 'ledger',
    title: '记录：撤销与备份',
    blocks: [
      { kind: 'lead', text: '每一次标记都会留一笔记录 —— 所以改错了能退回来，不用怕手滑。' },
      {
        kind: 'point',
        label: 'Ctrl+Z 撤销最近一次',
        text: '工作台顶部那枚 ↺ 是同一个动作（没有可撤销的操作时，它是灰的）。'
      },
      {
        kind: 'point',
        label: '台账里能看到每一笔',
        text: '「标记记录」列出每次操作：什么时候、哪个模式、动了几个文件。',
        note: '某一笔不想要？单条就能还原。',
        arts: ['mark-ledger']
      },
      {
        kind: 'point',
        label: '备份与还原',
        text: '设置 › 数据安全里有备份（能手动、也能自动），还能从某份备份还原标记。',
        note: '还原前先把差异摆给你看，确认了才写回去。'
      },
      {
        kind: 'point',
        label: '出问题先看一眼「诊断」',
        text: '设置 → 数据安全 → 「诊断」：版本、数据目录、库大小、日志尾部，还能一键复制。'
      }
    ]
  },
  {
    id: 'viewer',
    title: '看图：对照与播放',
    blocks: [
      {
        // 2026-10-04 晚（图位重排）：这张对照视图的图是从第 02 页「双击卡片」搬来的 ——
        // 这一页整页都在讲"对照与播放"，导语说"左边原图、右边 PSD"却一直没有图。
        kind: 'lead',
        text: '双击卡片进对照模式：左边原图、右边 PSD，可以逐张核对。',
        arts: ['compare']
      },
      {
        kind: 'point',
        label: '顶部缩放',
        text: '百分比输入框 + − / +；Ctrl+滚轮也能缩，双击画面回到适应窗口。'
      },
      {
        kind: 'point',
        label: '底部胶片条',
        text: '点哪张跳哪张；只在对照状态出现，退出就自动收起。'
      },
      {
        kind: 'point',
        label: '自动播放',
        text: '按设置里的「播放间隔」一张张翻；点画面任意处、翻页或退出预览都会停。'
      },
      {
        kind: 'point',
        label: '标记后下一张',
        text: '在对照视图的工具条上点那枚 ⇥ 按钮开 / 关（默认关）—— 开了以后标完一张就自己翻到下一张。',
        arts: ['viewer-controls']
      }
    ]
  }
]

/** 两栏（顺序就是入口页上的顺序）。 */
export const GUIDE_LANES: readonly GuideLane[] = [
  {
    id: 'basics',
    label: '先看怎么用',
    hint: '左边导航、工作台那些按钮、四种模式、外部工具、另外三个模块',
    pages: GUIDE_BASIC_PAGES
  },
  {
    id: 'advanced',
    label: '看进阶功能',
    hint: '这本归我干什么（职责）· 标记有记录（撤销 / 台账 / 备份）· 看图与对照',
    tag: '本次新增',
    pages: GUIDE_ADVANCED_PAGES
  }
]

/**
 * 平铺视图 = 两栏按顺序拼起来。
 *
 * ⚠️ **弹窗不用它翻页**（翻页是按栏走的）—— 它只给"全量数据检查"（每条要点都有结论、
 * 三层不为空、id 唯一）和截图工装用；也让老代码 / 老测试有个兼容入口。
 */
export const GUIDE_PAGES: readonly GuidePage[] = [...GUIDE_BASIC_PAGES, ...GUIDE_ADVANCED_PAGES]
