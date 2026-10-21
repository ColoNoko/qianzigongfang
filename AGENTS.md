# 项目协作约定

- 后续源码修改无需编写修改记录，不再维护 T 系列变更日志。
- 交付统一使用 `release/latest` 和固定 latest 文件名，不新增按版本、日期或 T 编号命名的交付目录。替换前保留用户 data；源码和用户数据备份放在 `.local-backups`，不进入交付包。

## 精简验证

- 普通修改只运行受影响模块的测试；`pnpm test` / `pnpm verify:quick` 为日常核心回归，`pnpm test:related <源码路径>` 按依赖选择测试。
- 不自动叠加全量测试、全量 lint、构建和 Electron 验收；仅在跨层重构、测试基础设施变更或交付前按需要使用 `pnpm verify:full`。
- UI 文案、间距等低风险改动不新增源码字符串、CSS 类名或重复快照断言；保留数据写入、迁移、导入、并发和关键交互的行为测试。
- 通过的检查不无故重复。测试数量不是目标，报告实际执行范围与未验证部分。

## 控件规范（shadcn）

- 本项目为 Vue 3，严格以 shadcn/ui 的设计与交互规范为参考，使用 shadcn-vue / Reka UI 实现；不要引入 React 版组件或另一套控件库。
- 标准控件从 `src/renderer/src/components/ui` 导入；按钮、输入、选择、弹窗、提示、分段、表格、进度和分栏不得重新手写平行实现。业务组件组合这些基础控件。
- 保留 `stores/theme.ts` 的取色、色相/饱和度、昼夜模式与持久化，用语义颜色映射到组件；不得用默认主题覆盖用户配置。
- 新增组件参考 `components.json`、`doc/shadcn控件规范.md`；先用 `$shadcn` 或 `$shadcn-vue` 技能核对组件文档，升级前审查本地兼容改动，不盲目覆盖。
- 确认操作使用 `confirmAction()` / AlertDialog；文件选择器、Photoshop 等操作系统或外部软件界面仍由原有 IPC 打开。
