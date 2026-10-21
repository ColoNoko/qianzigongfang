# shadcn 控件规范

本项目使用 Vue 3 + Tailwind CSS 3。shadcn/ui 原站是 React 实现，因此按相同设计体系使用 shadcn-vue（Reka UI）。组件源代码归项目管理，不是运行时拉取网页，也不是将 React 组件直接粘进 Vue。

参考：https://ui.shadcn.com/docs/components

Vue 文档：https://www.shadcn-vue.com/docs/introduction

## 日常使用

```vue
<script setup lang="ts">
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { ref } from 'vue'
const name = ref('')
</script>
<template>
  <Input v-model="name" aria-label="名称" />
  <Button variant="outline" size="sm">保存</Button>
</template>
```

组件在 `components/ui`，业务页面通过导入组合它们。`variant` 控制按钮用途，`size` 控制尺寸；默认操作 36px、紧凑操作 32px，图标按钮使用 icon 尺寸，侧栏导航和多行入口按实际布局扩大命中区域。`as-child` 将触发行为交给现有按钮，避免按钮内再嵌按钮。

| 功能 | 标准实现 |
| --- | --- |
| 操作与输入 | Button、Input、Checkbox、Switch、RadioGroup、Slider |
| 列表选择与搜索 | Select；Popover + Command 组合为 AppSelect |
| 工作/外观模式 | ToggleGroup，业务层忽略单选的空值 |
| 长说明 | InfoHint 组合 Popover，点击打开、Escape 关闭 |
| 普通弹窗 / 时间线 | Dialog / Sheet，标题使用相应 Title |
| 危险操作确认 | AlertDialog，通过 `services/confirm.ts` 返回 Promise |
| 消息 | Sonner，顶部居中；原 toast store 管理 3 秒寿命 |
| 表格 / 加载 / 进度 | Table 系列 / Skeleton / Progress |
| 左右分栏 | Resizable，用户调整后防抖保存宽度 |

漫画预览、缩略图、职责双色胶囊、图表、时间线内容和新手引导示意图属于业务可视化，保留业务布局；其中的标准交互控件使用上述组件。系统文件/文件夹选择、独立预览窗口、外部工具不属于前端控件替换范围。

## 主题和兼容规则

- 保留 `stores/theme.ts` 与现有 CSS token。`tailwind.config.ts` 将 background、foreground、primary、muted、destructive 等语义色映射到现有变量。`ui-accent` 表示淡色悬停/选中底，避免与原有强强调 accent 冲突。
- 取色滑杆采用 Slider；当前选用的基础组件集合没有可直接替换整个主题编辑器的 ColorPicker，保留原有色相、主色饱和度、中性色染色与预设逻辑。
- `ControlInput.vue` 是旧表单事件兼容层，转发 `v-model`、number/trim、checked 和 input/change；新代码优先直接使用对应组件。可选布尔联合属性必须显式默认 undefined，否则会遮住 value。
- AppSelect 将内部值编码为非空字符串，业务层仍收到原来的数字或空字符串。禁用选项不能提交。
- Portal 负责浮层和焦点管理。不要依赖弹窗 DOM 必须位于页面节点内部；可访问标题与说明按组件契约提供。
- Tailwind 3 不直接支持新 registry 的 `h-(--variable)` 语法，统一改为 `h-[var(--variable)]`。当前完整颜色变量不能直接套 `/20` 透明度工具类，轨道使用 muted 等语义色。
- Button 默认 type=button，表单提交必须明确 type=submit；本地 ref 转发为旧编辑器提供 focus/select/contains 等必要接口。
- 异步确认在打开前固定操作目标，重复确认请求返回 false；取消不执行写入。

## 来源和技能

组件来自 shadcn-vue 官方 new-york registry。`shadcn-registry.json` 记录来源地址、原始 JSON 哈希和依赖；本地做过导入别名、Tailwind 3、主题、ref 和中文关闭文案等适配，升级前须对照这些差异。许可证见 `shadcn-vue-LICENSE.txt`。

已安装用户级技能：`C:/Users/Colo94/.codex/skills/shadcn` 和 `C:/Users/Colo94/.codex/skills/shadcn-vue`。下一轮会话可调用 `$shadcn` / `$shadcn-vue`；Vue 项目优先后者。不要在当前 Vue 仓库运行 React 版 init。添加组件应先检查 `components.json` 和 Tailwind 3 兼容性，再使用 Vue registry；不要用 overwrite 覆盖本地主题适配。

## 同组选项与浮层编辑（T21）

两个及以上属于同一功能的选项（如大/中/小、年/月、翻译/校对、框内/框外）统一用 ToggleGroup 标签选择器；不同执行动作不合并为选项。浮层文本编辑复用 Popover 和 Textarea，不参与列表高度计算，点击外部须保存成功后关闭，失败保留草稿。
