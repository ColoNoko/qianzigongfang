<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { Button as UiButton } from '@renderer/components/ui/button'
import UiInput from '@renderer/components/ui/ControlInput.vue'
/**
 * 「修改扫描目录」弹窗（2026-10-05，需求二）—— **纯展示**：只画 + emit。
 *
 * 分工与 `SelfCheckDialog` 一致：规则与 IPC 都在 `useSourceRootEditor` 里，
 * 这里不认识 `window.comicType`、也不算"哪些根算冲突"（那是
 * `@shared/source-roots` 的 `findOtherParentInside`，与主进程 B1 同一处）。
 *
 * 视觉**不引入任何新东西**：外壳与 `ProjectFormModal` / `SelfCheckDialog` 同一套
 * （遮罩 bg-black/50 + rounded-xl 卡片 + token 配色），
 * 分组标题复用 `.settings-group` 原语，输入框沿用 `rounded-badge border-border bg-app-bg`，
 * 所以昼夜两套主题自动都对。
 *
 * ⚠️ 这个弹窗改的是**父级**的"刷新并检测新章节去哪找新话"，**不动任何话自己的
 *    文件夹路径** —— 那句话必须写在界面上（用户会担心"是不是要把文件挪走"）。
 */
import type { DirEntry } from '@shared/ipc-api'
import type { SourceRootConflict, SourceRootEdit, SourceRootMode } from './useSourceRootEditor'

const props = defineProps<{
  visible: boolean
  busy: boolean
  parentTitle: string
  mode: SourceRootMode
  directory: string
  layers: DirEntry[]
  layerError: string
  selectedLayerPaths: string[]
  acknowledged: boolean
  currentRoots: string[]
  currentIsRemembered: boolean
  currentCandidateCount: number
  currentMessage: string
  conflicts: SourceRootConflict[]
  canSave: boolean
  plan: SourceRootEdit
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pickDirectory'): void
  (e: 'update:directory', value: string): void
  (e: 'loadLayers'): void
  (e: 'toggleLayer', layerPath: string): void
  (e: 'resetToAuto'): void
  (e: 'update:acknowledged', value: boolean): void
  (e: 'save'): void
}>()

/** "修改后"要写的那些根（来自宿主算好的 plan —— 不在这里重算一遍规则）。 */
function afterRoots(): string[] {
  return props.plan.kind === 'roots' ? props.plan.roots : []
}

function conflictTitles(): string {
  return [...new Set(props.conflicts.map((conflict) => conflict.parentTitle))].join('、')
}

function onDirectoryInput(event: Event): void {
  emit('update:directory', (event.target as HTMLInputElement).value)
}

function onAcknowledgeChange(event: Event): void {
  emit('update:acknowledged', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <Dialog :open="true" @update:open="!$event && (emit('close'))" v-if="visible">
    <DialogContent
      class="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl border border-border bg-card-bg p-6 text-text-primary shadow-[var(--shadow-3)]"
     :show-close="false" :aria-describedby="undefined">
      <div class="mb-2 flex items-center justify-between gap-2">
        <DialogTitle class="text-lg font-bold text-accent">修改扫描目录</DialogTitle>
        <UiButton variant="ghost" size="sm"
          type="button"
          class="transition-colors"
          aria-label="关闭"
          @click="emit('close')"
        >
          ✕
        </UiButton>
      </div>
      <!-- 先把"这个设置在管什么"说清楚：只管检测新章节，不挪任何文件。 -->
      <p class="mb-4 text-xs leading-relaxed text-text-tertiary">
        《{{ parentTitle }}》—— 这里设的是「刷新并检测新章节」去哪个目录找新话。
        <strong>各话自己的文件夹路径不受影响</strong>，也不会移动任何文件。
      </p>

      <!-- 当前 -->
      <section data-testid="source-root-current">
        <p class="settings-group">当前扫描目录</p>
        <p class="mt-1 text-xs text-text-secondary">
          {{ currentIsRemembered ? '你指定过（自动推导已暂停）' : '自动推导（跟着各话的路径走）' }}
        </p>
        <ul v-if="currentRoots.length" class="mt-1 space-y-0.5">
          <li v-for="root in currentRoots" :key="root" class="break-all text-xs text-text-tertiary">
            {{ root }}
          </li>
        </ul>
        <p v-if="currentMessage" class="mt-1 text-xs text-warning">{{ currentMessage }}</p>
        <p v-else class="mt-1 text-xs text-text-tertiary">
          按当前设置会检测到 {{ currentCandidateCount }} 个新章节
        </p>
      </section>

      <!-- 改成 -->
      <section class="mt-4">
        <p class="settings-group">改成</p>
        <div class="mt-1 flex gap-2">
          <UiInput
            :value="directory"
            type="text"
            placeholder="填入想设为扫描根的文件夹地址"
            data-testid="source-root-directory"
            class="min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            @input="onDirectoryInput"
            @blur="emit('loadLayers')"
          />
          <UiButton variant="default" size="sm"
            type="button"
            class="shrink-0 transition-colors"
            data-testid="source-root-pick"
            @click="emit('pickDirectory')"
          >
            浏览
          </UiButton>
        </div>

        <p v-if="layerError" class="mt-1 text-xs text-warning">{{ layerError }}</p>

        <!-- 候选层（需求二第 4 条）：目录下有多个候选层时，让用户指定哪一层是"话"那一层。 -->
        <div v-if="layers.length > 0" class="mt-3" data-testid="source-root-layers">
          <p class="text-xs text-text-secondary">勾选「各话所在的那一层」（可多选）</p>
          <div class="mt-1 space-y-0.5">
            <label
              v-for="layer in layers"
              :key="layer.absPath"
              class="flex cursor-pointer items-center gap-2 rounded-badge px-1 py-1 text-xs text-text-primary transition-colors hover:bg-card-bg-hover"
            >
              <UiInput
                type="checkbox"
                :checked="selectedLayerPaths.includes(layer.absPath)"
                data-testid="source-root-layer"
                @change="emit('toggleLayer', layer.absPath)"
              />
              <span class="min-w-0 truncate">{{ layer.name }}</span>
            </label>
          </div>
          <p class="mt-1 text-[11px] leading-4 text-text-tertiary">
            一层都不勾 = <strong>直接把这个目录本身</strong>当作各话所在的那一层
          </p>
        </div>

        <!-- 冲突：目录里住着别的作品的话（与主进程 B1 同一把尺子） -->
        <div
          v-if="conflicts.length > 0"
          class="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
          data-testid="source-root-conflict"
        >
          <p>
            这个目录里住着<strong>别的作品</strong>的话：<strong>{{ conflictTitles() }}</strong
            >。 把它设成扫描根的话，「刷新并检测新章节」会把<strong>别人的话</strong>当成《{{
              parentTitle
            }}》的新章节报出来。
          </p>
          <label class="mt-2 flex cursor-pointer items-center gap-2">
            <UiInput
              type="checkbox"
              :checked="acknowledged"
              data-testid="source-root-acknowledge"
              @change="onAcknowledgeChange"
            />
            我知道，仍然要这么设
          </label>
        </div>
      </section>

      <!-- 改完 -->
      <section class="mt-4" data-testid="source-root-after">
        <p class="settings-group">修改后</p>
        <p v-if="mode === 'auto'" class="mt-1 text-xs text-text-secondary">
          恢复自动推导：清掉"记住的目录"，下次检测按各话的路径重新推算
        </p>
        <ul v-else-if="afterRoots().length" class="mt-1 space-y-0.5">
          <li v-for="root in afterRoots()" :key="root" class="break-all text-xs text-accent">
            {{ root }}
          </li>
        </ul>
        <p v-else class="mt-1 text-xs text-text-tertiary">还没选目录</p>
      </section>

      <!-- 动作 -->
      <div class="mt-6 flex items-center justify-between gap-2">
        <UiButton variant="outline" size="sm"
          v-if="currentIsRemembered"
          type="button"
          class="transition-colors"
          data-testid="source-root-reset"
          @click="emit('resetToAuto')"
        >
          恢复自动推导
        </UiButton>
        <span v-else />
        <div class="flex gap-2">
          <UiButton variant="outline" size="sm"
            type="button"
            class="transition-colors"
            @click="emit('close')"
          >
            取消
          </UiButton>
          <UiButton variant="default" size="sm"
            type="button"
            class="transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canSave"
            data-testid="source-root-save"
            @click="emit('save')"
          >
            保存
          </UiButton>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
