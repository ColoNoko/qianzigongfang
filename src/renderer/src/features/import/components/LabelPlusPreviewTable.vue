<script setup lang="ts">
/**
 * 「匹配预览」那张表（P7 之三，2026-10-05）。
 *
 * 从 `views/Import.vue` 的模板里整块搬出来：68 行的重复结构（一行一页 + 四个 testid
 * 拼出来的钩子），留在视图里既挤占了"这一页到底有哪几块"的视线，也没法单独看。
 *
 * **纯展示组件**：数据进（`rows` / `selectedImageNames` / `outputNames`）、事件出
 * （`toggle` / `open`），自己不碰 IPC、不碰 store —— 与 §13 第 20 条那套分层一致。
 *
 * ⚠️ 四个 `data-testid`（`import-image-*` / `import-source-preview-*` /
 * `import-source-name-*` / `import-output-preview-*`）是 `Import.spec.ts` 点得着的钩子，
 * 搬家时**逐字保留**；少一个那几条用例就会碎。
 */
import type { LabelPlusImageMatch } from '@shared/labelplus-import'

defineOptions({ name: 'LabelPlusPreviewTable' })

defineProps<{
  /** 已经过"筛选框"过滤的行（`filteredRows`）。 */
  rows: LabelPlusImageMatch[]
  selectedImageNames: string[]
  /** 每张图的"输出 PSD 显示名"（由父层算好；本组件不做业务推断）。 */
  outputNames: Record<string, string>
}>()

const emit = defineEmits<{
  /** 勾选 / 取消勾选一张图。 */
  toggle: [name: string]
  /** 打开预览窗：'source' = 看原图，'output' = 看已生成的 PSD。 */
  open: [mode: 'source' | 'output', name: string]
}>()

/** 未匹配时那一格显示的说明（纯展示文案）。 */
function imageSummary(image: LabelPlusImageMatch): string {
  return image.matched ? image.sourceFileName || '已匹配' : '未找到图源'
}
</script>

<template>
  <div class="max-h-[520px] overflow-auto rounded-md border border-border">
    <table class="w-full border-collapse text-left text-xs">
      <thead class="sticky top-0 bg-sunken text-[11px] text-text-secondary">
        <tr>
          <th class="w-9 px-3 py-2"></th>
          <th class="px-3 py-2">LabelPlus 图片</th>
          <th class="px-3 py-2">标签</th>
          <th class="px-3 py-2">图源</th>
          <th class="px-3 py-2">状态 / 输出</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.labelImageName"
          class="border-t border-border hover:bg-card-bg-hover"
        >
          <td class="px-3 py-2">
            <input
              type="checkbox"
              class="accent-accent"
              :checked="selectedImageNames.includes(row.labelImageName)"
              :data-testid="`import-image-${row.labelImageName}`"
              @change="emit('toggle', row.labelImageName)"
            />
          </td>
          <td class="max-w-52 truncate px-3 py-2 font-bold" :title="row.labelImageName">
            <button
              v-if="row.matched"
              type="button"
              class="max-w-full truncate underline decoration-dashed underline-offset-2 hover:text-accent"
              :data-testid="`import-source-preview-${row.labelImageName}`"
              @click="emit('open', 'source', row.labelImageName)"
            >
              {{ row.labelImageName }}
            </button>
            <span v-else>{{ row.labelImageName }}</span>
          </td>
          <td class="px-3 py-2 text-text-secondary">{{ row.labelCount }}</td>
          <td class="max-w-64 truncate px-3 py-2 font-bold" :title="row.sourceFileName || ''">
            <button
              v-if="row.matched"
              type="button"
              class="max-w-full truncate underline decoration-dashed underline-offset-2 hover:text-accent"
              :data-testid="`import-source-name-${row.labelImageName}`"
              @click="emit('open', 'source', row.labelImageName)"
            >
              {{ row.sourceFileName }}
            </button>
            <span v-else>—</span>
          </td>
          <td class="px-3 py-2" :class="row.matched ? 'text-success' : 'text-warning'">
            <button
              v-if="row.matched"
              type="button"
              class="font-bold underline decoration-dashed underline-offset-2 transition-colors hover:text-primary-hover"
              :data-testid="`import-output-preview-${row.labelImageName}`"
              @click="emit('open', 'output', row.labelImageName)"
            >
              {{ outputNames[row.labelImageName] }}
            </button>
            <span v-else>{{ imageSummary(row) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
