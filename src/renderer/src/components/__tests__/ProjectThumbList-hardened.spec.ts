// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ProjectThumbList from '../ProjectThumbList.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import type { JpgPsdPair, TypesetStatus } from '@shared/types'

// Stub ThumbGrid — same pattern as ProjectThumbList.spec.ts.
const ThumbGridStub = {
  name: 'ThumbGrid',
  props: ['items', 'thumbSize', 'load'],
  emits: ['dblclick', 'action'],
  template: `
    <div class="thumb-grid-stub">
      <div
        v-for="item in items"
        :key="item.id"
        class="stub-card"
      >
        <button class="stub-action" @click.stop="$emit('action', item.id)">
          去嵌字
        </button>
      </div>
    </div>
  `
}

function makePair(
  id: string,
  opts?: { jpgPath?: string; status?: TypesetStatus }
): JpgPsdPair {
  return {
    jpgPath: opts?.jpgPath,
    psd: {
      absPath: `/fake/${id}.psd`,
      mtimeMs: 1700000000000,
      ctimeMs: 1700000000000,
      status: opts?.status ?? 'none'
    }
  }
}

describe('ProjectThumbList — hardened open-in-editor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;(window as unknown as { comicType: unknown }).comicType = {
      readFileDataURL: vi.fn(() => Promise.resolve('data:image/jpeg;base64,test')),
      openPath: vi.fn(() => Promise.resolve({ ok: true })),
      storeSet: vi.fn(() => Promise.resolve())
    }
  })

  it('status=none with no import tool asks first and opens nothing when declined', async () => {
    const confirmPsFallback = vi.fn(() =>
      Promise.resolve({ confirmed: false, skipNextTime: false })
    )
    ;(window as unknown as { comicType: Record<string, unknown> }).comicType.confirmPsFallback =
      confirmPsFallback

    const pairs = [makePair('page_001', { jpgPath: '/fake/page_001.jpg', status: 'none' })]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    await wrapper.find('.stub-action').trigger('click')
    await nextTick()

    // 嵌字 on a chapter without PSDs is no longer a dead end: the user is asked.
    expect(confirmPsFallback).toHaveBeenCalledTimes(1)
    expect(window.comicType.openPath).not.toHaveBeenCalled()
    // Declining is silent — no toast.
    expect(wrapper.emitted('toast')).toBeFalsy()
  })

  it('status=none runs the 译文导入 script when Photoshop and the .jsx are configured', async () => {
    const launchTool = vi.fn(() => Promise.resolve({ ok: true }))
    ;(window as unknown as { comicType: Record<string, unknown> }).comicType.launchTool = launchTool
    const settings = useSettingsStore()
    settings.photoshopPath = 'E:\\PS\\Photoshop.exe'
    settings.typesetImportScript = 'E:\\PS\\Presets\\Scripts\\译文 .jsx'

    const pairs = [makePair('page_001', { jpgPath: '/fake/page_001.jpg', status: 'none' })]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    await wrapper.find('.stub-action').trigger('click')
    await nextTick()

    expect(launchTool).toHaveBeenCalledWith('E:\\PS\\Photoshop.exe', [
      'E:\\PS\\Presets\\Scripts\\译文 .jsx'
    ])
    expect(wrapper.emitted('toast')).toBeFalsy()
  })

  it('status=done with openPath ok emits no toast', async () => {
    const pairs = [makePair('page_001', { jpgPath: '/fake/page_001.jpg', status: 'done' })]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    const button = wrapper.find('.stub-action')
    await button.trigger('click')
    await nextTick()

    expect(window.comicType.openPath).toHaveBeenCalledTimes(1)
    expect(window.comicType.openPath).toHaveBeenCalledWith('/fake/page_001.psd')
    expect(wrapper.emitted('toast')).toBeFalsy()
  })

  it('status=pending with openPath E_NOT_FOUND emits toast error', async () => {
    (window as unknown as { comicType: { openPath: unknown } }).comicType.openPath = vi.fn(() =>
      Promise.resolve({ ok: false, code: 'E_NOT_FOUND', message: 'not found' })
    )

    const pairs = [makePair('page_001', { jpgPath: '/fake/page_001.jpg', status: 'pending' })]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    const button = wrapper.find('.stub-action')
    await button.trigger('click')
    await nextTick()

    const toastEvents = wrapper.emitted('toast')
    expect(toastEvents).toBeTruthy()
    expect(toastEvents![0]).toEqual([{ type: 'error', message: '文件不存在' }])
  })

  it('openPath E_NO_DEFAULT_APP emits correct mapped message', async () => {
    (window as unknown as { comicType: { openPath: unknown } }).comicType.openPath = vi.fn(() =>
      Promise.resolve({ ok: false, code: 'E_NO_DEFAULT_APP', message: 'no app' })
    )

    const pairs = [makePair('page_001', { jpgPath: '/fake/page_001.jpg', status: 'done' })]
    const wrapper = mount(ProjectThumbList, {
      props: { pairs, folderPath: '/fake' },
      global: { stubs: { ThumbGrid: ThumbGridStub } }
    })
    await nextTick()

    const button = wrapper.find('.stub-action')
    await button.trigger('click')
    await nextTick()

    const toastEvents = wrapper.emitted('toast')
    expect(toastEvents).toBeTruthy()
    expect(toastEvents![0]).toEqual([{ type: 'error', message: '没有默认应用打开该文件' }])
  })
})