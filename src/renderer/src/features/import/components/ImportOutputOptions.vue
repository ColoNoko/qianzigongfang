<script setup lang="ts">
import UiInput from '@renderer/components/ui/ControlInput.vue'
import type { LabelPlusGenerateOptions } from '@shared/labelplus-import'
const options = defineModel<LabelPlusGenerateOptions>({ required: true })
const switches = [
  { key: 'createLayerGroups', label: '按分组创建 PSD 图层组', id: 'import-create-groups' },
  { key: 'outputLabelIndex', label: '额外生成 Label 编号层', id: 'import-output-index' },
  { key: 'ignoreImagesWithoutLabels', label: '忽略没有标签的图片', id: 'import-ignore-empty' },
  { key: 'overwriteExisting', label: '覆盖已有 PSD', id: 'import-overwrite' }
] as const
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-3" data-testid="import-advanced-section">
    <h2 class="mb-3 text-sm font-semibold">输出选项</h2>
    <div class="grid gap-3 sm:grid-cols-2">
      <label v-for="item in switches" :key="item.key" class="flex items-center gap-2 text-xs">
        <UiInput v-model="options[item.key]" type="checkbox" :data-testid="item.id" />
        <span>{{ item.label }}</span>
      </label>
    </div>
    <label class="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
      <span>分辨率（PPI）</span>
      <UiInput v-model.number="options.resolutionPpi" type="number" min="30" max="1200" class="h-8 w-28" data-testid="import-resolution" />
    </label>
  </section>
</template>
