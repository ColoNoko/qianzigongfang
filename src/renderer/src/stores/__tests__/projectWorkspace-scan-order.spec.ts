// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectWorkspace } from '../projectWorkspace'
import { PAIRED_PSD_STATS_VERSION, PAIRED_MODE_STATS_VERSION } from '@shared/status'

it('persists mode-only changes even when the file statistics are unchanged', async () => {
  const { workspace, child, scan } = setup()
  child.psdStats = [{mtimeMs:10,ctimeMs:10}]
  child.statsVersion = PAIRED_PSD_STATS_VERSION
  child.modeStatsVersion = PAIRED_MODE_STATS_VERSION
  const snapshot = result(10)
  scan.mockResolvedValue(snapshot)
  vi.spyOn(workspace,'applyPsdStatusOverrides').mockReturnValue([{
    ...snapshot.jpgPairs[0],
    psd:{...snapshot.jpgPairs[0].psd,status:'none',modes:{typeset:false,translated:false,proofread:true,supervised:false},modeTimestamps:{proofread:1000}}
  }])
  await workspace.scanChild(child)
  expect(workspace.persistParentsProgress).toHaveBeenCalledOnce()
  expect(child.psdModeStats?.proofread).toHaveLength(1)
})

function setup() {
  setActivePinia(createPinia())
  const workspace = useProjectWorkspace()
  const child = {
    id: 'audit',
    parentTitle: 'audit',
    folderPath: 'C:/isolated-audit',
    chapterNumber: '1',
    projectTitle: 'audit',
    lastMtimeMs: 10,
    psdStats: Array.from({ length: 10 }, () => ({ mtimeMs: 10, ctimeMs: 10 }))
  }
  workspace.parents = [{ id: 'parent', title: 'audit', lastMtimeMs: 10, children: [child] }]
  vi.spyOn(workspace, 'loadRememberedStatuses').mockResolvedValue(undefined)
  vi.spyOn(workspace, 'persistParentsProgress').mockResolvedValue(undefined)
  const scan = vi.fn()
  window.comicType = { scanChildProject: scan } as any
  return { workspace, child: workspace.parents[0].children[0], scan }
}
function result(time: number, errors: any[] = []) {
  return {
    jpgPairs: [
      {
        jpgPath: 'C:/isolated-audit/1.png',
        psd: { absPath: 'C:/isolated-audit/1.psd', mtimeMs: time, ctimeMs: time, status: 'none' }
      }
    ],
    txtFiles: [],
    errors
  }
}
it('retains ten-page statistics when a partial scan fails', async () => {
  const { workspace, child, scan } = setup()
  scan.mockResolvedValue(result(20, [{ path: 'blocked', msg: 'EACCES' }]))
  await expect(workspace.scanChild(child)).rejects.toThrow()
  expect(child.psdStats).toHaveLength(10)
  expect(workspace.persistParentsProgress).not.toHaveBeenCalled()
})
it('rejects a late older scan after the newer scan succeeds', async () => {
  const { workspace, child, scan } = setup()
  let finish!: (value: any) => void
  scan
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValueOnce(result(200))
  const older = workspace.scanChild(child)
  await workspace.scanChild(child)
  expect(child.lastMtimeMs).toBe(200)
  finish(result(100))
  await older
  expect(workspace.findChild(child.id)?.lastMtimeMs).toBe(200)
})
it('rejects an unreadable scan during import', async () => {
  const { workspace, child, scan } = setup()
  scan.mockResolvedValue({
    jpgPairs: [],
    txtFiles: [],
    errors: [{ path: child.folderPath, msg: 'EACCES' }]
  })
  await expect(workspace.scanForImport(child)).rejects.toThrow()
})
