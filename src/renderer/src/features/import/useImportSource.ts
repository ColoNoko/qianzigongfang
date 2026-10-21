import { ref } from 'vue'
import type {
  LabelPlusFileSelection,
  LabelPlusMatchMode,
  LabelPlusMatchPreview
} from '@shared/labelplus-import'
import { LABELPLUS_IMPORT_API_VERSION, normalizeLabelPlusExtension } from '@shared/labelplus-import'
import { useToastStore } from '@renderer/stores/toast'

export function useImportSource(onSelectionChanged: () => void, onPreviewChanged: () => void, canChange: () => boolean = () => true) {
  const toast = useToastStore()

  const selection = ref<LabelPlusFileSelection | null>(null)

  const sourceDirectory = ref('')

  const outputDirectory = ref('')

  const matchMode = ref<LabelPlusMatchMode>('file-name')

  const forcedExtension = ref('')

  const preview = ref<LabelPlusMatchPreview | null>(null)

  const selectedImageNames = ref<string[]>([])

  const selectedGroups = ref<string[]>([])

  const loadingFile = ref(false)

  const loadingPreview = ref(false)

  const dropActive = ref(false)

  let previewSequence = 0

  function selectAllImages(): void {
    selectedImageNames.value = (preview.value?.rows ?? []).map((row) => row.labelImageName)
  }

  async function applySelection(next: LabelPlusFileSelection): Promise<void> {
    selection.value = next
    sourceDirectory.value = next.suggestedSourceDirectory || sourceDirectory.value
    outputDirectory.value = next.suggestedOutputDirectory || outputDirectory.value
    selectedGroups.value = [...next.groups]
    selectedImageNames.value = next.images.map((image) => image.fileName)
    onSelectionChanged()
    await refreshPreview()
  }

  async function loadDroppedInput(inputPath: string): Promise<void> {
    if (!canChange() || !inputPath || loadingFile.value) return
    loadingFile.value = true
    try {
      const next = await window.comicType.prepareLabelPlusInput(inputPath)
      await applySelection(next)
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `导入内容读取失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      loadingFile.value = false
    }
  }

  function droppedPath(event: DragEvent): string {
    const file = event.dataTransfer?.files?.[0]
    if (!file) return ''
    try {
      if (typeof window.comicType?.getPathForFile === 'function') {
        return window.comicType.getPathForFile(file)
      }
    } catch {
      // Older Electron builds may still expose the legacy File.path property.
    }
    return String((file as File & { path?: string }).path ?? '')
  }

  function onInputDragOver(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    dropActive.value = canChange()
  }

  function onInputDragLeave(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    const current = event.currentTarget as HTMLElement | null
    if (!current?.contains(event.relatedTarget as Node | null)) dropActive.value = false
  }

  async function onInputDrop(event: DragEvent): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    dropActive.value = false
    if (!canChange()) return
    const path = droppedPath(event)
    if (!path) {
      toast.addToast({ type: 'warning', message: '无法读取拖入文件的本地路径' })
      return
    }
    await loadDroppedInput(path)
  }

  async function pickLabelFile(): Promise<void> {
    if (!canChange() || loadingFile.value) return
    loadingFile.value = true
    try {
      const next = await window.comicType.pickLabelPlusFile()
      if (!next) return
      await applySelection(next)
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `LabelPlus 文件读取失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      loadingFile.value = false
    }
  }

  async function pickSourceDirectory(): Promise<void> {
    if (!canChange()) return
    const picked = await window.comicType.pickDirectory()
    if (!picked) return
    sourceDirectory.value = picked
    await refreshPreview()
  }

  async function pickOutputDirectory(): Promise<void> {
    if (!canChange()) return
    const picked = await window.comicType.pickDirectory()
    if (picked) outputDirectory.value = picked
  }

  async function refreshPreview(): Promise<void> {
    const sequence = ++previewSequence
    onPreviewChanged()
    if (!selection.value || !sourceDirectory.value) {
      preview.value = null
      loadingPreview.value = false
      return
    }
    loadingPreview.value = true
    try {
      const next = await window.comicType.previewLabelPlusImport({
        apiVersion: LABELPLUS_IMPORT_API_VERSION,
        labelFilePath: selection.value.filePath,
        sourceDirectory: sourceDirectory.value,
        match: {
          mode: matchMode.value,
          forcedExtension: normalizeLabelPlusExtension(forcedExtension.value)
        }
      })
      if (sequence !== previewSequence) return
      preview.value = next
      if (selectedImageNames.value.length === 0) selectAllImages()
    } catch (error) {
      if (sequence === previewSequence) {
        preview.value = null
        toast.addToast({
          type: 'error',
          message: `图源匹配失败：${error instanceof Error ? error.message : String(error)}`
        })
      }
    } finally {
      if (sequence === previewSequence) loadingPreview.value = false
    }
  }
  return {
    selection,
    sourceDirectory,
    outputDirectory,
    matchMode,
    forcedExtension,
    preview,
    selectedImageNames,
    selectedGroups,
    loadingFile,
    loadingPreview,
    dropActive,
    onInputDragOver,
    onInputDragLeave,
    onInputDrop,
    pickLabelFile,
    pickSourceDirectory,
    pickOutputDirectory,
    refreshPreview,
    selectAllImages
  }
}
