import { useProjectWorkspace } from '../stores/projectWorkspace'

/** Sibling's low-frequency scan, adapted to multi-root discovery and conflict handling. */
export const PROJECT_INCREMENTAL_INTERVAL = 10 * 60 * 1000
let running: Promise<number> | undefined
export function runProjectIncrementalScan(current: () => boolean = () => true): Promise<number> {
  if (running) return running
  running = scan(current).finally(() => {
    running = undefined
  })
  return running
}
async function scan(current: () => boolean): Promise<number> {
  const workspace = useProjectWorkspace()
  if (!workspace.parents.length) await workspace.loadParents()
  let added = 0
  for (const parent of [...workspace.parents]) {
    for (const child of [...parent.children]) {
      if (!current()) return added
      if (workspace.activeChild?.id === child.id) continue
      try {
        await workspace.scanChild(child, current)
      } catch {
        /* Keep historical state. */
      }
    }
    if (!current()) return added
    try {
      const preview = await window.comicType.selfCheckPreview(parent.id)
      if (!current()) return added
      const items = preview.candidates.filter((candidate) => candidate.conflict !== 'same-chapter')
      if (!preview.canDetect || !preview.sourceRoot || !items.length) continue
      const result = await window.comicType.selfCheckImport({
        parentId: parent.id,
        sourceRoot: preview.sourceRoot,
        sourceRoots: [...(preview.sourceRoots ?? [])],
        rememberSourceRoot: false,
        requireContent: true,
        items: items.map(({ folderPath, folderName, chapterNumber, projectTitle }) => ({
          folderPath,
          folderName,
          chapterNumber,
          projectTitle
        }))
      })
      added += result.added
    } catch {
      /* An unavailable root must not stop other manga. */
    }
  }
  if (added) await workspace.loadParents()
  return added
}
