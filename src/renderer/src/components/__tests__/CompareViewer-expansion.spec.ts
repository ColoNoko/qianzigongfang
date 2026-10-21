// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import CompareViewer from '../CompareViewer.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@renderer/components/ui/dialog'

enableAutoUnmount(afterEach)
vi.mock('@renderer/services/previews', () => ({
  previewCache: { acquire: vi.fn(async () => ({ url: 'data:image/png;base64,test', width: 200, height: 200, release() {} })) }
}))

const requestFullscreen = vi.fn()
const exitFullscreen = vi.fn()
beforeEach(() => {
  requestFullscreen.mockReset()
  exitFullscreen.mockReset()
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
})

function mountViewer(playing = false) {
  return mount(CompareViewer, {
    attachTo: document.body,
    props: { visible: true, imageOnly: true, psdPath: '/demo/01.jpg', jpgPath: '/demo/01.jpg', playing },
    global: { stubs: { ImageViewer: { template: '<div />' } } }
  })
}

describe('应用内展开', () => {
  it('uses a host layout event, never the screen Fullscreen API, and restores on the second click', async () => {
    const viewer = mountViewer()
    const button = viewer.get('[data-testid="compare-fullscreen"]')
    await button.trigger('click')
    expect(viewer.emitted('update:fullscreen')?.at(-1)).toEqual([true])
    expect(button.attributes('aria-pressed')).toBe('true')
    await button.trigger('click')
    expect(viewer.emitted('update:fullscreen')?.at(-1)).toEqual([false])
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(exitFullscreen).not.toHaveBeenCalled()
  })

  it('Esc from the focused expand control restores first, then stops playback, then closes', async () => {
    const viewer = mountViewer(true)
    const button = viewer.get('[data-testid="compare-fullscreen"]')
    await button.trigger('click')
    await button.trigger('keydown', { key: 'Escape' })
    expect(viewer.emitted('update:fullscreen')?.at(-1)).toEqual([false])
    expect(viewer.emitted('stopPlayback')).toBeUndefined()
    expect(viewer.emitted('close')).toBeUndefined()
    await button.trigger('keydown', { key: 'Escape' })
    expect(viewer.emitted('stopPlayback')).toHaveLength(1)
    expect(viewer.emitted('close')).toBeUndefined()
    await viewer.setProps({ playing: false })
    await button.trigger('keydown', { key: 'Escape' })
    expect(viewer.emitted('close')).toHaveLength(1)
  })

  it('hiding and reopening the preview clears expansion without losing the preview contract', async () => {
    const viewer = mountViewer()
    await viewer.get('[data-testid="compare-fullscreen"]').trigger('click')
    await viewer.setProps({ visible: false })
    expect(viewer.emitted('update:fullscreen')?.at(-1)).toEqual([false])
    await viewer.setProps({ visible: true })
    expect(viewer.get('[data-testid="compare-fullscreen"]').attributes('aria-pressed')).toBe('false')
  })

  it('close and unmount restore the host but do not change the native window state', async () => {
    const viewer = mountViewer()
    await viewer.get('[data-testid="compare-fullscreen"]').trigger('click')
    const close = viewer.findAll('button').find(button => button.text() === '退出预览')!
    await close.trigger('click')
    expect(viewer.emitted('update:fullscreen')?.at(-1)).toEqual([false])
    expect(viewer.emitted('close')).toHaveLength(1)
    viewer.unmount()
    expect(exitFullscreen).not.toHaveBeenCalled()
  })
  it.each(['popover', 'dialog'])('lets a real Reka %s close before restoring the expanded preview', async kind => {
    const viewer = mountViewer()
    await viewer.get('[data-testid="compare-fullscreen"]').trigger('click')
    const overlay = mount({
      components: { Popover, PopoverContent, PopoverTrigger, Dialog, DialogContent, DialogTitle, DialogDescription },
      data: () => ({ open: true }),
      template: kind === 'popover'
        ? '<Popover v-model:open="open"><PopoverTrigger>menu</PopoverTrigger><PopoverContent data-overlay>options</PopoverContent></Popover>'
        : '<Dialog v-model:open="open"><DialogContent data-overlay><DialogTitle>Records</DialogTitle><DialogDescription>History</DialogDescription></DialogContent></Dialog>'
    }, { attachTo: document.body })
    await flushPromises()
    expect(document.querySelector('[data-overlay][data-state="open"]')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await flushPromises()
    expect(overlay.vm.open).toBe(false)
    expect(viewer.emitted('update:fullscreen')?.at(-1)).toEqual([true])
    expect(viewer.emitted('close')).toBeUndefined()
    overlay.unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await flushPromises()
    expect(viewer.emitted('update:fullscreen')?.at(-1)).toEqual([false])
    expect(viewer.emitted('close')).toBeUndefined()
  })

})
