import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { normalizeDuties } from '@shared/duties'
import type { ChildProject, ParentProject, WorkMode } from '@shared/types'
import { useSettingsStore } from '@renderer/stores/settings'

/** Duties belong to a work; a manual current-mode choice belongs to this chapter session. */
export function useChapterWorkMode(options: {
  parent: Readonly<Ref<ParentProject | null | undefined>>
  child: Readonly<Ref<ChildProject | null | undefined>>
  duties: Readonly<Ref<WorkMode[]>>
  dutiesReady: Readonly<Ref<boolean>>
  requestedMode?: Readonly<Ref<unknown>>
}): { currentMode: ComputedRef<WorkMode>; setCurrentMode: (mode: WorkMode) => void } {
  const settings = useSettingsStore()
  const selected = ref<WorkMode | null>(null)
  let entryKey = ''
  let manual = false
  let resolved = false

  const currentMode = computed(() => selected.value && settings.enabledWorkModes.includes(selected.value)
    ? selected.value : settings.enabledWorkModes.includes(settings.activeWorkMode)
      ? settings.activeWorkMode : settings.enabledWorkModes[0])

  function rememberEligibleMode(): void {
    const parent = options.parent.value
    const mode = selected.value
    if (!parent || !mode || !settings.settingsLoaded || !options.dutiesReady.value) return
    if (!normalizeDuties(options.duties.value).includes(mode)) return
    const remembered = settings.pendingProjectWorkModes[parent.id]?.mode ?? settings.projectWorkModes[parent.id]
    if (remembered !== mode) void settings.setProjectWorkMode(parent.id, mode)
  }

  function setCurrentMode(mode: WorkMode): void {
    if (!settings.enabledWorkModes.includes(mode)) return
    manual = true
    selected.value = mode
    rememberEligibleMode()
  }

  watch([
    () => options.parent.value?.id,
    () => options.child.value?.id,
    () => options.requestedMode?.value,
    () => settings.settingsLoaded,
    () => options.dutiesReady.value,
    () => options.duties.value.join(','),
    () => settings.enabledWorkModes.join(','),
    () => settings.activeWorkMode
  ], () => {
    const parent = options.parent.value
    const child = options.child.value
    const requested = options.requestedMode?.value
    const key = JSON.stringify([parent?.id, child?.id, requested])
    if (key !== entryKey) {
      entryKey = key
      manual = false
      resolved = false
      selected.value = null
    }
    if (!parent || !child || !settings.settingsLoaded || !options.dutiesReady.value) return

    // Slow hydration must not replace a choice made after opening the chapter.
    if (manual && selected.value && settings.enabledWorkModes.includes(selected.value)) {
      rememberEligibleMode()
      return
    }
    manual = false
    // Duty edits configure future entries; they do not switch an open chapter.
    if (resolved && selected.value && settings.enabledWorkModes.includes(selected.value)) return

    selected.value = typeof requested === 'string' && settings.enabledWorkModes.includes(requested as WorkMode)
      ? requested as WorkMode : settings.modeForProject(parent, options.duties.value, child)
    resolved = true
    rememberEligibleMode()
  }, { immediate: true, flush: 'sync' })

  return { currentMode, setCurrentMode }
}
