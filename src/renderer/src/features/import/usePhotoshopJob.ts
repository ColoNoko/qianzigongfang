import type { ImportFormState } from './import-form'
import { type GroupDirectionChoice } from '@renderer/features/import/import-settings'
import { computed, onBeforeUnmount, ref } from 'vue'
import type { LabelPlusGenerateOptions } from '@shared/labelplus-import'
import { LABELPLUS_IMPORT_API_VERSION, normalizeLabelPlusExtension } from '@shared/labelplus-import'
import type {
  LabelPlusJobReport,
  LabelPlusManifestJobRequest,
  LabelPlusPhotoshopRunResult
} from '@shared/labelplus-manifest'
import { useSettingsStore } from '@renderer/stores/settings'
import { useToastStore } from '@renderer/stores/toast'

export function usePhotoshopJob({
  selection,
  sourceDirectory,
  outputDirectory,
  matchMode,
  forcedExtension,
  selectedImageNames,
  selectedGroups,
  options
}: ImportFormState) {
  const settings = useSettingsStore()
  const toast = useToastStore()

  /**
   * 「交给 Photoshop」那一块。刻意与本地出图完全独立：
   *   photoshopJob     = 本次递出去的清单信息（路径、数量）
   *   photoshopReport  = PS 写回来的回执（轮询读，不需要额外的进度事件通道）
   *   photoshopBusy    = 正在递清单 / 启动 PS
   */
  const photoshopActionSet = ref('')

  const photoshopGroupActions = ref<Record<string, string>>({})

  const photoshopGroupDirections = ref<Record<string, GroupDirectionChoice>>({})

  const photoshopJob = ref<LabelPlusPhotoshopRunResult | null>(null)

  const photoshopReport = ref<LabelPlusJobReport | null>(null)

  const photoshopBusy = ref(false)

  let reportTimer: ReturnType<typeof setInterval> | null = null
  let reportSequence = 0
  let disposed = false

  // ---- 「交给 Photoshop」那条路 -------------------------------------------------
  //
  // 这条路刻意与上面的本地出图**完全独立**：不动 generate()、不动 previewResult，
  // 所以既有的导入功能一行都没改。两边吃的是同一份表单，只是终点不同。

  /**
   * 请求体与本地出图**同形**（都满足 LabelPlusGenerateRequest），所以界面上不用维护两套表单。
   * 多出来的只有 actionSetName。
   */
  function manifestRequest(): LabelPlusManifestJobRequest | null {
    if (!selection.value) return null
    return {
      apiVersion: LABELPLUS_IMPORT_API_VERSION,
      labelFilePath: selection.value.filePath,
      sourceDirectory: sourceDirectory.value,
      match: {
        mode: matchMode.value,
        forcedExtension: normalizeLabelPlusExtension(forcedExtension.value)
      },
      outputDirectory: outputDirectory.value,
      selectedImageNames: [...selectedImageNames.value],
      selectedGroups: [...selectedGroups.value],
      // 响应式对象发 IPC 前必须摊平成普通对象（§13.2 踩过：主进程只会回一句
      // "An object could not be cloned"，看不出是哪个字段）。
      options: JSON.parse(JSON.stringify(options.value)) as LabelPlusGenerateOptions,
      actionSetName: photoshopActionSet.value.trim(),
      groupActions: { ...photoshopGroupActions.value },
      groupDirections: explicitGroupDirections()
    }
  }

  /** 拦在发请求之前。分组为空也拦 —— 否则会生成一份"一张图都不带文字"的清单。 */
  function photoshopBlockReason(): string {
    if (!selection.value) return '请先选择 LabelPlus 文本文件'
    if (!sourceDirectory.value) return '请选择图源目录'
    if (!outputDirectory.value) return '请选择输出目录'
    if (selectedGroups.value.length === 0) return '请至少选择一个文本分组'
    // 与「生成 PSD」同一条语义：0 张图片 = 什么都不做，而不是整份跑一遍。
    if (selectedImageNames.value.length === 0) return '请至少选择一张图片（想整份出图就点「全选」）'
    return ''
  }

  // ---- 分组映射表（动作名 / 文字方向）------------------------------------------

  function groupIsSelected(group: string): boolean {
    return selectedGroups.value.includes(group)
  }

  function groupDirectionChoice(group: string): GroupDirectionChoice {
    return photoshopGroupDirections.value[group] ?? 'inherit'
  }

  function setGroupDirection(group: string, value: string | number): void {
    // 整体替换而不是就地改：ref 里装的是普通对象，换引用最不容易踩响应式的坑。
    photoshopGroupDirections.value = {
      ...photoshopGroupDirections.value,
      [group]: String(value) as GroupDirectionChoice
    }
  }

  /** 只把"明确改过"的方向交出去；'inherit' 不写进清单，交由 runner 回落到 defaults。 */
  function explicitGroupDirections(): Record<string, 'horizontal' | 'vertical'> {
    const result: Record<string, 'horizontal' | 'vertical'> = {}
    for (const [group, choice] of Object.entries(photoshopGroupDirections.value)) {
      if (choice === 'inherit') continue
      result[group] = choice
    }
    return result
  }

  function stopReportPolling(): void {
    reportSequence++
    if (reportTimer !== null) {
      clearInterval(reportTimer)
      reportTimer = null
    }
  }

  /**
   * 回执是 PS 那边"每处理完一张图就整份重写"，所以只能轮询。
   * 换来的是**不需要新增任何进度事件通道** —— 少一条跨进程链路，就少一处会漂移的契约。
   */
  function startReportPolling(reportPath: string): void {
    stopReportPolling()
    const sequence = reportSequence
    let reading = false
    const tick = async (): Promise<void> => {
      if (reading || disposed || sequence !== reportSequence) return
      reading = true
      try {
        const next = await window.comicType.readLabelPlusJobReport(reportPath)
        if (disposed || sequence !== reportSequence) return
        if (next) photoshopReport.value = next
        // finishedAt 有值 = 整批跑完了，停止轮询。
        if (next?.finishedAt) stopReportPolling()
      } catch {
        // 回执读失败不该打断界面；下一次 tick 再试。
      } finally {
        reading = false
      }
    }
    void tick()
    reportTimer = setInterval(() => void tick(), 1200)
  }

  function manifestFailureMessage(next: { message: string; issues: string[] }): string {
    return next.issues.length > 0 ? `${next.message}：${next.issues[0]}` : next.message
  }

  async function exportManifest(): Promise<void> {
    if (photoshopBusy.value || disposed) return
    const reason = photoshopBlockReason()
    if (reason) {
      toast.addToast({ type: 'warning', message: reason })
      return
    }
    const request = manifestRequest()
    if (!request) return
    photoshopBusy.value = true
    stopReportPolling()
    try {
      const next = await window.comicType.exportLabelPlusManifest(request)
      if (disposed) return
      photoshopReport.value = null
      photoshopJob.value = next.ok ? { ...next, launched: false, launchMessage: '' } : null
      if (!next.ok) {
        toast.addToast({ type: 'error', message: manifestFailureMessage(next) })
        return
      }
      toast.addToast({
        type: 'success',
        message: `${next.message}。清单已写到 ${next.manifestPath}`
      })
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `导出指令清单失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      photoshopBusy.value = false
    }
  }

  async function runInPhotoshop(): Promise<void> {
    if (photoshopBusy.value || disposed) return
    const reason = photoshopBlockReason()
    if (reason) {
      toast.addToast({ type: 'warning', message: reason })
      return
    }
    const photoshopPath = settings.photoshopPath.trim()
    if (!photoshopPath) {
      toast.addToast({
        type: 'warning',
        message: '尚未配置 Photoshop 程序，请先在「设置 → 外部工具」里指定其路径'
      })
      return
    }
    const request = manifestRequest()
    if (!request) return
    photoshopBusy.value = true
    photoshopJob.value = null
    photoshopReport.value = null
    stopReportPolling()
    try {
      const next = await window.comicType.runLabelPlusInPhotoshop(request, photoshopPath)
      if (disposed) return
      photoshopJob.value = next
      if (!next.ok) {
        toast.addToast({ type: 'error', message: manifestFailureMessage(next) })
        return
      }
      if (!next.launched) {
        toast.addToast({ type: 'error', message: next.message })
        return
      }
      toast.addToast({ type: 'success', message: next.message })
      if (next.reportPath) startReportPolling(next.reportPath)
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `交给 Photoshop 失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      photoshopBusy.value = false
    }
  }

  const photoshopProgress = computed(() => {
    const job = photoshopJob.value
    if (!job || !job.ok) return null
    const report = photoshopReport.value
    return {
      total: job.imageCount,
      done: report ? report.generated + report.failed + report.skipped : 0,
      finished: Boolean(report?.finishedAt),
      failed: report?.failed ?? 0,
      // 回执里两类警告都要露出来：批次级的（如尺寸对不上）和逐张级的（如动作不存在）。
      // 再加上工坊侧的提醒（如"涂白这条路还没实现"）—— 它不在回执里，PS 不知道这事。
      warnings: [
        // `?? []` 不是多余的：这个字段是新增的，而载荷来自 IPC ——
        // 缺了它会让整个 computed 抛错，面板直接渲染不出来（测试抓到过）。
        ...(job.warnings ?? []),
        ...(report?.warnings ?? []),
        ...(report?.images ?? []).flatMap((image) => image.warnings)
      ]
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    stopReportPolling()
  })
  return {
    photoshopActionSet,
    photoshopGroupActions,
    photoshopGroupDirections,
    photoshopJob,
    photoshopReport,
    photoshopBusy,
    photoshopBlockReason,
    groupIsSelected,
    groupDirectionChoice,
    setGroupDirection,
    exportManifest,
    runInPhotoshop,
    photoshopProgress
  }
}
