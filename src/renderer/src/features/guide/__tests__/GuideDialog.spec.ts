// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import GuideDialog from '../GuideDialog.vue'

enableAutoUnmount(afterEach)
afterEach(() => localStorage.clear())
const create = (startWithEntry = false) => mount(GuideDialog, {
  attachTo: document.body,
  props: { open: true, startWithEntry },
  global: { plugins: [createPinia()], renderStubDefaultSlot: true, stubs: { teleport: true } }
})
function message(wrapper: ReturnType<typeof create>, type: string, extra: Record<string, unknown> = {}) {
  const source = (wrapper.get('[data-testid=guide-frame]').element as HTMLIFrameElement).contentWindow!
  window.dispatchEvent(new MessageEvent('message', { source, data: { channel: 'hanhua-guide-host', type, ...extra } }))
}
it('opens the first core lesson on first entry and reference on a manual open', async () => {
  const wrapper = create()
  expect(wrapper.get('iframe').attributes('src')).toBe('./guide/index.html#quick/add')
  expect(wrapper.get('iframe').attributes('sandbox')).toBe('allow-scripts')
  await wrapper.setProps({ startWithEntry: true })
  expect(wrapper.get('iframe').attributes('src')).toBe('./guide/index.html#reference/add')
  await wrapper.get('[data-testid=guide-close]').trigger('click')
  expect(wrapper.emitted('close')).toHaveLength(1)
})
it('restores independent guide state and global appearance during initialization', () => {
  localStorage.setItem('hanhua-guide-v2', JSON.stringify({ read: ['quick/add'], work: { duties: ['监修'] } }))
  document.documentElement.dataset.theme = 'dark'
  document.documentElement.style.setProperty('--primary', 'hsl(180 60% 50%)')
  const wrapper = create()
  const target = (wrapper.get('iframe').element as HTMLIFrameElement).contentWindow!
  const post = vi.spyOn(target, 'postMessage')
  message(wrapper, 'ready')
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'init', theme: 'dark', colors: expect.objectContaining({ '--accent': 'hsl(180 60% 50%)' }), saved: localStorage.getItem('hanhua-guide-v2') }), '*')
})
it('persists messages only from the current guide frame and keeps project storage untouched', () => {
  localStorage.setItem('project-data', 'existing')
  const wrapper = create()
  window.dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'hanhua-guide-host', type: 'save', value: '{"read":[]}' } }))
  expect(localStorage.getItem('hanhua-guide-v2')).toBeNull()
  message(wrapper, 'save', { value: '{"read":["quick/add"],"work":{"complete":{"1:监修:1":true}}}' })
  expect(JSON.parse(localStorage.getItem('hanhua-guide-v2')!).work.complete['1:监修:1']).toBe(true)
  expect(localStorage.getItem('project-data')).toBe('existing')
  message(wrapper, 'close')
  expect(wrapper.emitted('close')).toHaveLength(1)
})
it('carries old reading marks into the new guide when there is no new saved state', () => {
  localStorage.setItem('guide-read-topics', '["welcome","fonts"]')
  const wrapper = create()
  const target = (wrapper.get('iframe').element as HTMLIFrameElement).contentWindow!
  const post = vi.spyOn(target, 'postMessage')
  message(wrapper, 'ready')
  const data = post.mock.calls[0][0]
  expect(JSON.parse(data.saved).read).toEqual(['quick/welcome', 'reference/fonts'])
})
