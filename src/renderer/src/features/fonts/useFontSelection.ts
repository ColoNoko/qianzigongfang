import { ref } from 'vue'
import type { SystemFontInfo } from '@shared/ipc-api'
import type { ComputedRef } from 'vue'

export function useFontSelection(
  filteredFonts: ComputedRef<SystemFontInfo[]>,
  isRemovable: (font: SystemFontInfo) => boolean,
  resetVisibleLimit: () => void
) {
  const selectionMode = ref(false)

  const selectedFontIds = ref<string[]>([])

  const comparingSelected = ref(false)

  function isSelected(fontId: string): boolean {
    return selectedFontIds.value.includes(fontId)
  }

  function toggleSelection(font: SystemFontInfo): void {
    if (!selectionMode.value) return
    selectedFontIds.value = isSelected(font.id)
      ? selectedFontIds.value.filter((id) => id !== font.id)
      : [...selectedFontIds.value, font.id]
    if (selectedFontIds.value.length === 0) comparingSelected.value = false
  }

  function enterSelectionMode(): void {
    selectionMode.value = true
    selectedFontIds.value = []
    comparingSelected.value = false
  }

  function exitSelectionMode(): void {
    selectionMode.value = false
    selectedFontIds.value = []
    comparingSelected.value = false
  }

  function clearSelection(): void {
    selectedFontIds.value = []
    comparingSelected.value = false
  }

  function selectAllFiltered(): void {
    selectedFontIds.value = filteredFonts.value.filter(isRemovable).map((font) => font.id)
  }

  function compareSelectedFonts(): void {
    if (selectedFontIds.value.length === 0) return
    comparingSelected.value = !comparingSelected.value
    resetVisibleLimit()
  }
  return {
    selectionMode,
    selectedFontIds,
    comparingSelected,
    isSelected,
    toggleSelection,
    enterSelectionMode,
    exitSelectionMode,
    clearSelection,
    selectAllFiltered,
    compareSelectedFonts
  }
}
