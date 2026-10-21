// @vitest-environment jsdom
import type { SystemFontInfo } from '@shared/ipc-api'
import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { FontPreviewLoader } from '../preview-loader'

afterEach(() => vi.unstubAllGlobals())
it('bounds file reads, drops queued invisible faces and never registers stale results', async () => {
  const pending: Array<(value: unknown) => void> = []
  const fontPreview = vi.fn(() => new Promise((resolve) => pending.push(resolve)))
  window.comicType = { fontPreview } as unknown as typeof window.comicType
  const add = vi.fn()
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add, delete: vi.fn() } })
  vi.stubGlobal(
    'FontFace',
    class {
      async load() {
        return this
      }
    }
  )
  const loader = new FontPreviewLoader(vi.fn())
  const fonts = Array.from(
    { length: 100 },
    (_, i) => ({ id: String(i), filePath: `${i}.ttf` }) as SystemFontInfo
  )
  loader.show(fonts)
  expect(fontPreview).toHaveBeenCalledTimes(4)
  loader.clear()
  pending.splice(0).forEach((resolve) => resolve({ buffer: new ArrayBuffer(4), coverage: null }))
  await flushPromises()
  expect(add).not.toHaveBeenCalled()
  expect(fontPreview).toHaveBeenCalledTimes(4)
  loader.show([fonts[99]])
  pending.splice(0).forEach((resolve) => resolve({ buffer: new ArrayBuffer(4), coverage: null }))
  await flushPromises()
  expect(add).toHaveBeenCalledTimes(1)
  loader.clear()
})
