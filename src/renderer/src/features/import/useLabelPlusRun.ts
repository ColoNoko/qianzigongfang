/**
 * 「译文导入」页的**运行**那一半（P7 之二，2026-10-05）：本地出图 + 交给 Photoshop。
 *
 * 从 `views/Import.vue` 搬出来的一段：按 P7 那一条要求，
 * 视图只留"编排"（谁在什么时候调谁），一域的逻辑收进一个 `use*`。
 *
 * **这一刀是纯搬家**：函数体逐字未改，连注释一起搬；视图那边照旧 `const { … } = use…()`
 * 解构，**模板一个字符都没动** —— 所以重构前后的截图必须逐字节相同（证据见交接文档）。
 *
 * 为什么单独切出"运行"这一半（而不是先切表单）：源码里本来就写着
 * 「这条路刻意与上面的本地出图**完全独立**」—— 它依赖的只有表单**读**出来的那几项，
 * 不存在反向依赖，是这块 2000 行文件里耦合最低的一刀。
 *
 * 依赖方向刻意做成**单向**：本 composable 只**读**表单的 ref（`LabelPlusRunInput`），
 * 从不去改它们 —— 表单的归属仍然在视图那儿。
 */
import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import type { AppSelectOption } from '@renderer/components/AppSelect.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useToastStore } from '@renderer/stores/toast'
import { basenameOf } from '@shared/paths'
import { LABELPLUS_IMPORT_API_VERSION, normalizeLabelPlusExtension } from '@shared/labelplus-import'
import type {
  LabelPlusFileSelection,
  LabelPlusGenerateOptions,
  LabelPlusGenerateResult,
  LabelPlusImageMatch,
  LabelPlusMatchMode,
  LabelPlusMatchPreview
} from '@shared/labelplus-import'
import type {
  LabelPlusJobReport,
  LabelPlusManifestJobRequest,
  LabelPlusPhotoshopRunResult
} from '@shared/labelplus-manifest'
import {
  exportLabelPlusManifest,
  generateLabelPlusPreviewPsd,
  generateLabelPlusPsd,
  readLabelPlusJobReport,
  runLabelPlusInPhotoshop
} from './importBridge'

/** 分组级方向的三选一。'inherit' 不落进清单 —— 不写就是跟随 defaults。 */
export type GroupDirectionChoice = 'inherit' | 'horizontal' | 'vertical'

type LabelPlusGeneratedFileStatus = NonNullable<LabelPlusGenerateResult['files'][number]>['status']

/** 本 composable 需要的**只读**表单输入（归属仍在视图）。 */
export interface LabelPlusRunInput {
  selection: Ref<LabelPlusFileSelection | null>
  /** 匹配预览（`generatePreview` 的第三道前置，与 `canPreviewImage` 的判据之一）。 */
  preview: Ref<LabelPlusMatchPreview | null>
  sourceDirectory: Ref<string>
  outputDirectory: Ref<string>
  matchMode: Ref<LabelPlusMatchMode>
  forcedExtension: Ref<string>
  selectedImageNames: Ref<string[]>
  selectedGroups: Ref<string[]>
  options: Ref<LabelPlusGenerateOptions>
  /** 「生成后导入项目」那个勾（偏好里持久化，所以归属在视图）。 */
  autoImportProject: Ref<boolean>
}

export function useLabelPlusRun(input: LabelPlusRunInput) {
  const toast = useToastStore()
  const workspace = useProjectWorkspace()
  const settings = useSettingsStore()

  const {
    selection,
    preview,
    sourceDirectory,
    outputDirectory,
    matchMode,
    forcedExtension,
    selectedImageNames,
    selectedGroups,
    options,
    autoImportProject
  } = input

  const result = ref<LabelPlusGenerateResult | null>(null)
  const previewResult = ref<LabelPlusGenerateResult | null>(null)
  const previewGenerating = ref(false)
  const generating = ref(false)
  const projectImportVisible = ref(false)
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

  /**
   * 分组级方向：多一个 'inherit'（跟随全场），所以不能复用 directionOptions。
   * 'inherit' 不会落进清单 —— 不写那个字段就是跟随 defaults。
   */
  const groupDirectionOptions: AppSelectOption[] = [
    { value: 'inherit', label: '跟随默认' },
    { value: 'horizontal', label: '横排' },
    { value: 'vertical', label: '竖排' }
  ]

  function pathBaseName(path: string | null | undefined): string {
    if (!path) return ''
    return basenameOf(path)
  }

  function outputPathForImage(imageName: string): string | null {
    const sources = [result.value, previewResult.value]
    for (const source of sources) {
      const file = source?.files.find(
        (item) => item.labelImageName === imageName && item.outputPath
      )
      if (file?.outputPath) return file.outputPath
    }
    return null
  }

  function outputPreviewPaths(): Record<string, string> {
    const paths: Record<string, string> = {}
    for (const source of [previewResult.value, result.value]) {
      for (const file of source?.files ?? []) {
        if (file.outputPath) paths[file.labelImageName] = file.outputPath
      }
    }
    return paths
  }

  function outputPreviewName(image: LabelPlusImageMatch): string {
    const source = image.sourceFileName || image.labelImageName
    const withoutExtension = source.replace(/\.[^.\\/]+$/, '')
    return (
      pathBaseName(outputPathForImage(image.labelImageName)) ||
      `${withoutExtension || 'untitled'}.psd`
    )
  }

  function canPreviewImage(imageName: string): boolean {
    return Boolean(
      outputPathForImage(imageName) ||
      preview.value?.rows.some((row) => row.labelImageName === imageName && row.matched)
    )
  }

  function resultFileName(file: LabelPlusGenerateResult['files'][number]): string {
    const actual = pathBaseName(file.outputPath)
    if (actual) return actual
    const source = pathBaseName(file.sourcePath) || file.labelImageName
    const withoutExtension = source.replace(/\.[^.\\/]+$/, '')
    return `${withoutExtension || 'untitled'}.psd`
  }

  function resultClass(status: LabelPlusGeneratedFileStatus): string {
    if (status === 'generated') return 'text-success'
    if (status === 'failed') return 'text-danger'
    return 'text-warning'
  }

  async function onProjectImportSave(payload: {
    parentTitle: string
    chapterNumber: string
    projectTitle: string
    folderPath: string
  }): Promise<void> {
    try {
      const saved = await workspace.saveChild(payload)
      projectImportVisible.value = false
      toast.addToast({
        type: 'success',
        message:
          saved.skipped > 0 && saved.added === 0
            ? '项目已存在，已跳过导入'
            : saved.skipped > 0
              ? `项目添加成功，新增 ${saved.added} 个，跳过 ${saved.skipped} 个`
              : `项目添加成功（${saved.added} 个）`
      })
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `项目导入失败：${error instanceof Error ? error.message : String(error)}`
      })
    }
  }

  async function generatePreview(): Promise<void> {
    if (!selection.value || !sourceDirectory.value || !preview.value) {
      toast.addToast({ type: 'warning', message: '请先选择 LabelPlus 文本和图源目录' })
      return
    }
    if (selectedGroups.value.length === 0) {
      toast.addToast({ type: 'warning', message: '请至少选择一个文本分组' })
      return
    }
    previewGenerating.value = true
    try {
      const next = await generateLabelPlusPreviewPsd({
        apiVersion: LABELPLUS_IMPORT_API_VERSION,
        labelFilePath: selection.value.filePath,
        sourceDirectory: sourceDirectory.value,
        match: {
          mode: matchMode.value,
          forcedExtension: normalizeLabelPlusExtension(forcedExtension.value)
        },
        // The main process replaces this with a disposable EXE-adjacent temp
        // directory. Keeping the field here preserves the same request shape
        // as the normal generator for external API clients.
        selectedImageNames: [...selectedImageNames.value],
        selectedGroups: [...selectedGroups.value],
        options: JSON.parse(JSON.stringify(options.value)) as LabelPlusGenerateOptions
      })
      previewResult.value = next
      const generated = next.files.filter((file) => file.status === 'generated').length
      toast.addToast({
        type: next.failedCount > 0 ? 'warning' : 'success',
        message: `临时预览已生成 ${generated} 个 PSD`
      })
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `生成预览 PSD 失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      previewGenerating.value = false
    }
  }

  async function generate(): Promise<void> {
    if (!selection.value) {
      toast.addToast({ type: 'warning', message: '请先选择 LabelPlus 文本文件' })
      return
    }
    if (!sourceDirectory.value) {
      toast.addToast({ type: 'warning', message: '请选择图源目录' })
      return
    }
    if (!outputDirectory.value) {
      toast.addToast({ type: 'warning', message: '请选择输出目录' })
      return
    }
    if (selectedGroups.value.length === 0) {
      toast.addToast({ type: 'warning', message: '请至少选择一个文本分组' })
      return
    }
    // 一张图都没选就发请求 = 让主进程去猜语义。以前的语义是"空数组 = 全选"
    // （主进程那两句判据在 size === 0 时永不成立）—— 点「清空」再生成会把整份图跑一遍，
    // 勾了「覆盖已有 PSD」时直接覆盖用户没勾的文件。见 2026-09-30 审查 critical。
    if (selectedImageNames.value.length === 0) {
      toast.addToast({
        type: 'warning',
        message: '请至少选择一张图片（想整份出图就点「全选」）'
      })
      return
    }
    generating.value = true
    result.value = null
    try {
      const next = await generateLabelPlusPsd({
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
        options: JSON.parse(JSON.stringify(options.value)) as LabelPlusGenerateOptions
      })
      result.value = next
      const summary = `已生成 ${next.generatedCount} 个 PSD，跳过 ${next.skippedCount} 个，失败 ${next.failedCount} 个`
      toast.addToast({ type: next.failedCount > 0 ? 'warning' : 'success', message: summary })
      if (next.failedCount === 0 && autoImportProject.value && sourceDirectory.value) {
        projectImportVisible.value = true
      }
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `PSD 生成失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      generating.value = false
    }
  }

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
    const tick = async (): Promise<void> => {
      try {
        const next = await readLabelPlusJobReport(reportPath)
        if (next) photoshopReport.value = next
        // finishedAt 有值 = 整批跑完了，停止轮询。
        if (next?.finishedAt) stopReportPolling()
      } catch {
        // 回执读失败不该打断界面；下一次 tick 再试。
      }
    }
    void tick()
    reportTimer = setInterval(() => void tick(), 1200)
  }

  function manifestFailureMessage(next: { message: string; issues: string[] }): string {
    return next.issues.length > 0 ? `${next.message}：${next.issues[0]}` : next.message
  }

  async function exportManifest(): Promise<void> {
    const reason = photoshopBlockReason()
    if (reason) {
      toast.addToast({ type: 'warning', message: reason })
      return
    }
    const request = manifestRequest()
    if (!request) return
    photoshopBusy.value = true
    try {
      const next = await exportLabelPlusManifest(request)
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
      const next = await runLabelPlusInPhotoshop(request, photoshopPath)
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

  onBeforeUnmount(stopReportPolling)

  return {
    // 状态
    result,
    previewResult,
    previewGenerating,
    generating,
    projectImportVisible,
    photoshopActionSet,
    photoshopGroupActions,
    photoshopGroupDirections,
    photoshopJob,
    photoshopReport,
    photoshopBusy,
    // 常量与纯函数
    groupDirectionOptions,
    setGroupDirection,
    outputPreviewPaths,
    outputPreviewName,
    canPreviewImage,
    resultFileName,
    resultClass,
    photoshopProgress,
    // 动作
    onProjectImportSave,
    generatePreview,
    generate,
    exportManifest,
    runInPhotoshop
  }
}
