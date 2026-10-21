<script setup lang="ts">
/**
 * 「交给 Photoshop」那张**分组映射表**（P7 之三，2026-10-05）。
 *
 * 从 `views/Import.vue` 的模板里整块搬出来：一行一分组（动作名 + 文字方向），
 * 外加"这个分组没勾选"的提醒。
 *
 * **纯展示 + 事件出**：不碰 IPC、不碰 store、也不自己改 props ——
 * 动作名与方向都通过 `update:action` / `update:direction` 交回父层去写，
 * 父层那份 `photoshopGroupActions` 仍然只有一处写入。
 *
 * ⚠️ 三个 `data-testid`（容器 `import-group-mapping` / `import-group-action-*` /
 * `import-group-direction-*`）是 `Import.spec.ts` 点得着的钩子，搬家时**逐字保留** ——
 * 尤其方向那个：spec 是靠 `AppSelect` 的 `testId` prop 找到它再 emit 的，
 * 组件嵌深一层不影响，但 testid 改一个字就会碎。
 */
import AppSelect, { type AppSelectOption } from '@renderer/components/AppSelect.vue'

defineOptions({ name: 'ImportPhotoshopGroupTable' })

/** 与 `useLabelPlusRun` 里的同名类型一致（'inherit' 不落进清单）。 */
type GroupDirectionChoice = 'inherit' | 'horizontal' | 'vertical'

const props = defineProps<{
  /** 全部分组（顺序即界面顺序）。 */
  groups: string[]
  /** 已勾选的分组 —— 没勾的在这里标出来，免得以为它会一起导出。 */
  selectedGroups: string[]
  /** 分组名 → 动作名（空串 = 用分组名本身）。 */
  actions: Record<string, string>
  /** 分组名 → 方向选择。 */
  directions: Record<string, GroupDirectionChoice>
  directionOptions: AppSelectOption[]
}>()

const emit = defineEmits<{
  'update:action': [group: string, value: string]
  'update:direction': [group: string, value: string | number]
}>()

function groupIsSelected(group: string): boolean {
  return props.selectedGroups.includes(group)
}

function groupDirectionChoice(group: string): GroupDirectionChoice {
  return props.directions[group] ?? 'inherit'
}
</script>

<template>
  <div
    class="mt-3 overflow-hidden rounded-md border border-border"
    data-testid="import-group-mapping"
  >
    <table class="w-full text-left text-[11px]">
      <thead class="bg-sunken text-text-tertiary">
        <tr>
          <th class="px-3 py-2 font-medium">分组</th>
          <th class="px-3 py-2 font-medium">动作名（留空 = 用分组名）</th>
          <th class="px-3 py-2 font-medium">文字方向</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="group in groups" :key="group" class="border-t border-border">
          <td class="px-3 py-2 whitespace-nowrap">
            <span :class="groupIsSelected(group) ? 'text-text-primary' : 'text-text-tertiary'">{{
              group
            }}</span>
            <span v-if="!groupIsSelected(group)" class="ml-1 text-warning">未勾选</span>
          </td>
          <td class="px-3 py-2">
            <input
              :value="actions[group] ?? ''"
              type="text"
              class="w-full rounded-badge border border-border bg-app-bg px-2 py-1.5 text-[11px] outline-none focus:border-accent"
              :placeholder="group"
              :data-testid="`import-group-action-${group}`"
              @input="emit('update:action', group, ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td class="px-3 py-2">
            <AppSelect
              :model-value="groupDirectionChoice(group)"
              :options="directionOptions"
              :test-id="`import-group-direction-${group}`"
              size="small"
              @update:model-value="(value) => emit('update:direction', group, value)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
