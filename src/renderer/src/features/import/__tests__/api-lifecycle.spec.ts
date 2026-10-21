// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import {
  createDefaultLabelPlusGenerateOptions,
  type LabelPlusFileSelection
} from '@shared/labelplus-import'
import { useImportSource } from '../useImportSource'
import { usePhotoshopJob } from '../usePhotoshopJob'
import { useSettingsStore } from '@renderer/stores/settings'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const selection = { filePath: 'labels.txt' } as LabelPlusFileSelection
beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  window.comicType = {
    storeGet: vi.fn().mockResolvedValue(null),
    storeSet: vi.fn().mockResolvedValue(undefined),
    readLabelPlusJobReport: vi.fn().mockResolvedValue(null),
    runLabelPlusInPhotoshop: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        launched: true,
        reportPath: 'report.json',
        imageCount: 1,
        warnings: []
      })
  } as unknown as typeof window.comicType
})
afterEach(() => {
  vi.useRealTimers()
})

it('清空图源后，晚到的匹配结果不能恢复旧预览', async () => {
  const pending = deferred<never>()
  window.comicType.previewLabelPlusImport = vi.fn().mockReturnValue(pending.promise)
  const source = useImportSource(
    () => {},
    () => {}
  )
  source.selection.value = selection
  source.sourceDirectory.value = 'source'
  const first = source.refreshPreview()
  source.sourceDirectory.value = ''
  await source.refreshPreview()
  expect(source.loadingPreview.value).toBe(false)
  pending.resolve({ rows: [{ labelImageName: 'old.png' }] } as never)
  await first
  expect(source.preview.value).toBeNull()
  expect(source.selectedImageNames.value).toEqual([])
})

function mountJob() {
  useSettingsStore().photoshopPath = 'Photoshop.exe'
  let job!: ReturnType<typeof usePhotoshopJob>
  const wrapper = mount(
    defineComponent({
      setup() {
        job = usePhotoshopJob({
          selection: ref(selection),
          sourceDirectory: ref('source'),
          outputDirectory: ref('output'),
          matchMode: ref('file-name'),
          forcedExtension: ref(''),
          selectedImageNames: ref(['1.png']),
          selectedGroups: ref(['正文']),
          options: ref(createDefaultLabelPlusGenerateOptions())
        })
        return () => h('div')
      }
    })
  )
  return { job, wrapper }
}

it('旧回执不能覆盖新任务或停止新轮询，慢请求不叠加', async () => {
  const old = deferred<never>()
  vi.mocked(window.comicType.readLabelPlusJobReport).mockReturnValueOnce(old.promise)
  const { job, wrapper } = mountJob()
  await job.runInPhotoshop()
  await vi.advanceTimersByTimeAsync(2400)
  expect(window.comicType.readLabelPlusJobReport).toHaveBeenCalledTimes(1)
  await job.runInPhotoshop()
  old.resolve({ finishedAt: 'done', jobId: 'old' } as never)
  await flushPromises()
  expect(job.photoshopReport.value).toBeNull()
  await vi.advanceTimersByTimeAsync(1200)
  expect(window.comicType.readLabelPlusJobReport).toHaveBeenCalledTimes(3)
  wrapper.unmount()
  await vi.advanceTimersByTimeAsync(2400)
  expect(window.comicType.readLabelPlusJobReport).toHaveBeenCalledTimes(3)
})

it('页面卸载后晚到的启动结果不能重建轮询', async () => {
  const pending = deferred<never>()
  vi.mocked(window.comicType.runLabelPlusInPhotoshop).mockReturnValue(pending.promise)
  const { job, wrapper } = mountJob()
  const run = job.runInPhotoshop()
  wrapper.unmount()
  pending.resolve({ ok: true, launched: true, reportPath: 'late.json' } as never)
  await run
  expect(window.comicType.readLabelPlusJobReport).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
