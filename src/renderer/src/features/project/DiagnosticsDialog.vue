<script setup lang="ts">
// DiagnosticsDialog — 应用内诊断（D2）。
//
// 以前出问题只能去翻 `data/logs/psd-manager.log`（几十 MB 纯文本），或者等人一句句问
// "库多大 / 标记多少行 / 有没有备份"。这里把最常被问到的几个事实一次凑齐，
// 面板上还能**一键复制** —— 用户自己先看一眼，或者直接把这段贴出来。
//
// 只读：不动数据、不写文件（除了读日志尾部）。
import { formatDateTime, formatMegabytes } from '@shared/format'
import { computed, ref, watch } from 'vue'
import type { DiagnosticsSnapshot } from '@shared/ipc-api'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toast', payload: { type: 'success' | 'warning' | 'error'; message: string }): void
}>()

const loading = ref(false)
const error = ref('')
const snapshot = ref<DiagnosticsSnapshot | null>(null)
const logTail = ref('')
const copying = ref(false)

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${formatMegabytes(bytes)} MB`
}

function formatTime(at: number | null): string {
  return at ? formatDateTime(at) : '—'
}

const summaryText = computed(() => {
  const data = snapshot.value
  if (!data) return ''
  return [
    `汉化工坊 ${data.appVersion}（Electron ${data.electronVersion}，${data.platform}）`,
    `数据目录：${data.dataDirectory}`,
    `数据库：${data.databasePath}（${formatBytes(data.databaseBytes)}）`,
    `日志：${data.logPath}（${formatBytes(data.logBytes)}）`,
    `备份：${data.backupCount} 份，最新 ${formatTime(data.newestBackupAt)}`,
    `标记记录：${data.childCount} 话 / ${data.recordCount} 行`,
    `各模式完成条数：嵌字 ${data.markCounts.typeset}、翻译 ${data.markCounts.translated}、校对 ${data.markCounts.proofread}、监修 ${data.markCounts.supervised}`
  ].join('\n')
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [data, tail] = await Promise.all([
      window.comicType.diagnosticsSnapshot(),
      window.comicType.readLogTail()
    ])
    snapshot.value = data
    logTail.value = tail || '（日志为空或读不到）'
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function copySummary(): Promise<void> {
  if (!summaryText.value || copying.value) return
  copying.value = true
  try {
    await navigator.clipboard.writeText(summaryText.value)
    emit('toast', { type: 'success', message: '诊断信息已复制到剪贴板' })
  } catch {
    emit('toast', {
      type: 'warning',
      message: '复制失败（剪贴板不可用），请手动选择下面的文本'
    })
  } finally {
    copying.value = false
  }
}

async function openLogFile(): Promise<void> {
  const path = snapshot.value?.logPath
  if (!path) return
  const result = await window.comicType.openPath(path)
  if (!result.ok) emit('toast', { type: 'error', message: result.message || '打开日志失败' })
}

watch(
  () => props.open,
  (open) => {
    if (open) void load()
  },
  { immediate: true }
)
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    data-testid="diagnostics-overlay"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card-bg text-text-primary shadow-[var(--shadow-3)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostics-title"
      data-testid="diagnostics-dialog"
    >
      <header class="flex items-center gap-3 border-b border-border px-5 py-3">
        <h2 id="diagnostics-title" class="text-[15px] font-semibold tracking-tight">诊断</h2>
        <span class="text-[12px] text-text-tertiary">出问题时先看这一页</span>
        <button
          type="button"
          class="ml-auto flex h-7 items-center rounded-badge px-2 text-[12px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
          data-testid="diagnostics-refresh"
          @click="load"
        >
          刷新
        </button>
        <button
          type="button"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-badge text-text-tertiary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
          aria-label="关闭"
          data-testid="diagnostics-close"
          @click="emit('close')"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-3" data-testid="diagnostics-body">
        <p v-if="loading" class="py-8 text-center text-sm text-text-tertiary">正在收集…</p>
        <p v-else-if="error" class="py-8 text-center text-sm text-danger">{{ error }}</p>
        <template v-else-if="snapshot">
          <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-[12px]">
            <dt class="text-text-tertiary">软件版本</dt>
            <dd class="min-w-0 break-all text-text-primary" data-testid="diagnostics-version">
              {{ snapshot.appVersion }}（Electron {{ snapshot.electronVersion }} · {{ snapshot.platform }}）
            </dd>
            <dt class="text-text-tertiary">数据目录</dt>
            <dd class="min-w-0 break-all text-text-primary">{{ snapshot.dataDirectory }}</dd>
            <dt class="text-text-tertiary">数据库</dt>
            <dd class="min-w-0 break-all text-text-primary" data-testid="diagnostics-database">
              {{ formatBytes(snapshot.databaseBytes) }} · {{ snapshot.databasePath }}
            </dd>
            <dt class="text-text-tertiary">日志</dt>
            <dd class="min-w-0 break-all text-text-primary" data-testid="diagnostics-log">
              {{ formatBytes(snapshot.logBytes) }} · {{ snapshot.logPath }}
            </dd>
            <dt class="text-text-tertiary">备份</dt>
            <dd class="text-text-primary">
              {{ snapshot.backupCount }} 份 · 最新 {{ formatTime(snapshot.newestBackupAt) }}
            </dd>
            <dt class="text-text-tertiary">标记记录</dt>
            <dd class="text-text-primary" data-testid="diagnostics-marks">
              {{ snapshot.childCount }} 话 / {{ snapshot.recordCount }} 行 · 嵌字
              {{ snapshot.markCounts.typeset }} · 翻译 {{ snapshot.markCounts.translated }} · 校对
              {{ snapshot.markCounts.proofread }} · 监修 {{ snapshot.markCounts.supervised }}
            </dd>
          </dl>

          <h3 class="mt-4 text-[12px] font-medium text-text-secondary">日志尾部</h3>
          <pre
            class="mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-app-bg p-2 text-[11px] leading-4 text-text-secondary"
            data-testid="diagnostics-log-tail"
          >{{ logTail }}</pre>
        </template>
      </div>

      <footer class="flex items-center gap-2 border-t border-border px-5 py-3">
        <p class="min-w-0 flex-1 text-[11px] text-text-tertiary">
          这一页只读：不会改数据、也不会写文件。
        </p>
        <button
          type="button"
          class="h-8 shrink-0 rounded-badge border border-border bg-card-bg px-3 text-[13px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
          data-testid="diagnostics-open-log"
          @click="openLogFile"
        >
          打开日志文件
        </button>
        <button
          type="button"
          class="h-8 shrink-0 rounded-badge bg-accent px-3 text-[13px] font-medium text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!snapshot || copying"
          data-testid="diagnostics-copy"
          @click="copySummary"
        >
          复制诊断信息
        </button>
      </footer>
    </div>
  </div>
</template>
