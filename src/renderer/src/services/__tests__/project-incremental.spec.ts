// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { runProjectIncrementalScan } from '../project-incremental'
const workspace = vi.hoisted(() => ({
  parents: [] as any[],
  activeChild: null as any,
  scanChild: vi.fn(),
  loadParents: vi.fn()
}))
vi.mock('../../stores/projectWorkspace', () => ({ useProjectWorkspace: () => workspace }))
beforeEach(() => {
  vi.clearAllMocks()
  workspace.parents = [
    { id: 'p', children: [{ id: 'active' }, { id: 'offline' }, { id: 'other' }] }
  ]
  workspace.activeChild = { id: 'active' }
  workspace.scanChild.mockImplementation(async (child) => {
    if (child.id === 'offline') throw Error('offline')
  })
  window.comicType = {
    selfCheckPreview: vi.fn().mockResolvedValue({
      canDetect: true,
      sourceRoot: 'C:/one',
      sourceRoots: ['C:/one', 'C:/two'],
      candidates: [
        { folderPath: 'C:/two/new', folderName: 'new', chapterNumber: '2', projectTitle: 'new' },
        {
          folderPath: 'C:/one/conflict',
          folderName: 'conflict',
          chapterNumber: '1',
          projectTitle: 'conflict',
          conflict: 'same-chapter'
        }
      ]
    }),
    selfCheckImport: vi.fn().mockResolvedValue({ added: 1, skipped: 0, failed: 0 })
  } as any
})
it('updates inactive chapters, preserves unavailable ones and imports only non-conflicting multi-root candidates', async () => {
  expect(await runProjectIncrementalScan()).toBe(1)
  expect(workspace.scanChild.mock.calls.map(([child]) => child.id)).toEqual(['offline', 'other'])
  expect(window.comicType.selfCheckImport).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceRoots: ['C:/one', 'C:/two'],
      items: [expect.objectContaining({ folderPath: 'C:/two/new' })]
    })
  )
  expect(workspace.loadParents).toHaveBeenCalledOnce()
})
it('coalesces simultaneous requests and stops when disabled', async () => {
  const first = runProjectIncrementalScan(() => false)
  expect(runProjectIncrementalScan()).toBe(first)
  expect(await first).toBe(0)
  expect(workspace.scanChild).not.toHaveBeenCalled()
  expect(window.comicType.selfCheckImport).not.toHaveBeenCalled()
})
