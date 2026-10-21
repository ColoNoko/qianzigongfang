<script lang="ts">
// ProjectThumbList — maps JpgPsdPair[] to ThumbItem[] and wires ThumbGrid.
// Shared revision-aware thumbnails are requested by viewport interest.
// Thumb size defaults to the settings store value; an explicit prop
// overrides it (useful for tests or per-view customization).
import { basenameOf } from '@shared/paths'
import type { JpgPsdPair, TypesetStatus, WorkMode } from '@shared/types'
import type { ThumbItem, ThumbSize } from './ThumbGrid.vue'
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import ThumbGrid from './ThumbGrid.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { getThumbnailService, thumbnailKey } from '@renderer/services/thumbnails'
import { pairHasPsd, performCardAction } from '@renderer/features/project/external-tool'

const props = withDefaults(
  defineProps<{
    childId?: string
    pairs: JpgPsdPair[]
    folderPath: string
    thumbSize?: ThumbSize
    /**
     * Card action mode. `typeset` (the default) opens the PSD with its OS
     * association — the historical behaviour. Any other mode launches the
     * external translation editor configured in settings instead.
     */
    mode?: WorkMode
    /**
     * 这一话的**本地目录已不在**（被删 / 被改名），列表来自台账里的历史记录。
     *
     * 打开时卡片动作、标记、双击对照**全部禁用** —— 文件不在本地，打开只会报错，
     * 标记更会往台账里写下无意义的记录。缩略图**仍然加载**：那条路径走的是持久
     * 缓存（thumbnail-cache.ts），正是这个模式存在的意义。
     */
    missing?: boolean
  }>(),
  { mode: 'typeset', missing: false }
)

const settingsStore = useSettingsStore()
const thumbnails = getThumbnailService()
const owner = {}
const filenameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

// Prop overrides store; fall back to the validated store value.
const effectiveThumbSize = computed<ThumbSize>(
  () => props.thumbSize ?? settingsStore.thumbSizeValid
)

const emit = defineEmits<{
  (e: 'openPsd', psdPath: string): void
  (e: 'compare', pair: JpgPsdPair): void
  (e: 'mark', pair: JpgPsdPair): void
  (e: 'selectionChange', pairs: JpgPsdPair[]): void
  (e: 'toast', payload: { type: 'success' | 'warning' | 'error'; message: string }): void
  /** Compatibility event; URLs are owned by the shared thumbnail service. */
  (e: 'thumbnails', urls: Record<string, string>): void
}>()

const thumbUrls = computed<Record<string, string>>(() =>
  Object.fromEntries(
    props.pairs.flatMap((pair) => {
      const url = thumbnails.state(pair).url
      return url ? [[pair.psd.absPath, url]] : []
    })
  )
)
function basename(path: string): string {
  return basenameOf(path)
}

function pairStatusForMode(pair: JpgPsdPair, mode: WorkMode): TypesetStatus {
  if (pair.psd.status === 'none') return 'none'
  if (pair.psd.modes) return pair.psd.modes[mode] ? 'done' : 'pending'
  return pair.psd.status
}

const items = computed<ThumbItem[]>(() =>
  props.pairs
    .map((pair) => ({
      id: pair.psd.absPath,
      revision: thumbnailKey(pair),
      error: thumbnails.state(pair).error,
      fallback: thumbnails.state(pair).source === 'fallback',
      filename: basename(pair.previewOnly ? (pair.jpgPath ?? pair.psd.absPath) : pair.psd.absPath),
      thumbUrl: thumbUrls.value[pair.psd.absPath] ?? null,
      mtimeText: props.missing
        ? // 目录不在时"文件修改日期"没有意义（文件已不在本地），换成状态说明。
          '本地已删除'
        : new Date(pair.psd.mtimeMs).toLocaleDateString('zh-CN'),
      status: pairStatusForMode(pair, props.mode)
    }))
    .sort((a, b) => filenameCollator.compare(a.filename, b.filename))
)

let visibleIds: string[] = []
let nearbyIds: string[] = []
function handleVisible(visible: string[], nearby: string[]): void {
  visibleIds = visible
  nearbyIds = nearby
  const byId = new Map(props.pairs.map((pair) => [pair.psd.absPath, pair]))
  const select = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((p): p is JpgPsdPair => Boolean(p))
  thumbnails.setVisible(owner, select(visible), select(nearby))
}
function retry(id: string): void {
  const pair = props.pairs.find((p) => p.psd.absPath === id)
  if (pair) thumbnails.request(pair, true, owner)
}
function imageFailed(id: string, url: string): void {
  const pair = props.pairs.find((p) => p.psd.absPath === id)
  if (pair) void thumbnails.imageFailed(pair, url)
}
watch(thumbUrls, (urls) => emit('thumbnails', urls), { immediate: true })
watch(
  () => props.pairs.map(thumbnailKey).join('\n'),
  () => handleVisible(visibleIds, nearbyIds)
)
onBeforeUnmount(() => thumbnails.release(owner))

function handleDblclick(id: string): void {
  // 目录不在（历史记录）：对照视图要读本地文件，打不开，直接不响应。
  if (props.missing) return
  const pair = props.pairs.find((p) => p.psd.absPath === id)
  // `previewOnly` entries (a chapter whose folder holds images but no PSD) open
  // the viewer as well: CompareViewer switches to its image-only layout for
  // them, so a JPG-only chapter finally has a large-preview mode.
  if (pair) emit('compare', pair)
}

async function handleAction(id: string): Promise<void> {
  // 目录不在：卡片动作会去打开一个不存在的文件，只会弹"打开失败"。
  if (props.missing) return
  const pair = props.pairs.find((p) => p.psd.absPath === id)
  if (!pair) return

  const outcome = await performCardAction({
    mode: props.mode,
    hasPsd: pairHasPsd(pair.psd.status),
    openPath: id
  })
  if (outcome.toast) emit('toast', outcome.toast)
}

function handleMark(id: string): void {
  // 目录不在：标记会以"文件路径"为键写进台账，对已删除的文件毫无意义。
  if (props.missing) return
  const pair = props.pairs.find((p) => p.psd.absPath === id)
  if (pair) emit('mark', pair)
}

function handleSelectionChange(ids: string[]): void {
  // 目录不在：不许选中 —— 选中会让工具栏的「标记X」重新可点，而那是禁用项。
  if (props.missing) return
  const selected = ids
    .map((id) => props.pairs.find((pair) => pair.psd.absPath === id))
    .filter((pair): pair is JpgPsdPair => pair !== undefined)
  emit('selectionChange', selected)
}
</script>

<template>
  <ThumbGrid
    :child-id="childId"
    :items="items"
    :thumb-size="effectiveThumbSize"
    :mode="mode"
    @visible="handleVisible"
    @retry="retry"
    @image-error="imageFailed"
    @dblclick="handleDblclick"
    @action="handleAction"
    @mark="handleMark"
    @selection-change="handleSelectionChange"
  />
</template>
