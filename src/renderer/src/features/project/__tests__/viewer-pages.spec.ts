// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { ref, nextTick, defineComponent } from 'vue'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectViewer } from '../useProjectViewer'
import { imageViewerPages } from '../viewer-pages'
import { useSettingsStore } from '@renderer/stores/settings'
import type { JpgPsdPair, WorkMode } from '@shared/types'
const { acquire } = vi.hoisted(() => ({ acquire: vi.fn(async (_path: string, _raster: boolean, _signal: AbortSignal, _priority?: number) => ({ release: vi.fn() })) }))
vi.mock('@renderer/services/previews', () => ({ previewCache: { acquire } }))
vi.mock('@renderer/services/thumbnails', () => ({ thumbnailKey: (p: JpgPsdPair) => p.psd.absPath, getThumbnailService: () => ({ state: () => ({ url:null }), release: vi.fn(), setVisible:vi.fn(), imageFailed:vi.fn() }) }))
enableAutoUnmount(afterEach)
afterEach(() => vi.clearAllMocks())
const source: JpgPsdPair[] = [
 { jpgPath:'/comic/1.jpg', psd:{absPath:'/comic/001.psd',mtimeMs:1,ctimeMs:1,status:'pending'} },
 { psd:{absPath:'/comic/extra.psd',mtimeMs:1,ctimeMs:1,status:'pending'} },
 { jpgPath:'/comic/1.jpg', psd:{absPath:'/comic/001-copy.psd',mtimeMs:1,ctimeMs:1,status:'pending'} }
]
it('builds unique naturally ordered image pages including originals without PSDs', () => {
 const pages=imageViewerPages(source,['/comic/10.jpg','/comic/2.png','/comic/1.jpg','/comic/1.jpg','/comic/extra.psd'])
 expect(pages.map(p=>p.psd.absPath)).toEqual(['/comic/1.jpg','/comic/2.png','/comic/10.jpg'])
 expect(pages.every(p=>p.previewOnly)).toBe(true)
})
it.each(['translated','proofread'] as const)('%s uses only images for wheel, jump, strip, marking advance and prefetch', async mode => {
 setActivePinia(createPinia());useSettingsStore().activeWorkMode=mode
 let viewer!:ReturnType<typeof useProjectViewer>
 mount(defineComponent({setup(){viewer=useProjectViewer(ref(source),ref(['/comic/1.jpg','/comic/2.png']));return ()=>null}}))
 await viewer.onCompare(source[0])
 expect(viewer.pageCount.value).toBe(2)
 expect(viewer.comparePair.value?.psd.absPath).toBe('/comic/1.jpg')
 viewer.shiftCompare(1);expect(viewer.comparePair.value?.psd.absPath).toBe('/comic/2.png')
 viewer.shiftCompare(1);expect(viewer.comparePair.value?.psd.absPath).toBe('/comic/1.jpg')
 viewer.onViewerReady();await nextTick()
 expect(acquire).toHaveBeenCalledWith('/comic/2.png',true,expect.any(AbortSignal),1)
 expect(acquire.mock.calls.every(call=>call[1]===true)).toBe(true)
 viewer.goToPage(2);expect(viewer.comparePair.value?.psd.absPath).toBe('/comic/2.png')
 viewer.onStripPick('/comic/1.jpg');viewer.advanceToNextPair();expect(viewer.comparePair.value?.psd.absPath).toBe('/comic/2.png')
 expect(viewer.stripItems.value.map(p=>p.filename)).toEqual(['1.jpg','2.png'])
 useSettingsStore().activeWorkMode='typeset';await nextTick()
 expect(viewer.pageCount.value).toBe(source.length)
 expect(viewer.comparePair.value?.psd.absPath.endsWith('.psd')).toBe(true)
 useSettingsStore().activeWorkMode=mode;await nextTick()
 expect(viewer.comparePair.value?.psd.absPath).toBe('/comic/1.jpg')
})

it('uses the comic mode for viewer pages independently of the global mode', async () => {
 setActivePinia(createPinia())
 const settings=useSettingsStore();settings.activeWorkMode='typeset'
 const mode=ref<WorkMode>('proofread')
 let viewer!:ReturnType<typeof useProjectViewer>
 mount(defineComponent({setup(){viewer=useProjectViewer(ref(source),ref(['/comic/1.jpg','/comic/2.png']),mode);return ()=>null}}))
 await viewer.onCompare(source[0])
 expect(viewer.pageCount.value).toBe(2)
 expect(viewer.comparePair.value?.previewOnly).toBe(true)
 settings.activeWorkMode='supervised';await nextTick()
 expect(viewer.pageCount.value).toBe(2)
 mode.value='typeset';await nextTick()
 expect(viewer.pageCount.value).toBe(source.length)
 expect(settings.activeWorkMode).toBe('supervised')
})
