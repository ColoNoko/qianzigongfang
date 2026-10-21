// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { fontCatalog } from '../catalog'
import type { FontListResult, SystemFontInfo } from '@shared/ipc-api'
it('shares a subscription and request, and never replaces a new event with an older snapshot', async () => {
  let event!: (value: FontListResult) => void, finish!: (value: FontListResult) => void
  const fontList = vi.fn(
    () =>
      new Promise<FontListResult>((r) => {
        finish = r
      })
  )
  const onFontsChanged = vi.fn((listener) => {
    event = listener
    return () => {}
  })
  window.comicType = { fontList, onFontsChanged } as unknown as typeof window.comicType
  const first = fontCatalog(),
    second = fontCatalog()
  const a = first.load(),
    b = second.load()
  expect(first).toBe(second)
  expect(fontList).toHaveBeenCalledOnce()
  expect(onFontsChanged).toHaveBeenCalledOnce()
  const font = { id: 'new' } as SystemFontInfo
  event({ supported: true, fonts: [font], scannedAt: 2 })
  finish({ supported: true, fonts: [], scannedAt: 1 })
  expect((await a).fonts).toEqual([font])
  await b
  expect(first.fonts.value).toEqual([font])
})
