// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { installUserFonts, listSystemFonts } from '../catalog'
const state = vi.hoisted(() => ({ scan: vi.fn(), install: vi.fn(), store: vi.fn(), snapshot: undefined as any }))
vi.mock('../windows', () => ({ listSystemFonts: state.scan, installUserFonts: state.install }))
vi.mock('../repository', () => ({ readSnapshot: () => state.snapshot, writeSnapshot: (_: string, value: unknown) => { state.snapshot = value }, clearSnapshot: () => { state.snapshot = undefined } }))
vi.mock('../../services/database', () => ({ setStoredValue: state.store }))

it('deduplicates scans and serializes entire mutations including a failed operation', async () => {
  const result = { supported: true, fonts: [], scannedAt: Date.now() }
  state.store.mockResolvedValue(undefined)
  state.scan.mockResolvedValue(result)
  await Promise.all([listSystemFonts({ refresh: true }), listSystemFonts({ refresh: true })])
  expect(state.scan).toHaveBeenCalledTimes(1)
  let release!: () => void
  state.install
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    .mockRejectedValueOnce(new Error('disk full'))
    .mockResolvedValueOnce({ installed: [], failed: [] })
  const first = installUserFonts(['first'])
  const second = installUserFonts(['second']).catch((error) => error.message)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.install).toHaveBeenCalledTimes(1)
  release()
  await first
  expect(await second).toBe('disk full')
  await installUserFonts(['third'])
  expect(state.install).toHaveBeenCalledTimes(3)
  expect(state.store.mock.calls.some(([, record]) => record.status === 'failed')).toBe(true)
})

it('never resurrects the pre-mutation cache when the post-install scan fails', async () => {
 const before = { supported: true, fonts: [], scannedAt: Date.now() }
 state.scan.mockResolvedValueOnce(before)
 await listSystemFonts({refresh:true})
 state.install.mockResolvedValue({installed:[],failed:[]})
 state.scan.mockRejectedValue(new Error('registry unavailable'))
 await installUserFonts(['new-font'])
 await expect(listSystemFonts()).rejects.toThrow('registry unavailable')
})
