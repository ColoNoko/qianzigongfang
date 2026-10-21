import { basenameOf } from '@shared/paths'
import { ref } from 'vue'
import type {
  LabelPlusGenerateOptions,
  LabelPlusGenerateResult,
  LabelPlusImageMatch,
  LabelPlusMatchPreview
} from '@shared/labelplus-import'
import { LABELPLUS_IMPORT_API_VERSION, normalizeLabelPlusExtension } from '@shared/labelplus-import'
import { useToastStore } from '@renderer/stores/toast'
import type { Ref } from 'vue'
import type { ImportFormState } from './import-form'

export function useImportGeneration({
  selection,
  sourceDirectory,
  outputDirectory,
  matchMode,
  forcedExtension,
  selectedImageNames,
  selectedGroups,
  options,
  preview,
  autoImportProject
}: ImportFormState & {
  preview: Ref<LabelPlusMatchPreview | null>
  autoImportProject: Ref<boolean>
}) {
  const toast = useToastStore()

  const generating = ref(false)

  const result = ref<LabelPlusGenerateResult | null>(null)

  const previewResult = ref<LabelPlusGenerateResult | null>(null)

  const previewGenerating = ref(false)

  const projectImportVisible = ref(false)

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

  type LabelPlusGeneratedFileStatus = NonNullable<
    LabelPlusGenerateResult['files'][number]
  >['status']

  async function openLabelPlusPreview(
    mode: 'source' | 'output',
    initialImageName: string
  ): Promise<void> {
    if (!selection.value || !sourceDirectory.value) return
    const generatedOutputPaths = outputPreviewPaths()
    if (
      mode === 'output' &&
      Object.keys(generatedOutputPaths).length > 0 &&
      !generatedOutputPaths[initialImageName]
    ) {
      toast.addToast({ type: 'warning', message: '该项没有可用的已生成 PSD 预览' })
      return
    }
    try {
      const opened = await window.comicType.openLabelPlusPreview({
        apiVersion: LABELPLUS_IMPORT_API_VERSION,
        labelFilePath: selection.value.filePath,
        sourceDirectory: sourceDirectory.value,
        match: {
          mode: matchMode.value,
          forcedExtension: normalizeLabelPlusExtension(forcedExtension.value)
        },
        outputDirectory: outputDirectory.value || selection.value.suggestedOutputDirectory,
        selectedImageNames: [...selectedImageNames.value],
        selectedGroups: [...selectedGroups.value],
        options: JSON.parse(JSON.stringify(options.value)) as LabelPlusGenerateOptions,
        mode,
        initialImageName,
        ...(mode === 'output' && Object.keys(generatedOutputPaths).length > 0
          ? { previewOutputPaths: generatedOutputPaths }
          : {})
      })
      if (!opened.opened)
        toast.addToast({ type: 'warning', message: opened.message || '没有可预览内容' })
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `打开预览失败：${error instanceof Error ? error.message : String(error)}`
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
      const next = await window.comicType.generateLabelPlusPreviewPsd({
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
    if (generating.value) return
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
    const progressToast = toast.addToast({ type: 'loading', message: `正在生成 PSD · 已选 ${selectedImageNames.value.length} 张图片`, duration: 0 })
    result.value = null
    try {
      const next = await window.comicType.generateLabelPlusPsd({
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
      if (next.generatedCount > 0 && next.failedCount === 0 && autoImportProject.value && sourceDirectory.value) {
        projectImportVisible.value = true
      }
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `PSD 生成失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      toast.removeToast(progressToast)
      generating.value = false
    }
  }
  return {
    generating,
    result,
    previewResult,
    previewGenerating,
    projectImportVisible,
    outputPreviewName,
    canPreviewImage,
    resultFileName,
    resultClass,
    openLabelPlusPreview,
    generatePreview,
    generate
  }
}
