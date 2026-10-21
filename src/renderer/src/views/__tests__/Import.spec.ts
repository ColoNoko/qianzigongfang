// @vitest-environment jsdom
import { enableAutoUnmount, config } from '@vue/test-utils'
config.global.stubs.teleport = true
config.global.renderStubDefaultSlot = true
enableAutoUnmount(afterEach)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Import from '../Import.vue'
import { LABELPLUS_IMPORT_SETTINGS_KEY } from '@shared/labelplus-import'
import { useToastStore } from '@renderer/stores/toast'

/**
 * AppSelect 是自定义下拉，驱动它要点开菜单再点选项 —— 那是在测它的内部 DOM。
 * 直接触发 `update:modelValue` 是它的**公开契约**，改版也不会碎。
 */
function makeSelection() {
  return {
    apiVersion: 1,
    filePath: 'C:\\work\\labels.txt',
    fileName: 'labels.txt',
    groups: ['框内', '框外'],
    images: [
      { fileName: 'page-01.png', labelCount: 2, groupCounts: { 框内: 1, 框外: 1 } },
      { fileName: 'page-02.png', labelCount: 1, groupCounts: { 框外: 1 } }
    ],
    totalLabels: 3,
    warnings: [],
    suggestedSourceDirectory: 'C:\\work',
    suggestedOutputDirectory: 'C:\\work\\output'
  } as const
}

function makePreview() {
  return {
    apiVersion: 1,
    rows: [
      {
        labelImageName: 'page-01.png',
        labelCount: 2,
        sourceFileName: 'page-01.jpg',
        sourcePath: 'C:\\images\\page-01.jpg',
        matched: true,
        message: '匹配到 page-01.jpg'
      },
      {
        labelImageName: 'page-02.png',
        labelCount: 1,
        sourceFileName: null,
        sourcePath: null,
        matched: false,
        message: '未找到图源'
      }
    ],
    matchedCount: 1,
    unmatchedCount: 1,
    sourceFileCount: 1,
    warnings: []
  } as const
}

function setupApi() {
  const storeGet = vi.fn().mockResolvedValue(undefined)
  const storeSet = vi.fn().mockResolvedValue(undefined)
  const pickLabelPlusFile = vi.fn().mockResolvedValue(makeSelection())
  const pickDirectory = vi.fn().mockResolvedValue('C:\\images')
  const prepareLabelPlusInput = vi.fn().mockResolvedValue(makeSelection())
  const previewLabelPlusImport = vi.fn().mockResolvedValue(makePreview())
  const openLabelPlusPreview = vi.fn().mockResolvedValue({ opened: true, sessionId: 'preview-1' })
  const generateLabelPlusPreviewPsd = vi.fn().mockResolvedValue({
    apiVersion: 1,
    generatedCount: 1,
    skippedCount: 1,
    failedCount: 0,
    outputDirectory: 'C:\\app\\temp\\preview\\run-1',
    files: [
      {
        labelImageName: 'page-01.png',
        sourcePath: 'C:\\images\\page-01.jpg',
        outputPath: 'C:\\app\\temp\\preview\\run-1\\page-01.psd',
        status: 'generated',
        textLayerCount: 2,
        message: '已生成',
        warnings: []
      }
    ],
    warnings: []
  })
  const generateLabelPlusPsd = vi.fn().mockResolvedValue({
    apiVersion: 1,
    generatedCount: 1,
    skippedCount: 1,
    failedCount: 0,
    outputDirectory: 'C:\\work\\output',
    files: [
      {
        labelImageName: 'page-01.png',
        sourcePath: 'C:\\images\\page-01.jpg',
        outputPath: 'C:\\work\\output\\page-01.psd',
        status: 'generated',
        textLayerCount: 2,
        message: '已生成',
        warnings: []
      }
    ],
    warnings: []
  })
  window.comicType = {
    getPathForFile: vi.fn().mockReturnValue('C:\\bundle'),
    storeGet,
    storeSet,
    pickLabelPlusFile,
    prepareLabelPlusInput,
    pickDirectory,
    previewLabelPlusImport,
    generateLabelPlusPreviewPsd,
    generateLabelPlusPsd,
    openLabelPlusPreview,
    stat: vi.fn().mockResolvedValue({ isDirectory: true }),
    listDir: vi.fn().mockResolvedValue([]),
    scanChildProject: vi.fn().mockResolvedValue({ jpgPairs: [], txtFiles: [], errors: [] }),
    fontList: vi.fn().mockResolvedValue({
      supported: true,
      scannedAt: Date.now(),
      fonts: [
        {
          id: 'font-1',
          family: 'Noto Sans CJK SC',
          style: 'Regular',
          postScriptName: 'NotoSansCJKsc-Regular',
          displayName: 'Noto Sans CJK SC Regular',
          fileName: 'noto.ttf',
          filePath: 'C:\\Windows\\Fonts\\noto.ttf',
          format: 'TTF',
          source: 'system',
          managed: false,
          languages: ['chinese']
        }
      ]
    })
  } as unknown as typeof window.comicType
  return {
    storeGet,
    storeSet,
    pickLabelPlusFile,
    prepareLabelPlusInput,
    previewLabelPlusImport,
    generateLabelPlusPreviewPsd,
    generateLabelPlusPsd,
    openLabelPlusPreview
  }
}

describe('Import view', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('imports a LabelPlus file and exposes separate frame-group controls', async () => {
    const api = setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    expect(api.pickLabelPlusFile).toHaveBeenCalledTimes(1)
    expect(api.previewLabelPlusImport).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="import-groups-inside"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="import-groups-outside"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('page-01.jpg')
  })

  /**
   * 2026-09-23 把字号字段从 `fontSizePt` 改名成 `fontSizePx`（单位从"点"改成像素）。
   * 但用户**已经存过**的设置里那个键还叫 `fontSizePt` —— 不认它的话，
   * 字号会静默回落成默认值，用户只会觉得"我的设置怎么没了"。
   */
  it('旧存档里的 fontSizePt 要读得回，不能静默回落成默认值', async () => {
    const api = setupApi()
    api.storeGet.mockImplementation((key: string) =>
      Promise.resolve(
        key === LABELPLUS_IMPORT_SETTINGS_KEY
          ? { options: { textStyle: { fontSizePt: 31 } } }
          : undefined
      )
    )

    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await flushPromises()
    // 样式区在"已选文件"之后才渲染，所以要先选一个。
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    const input = wrapper.get('[data-testid="import-font-size"]').element as HTMLInputElement
    expect(input.value).toBe('31')
  })

  it('sends standardized font, direction, position and group settings to the generator', async () => {
    const api = setupApi()
    api.storeGet.mockImplementation(async (key: string) => key === LABELPLUS_IMPORT_SETTINGS_KEY ? {
      options: { positionOffset: { x: 12, y: 9 }, labelIndexOffset: { x: 7, y: 8 },
        textReplacementExpression: 'a->b', dialogOverlay: { enabled: true } }
    } : undefined)
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="import-font-size"]').setValue('31')
    await wrapper.get('[data-testid="import-bold"]').trigger('click')
    await wrapper.get('[data-testid="import-resolution"]').setValue('144')
    await wrapper.get('[data-testid="import-groups-outside"]').trigger('click')
    await wrapper.get('[data-testid="import-generate-button"]').trigger('click')
    await flushPromises()

    expect(api.generateLabelPlusPsd).toHaveBeenCalledTimes(1)
    const request = api.generateLabelPlusPsd.mock.calls[0][0]
    expect(request.apiVersion).toBe(1)
    expect(request.selectedGroups).toEqual(['框外'])
    expect(request.options.textStyle).toMatchObject({
      direction: 'horizontal',
      fontSizePx: 31,
      fauxBold: true,
      font: { postScriptName: expect.any(String) }
    })
    expect(request.options.positionOffset).toEqual({ unit: 'px', x: 0, y: 0 })
    expect(request.options.resolutionPpi).toBe(144)
    expect(request.options.labelIndexOffset).toEqual({ unit: 'px', x: 0, y: 0 })
    expect(request.options.textReplacementExpression).toBe('')
    expect(request.options.dialogOverlay.enabled).toBe(false)
  })

  it('persists import preferences under the versioned settings key', async () => {
    const api = setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()
    expect((wrapper.get('[data-testid="import-leading"]').element as HTMLInputElement).value).toBe('120')
    await wrapper.get('[data-testid="import-font-size"]').setValue('28')
    await wrapper.get('[data-testid="import-leading"]').setValue('135')
    await wrapper.get('[data-testid="import-auto-project"]').trigger('click')
    await flushPromises()

    expect(api.storeSet).toHaveBeenCalledWith(
      LABELPLUS_IMPORT_SETTINGS_KEY,
      expect.objectContaining({
        matchMode: 'file-name',
        options: expect.objectContaining({
          textStyle: expect.objectContaining({ fontSizePx: 28, leadingPercent: 135 })
        }),
        autoImportProject: false
      })
    )
    const saved = api.storeSet.mock.calls.filter(([key]) => key === LABELPLUS_IMPORT_SETTINGS_KEY).at(-1)![1]
    wrapper.unmount()
    api.storeGet.mockImplementation(async key => key === LABELPLUS_IMPORT_SETTINGS_KEY ? saved : undefined)
    const reopened = mount(Import, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await reopened.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()
    expect((reopened.get('[data-testid="import-font-size"]').element as HTMLInputElement).value).toBe('28')
    expect((reopened.get('[data-testid="import-leading"]').element as HTMLInputElement).value).toBe('135')
  })

  it('标准垂直罗马对齐默认是开的，关掉后原样发出去', async () => {
    const api = setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    const box = wrapper.get('[data-testid="import-vertical-roman"]')
    expect(box.attributes('aria-checked')).toBe('true')

    await box.trigger('click')
    await wrapper.get('[data-testid="import-generate-button"]').trigger('click')
    await flushPromises()

    expect(api.generateLabelPlusPsd.mock.calls[0][0].options.textStyle.standardVerticalRoman).toBe(
      false
    )
  })

  it('自由连字默认是开的，关掉后原样发出去', async () => {
    const api = setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    const box = wrapper.get('[data-testid="import-ligatures"]')
    expect(box.attributes('aria-checked')).toBe('true')

    await box.trigger('click')
    await wrapper.get('[data-testid="import-generate-button"]').trigger('click')
    await flushPromises()

    expect(api.generateLabelPlusPsd.mock.calls[0][0].options.textStyle.ligatures).toBe(false)
  })

  it('uses searchable font and style menus without exposing raw family or PostScript fields', async () => {
    setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="import-font-family"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="import-font-postscript"]').exists()).toBe(false)
    await wrapper.get('[data-testid="import-font-trigger"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="import-font-search"]').setValue('Noto')
    expect(wrapper.find('[data-testid="import-font-option-font-1"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="import-fill-color"]').element).toHaveProperty('value', '#000000')
  })

  it('opens source and rendered output preview windows from underlined file names', async () => {
    const api = setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="import-source-preview-page-01.png"]').trigger('click')
    await wrapper.get('[data-testid="import-output-preview-page-01.png"]').trigger('click')
    expect(api.openLabelPlusPreview.mock.calls.map((call) => call[0].mode)).toEqual([
      'source',
      'output'
    ])
  })

  it('generates temporary PSDs for output preview and shows PSD names in result lists', async () => {
    const api = setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="import-generate-preview-button"]').trigger('click')
    await flushPromises()
    expect(api.generateLabelPlusPreviewPsd).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-testid="import-output-preview-page-01.png"]').trigger('click')
    const previewRequest = api.openLabelPlusPreview.mock.calls.at(-1)?.[0]
    expect(previewRequest.previewOutputPaths).toEqual({
      'page-01.png': 'C:\\app\\temp\\preview\\run-1\\page-01.psd'
    })

    await wrapper.get('[data-testid="import-generate-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('page-01.psd')
  })

  it('accepts a dropped folder or ZIP path and opens project import after a failure-free run', async () => {
    const api = setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    const droppedFile = new File(['bundle'], 'bundle.zip')
    await wrapper.get('[data-testid="import-empty-state"]').trigger('drop', {
      dataTransfer: { files: [droppedFile] }
    })
    await flushPromises()
    expect(api.prepareLabelPlusInput).toHaveBeenCalledWith('C:\\bundle')

    await wrapper.get('[data-testid="import-generate-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('添加项目')
  })

  /**
   * 「交给 Photoshop」那条路是**新增**的一块，刻意不碰上面的本地出图 ——
   * 这几条锁的就是"它没有把既有流程带歪"。
   */
  it('图片被「清空」后点生成：不发请求，并提示要先选图片', async () => {
    const pinia = createPinia()
    const api = setupApi()
    const wrapper = mount(Import, { global: { plugins: [pinia] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    // 预览加载完会自动「全选」（Import.vue 的 refreshPreview）—— 这里模拟用户点「清空」
    const clearButton = wrapper.findAll('button').find((button) => button.text() === '清空')
    expect(clearButton).toBeTruthy()
    await clearButton!.trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="import-generate-button"]').trigger('click')
    await flushPromises()

    expect(api.generateLabelPlusPsd).not.toHaveBeenCalled()
    const toasts = useToastStore(pinia).toasts
    expect(toasts.at(-1)?.message).toContain('至少选择一张图片')

    wrapper.unmount()
  })
  it('locks import input while generating and removes the progress bubble after failure', async () => {
    const api = setupApi()
    const pinia = createPinia()
    const wrapper = mount(Import, { global: { plugins: [pinia] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()
    let fail!: (error: Error) => void
    api.generateLabelPlusPsd.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    await wrapper.get('[data-testid="import-generate-button"]').trigger('click')
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(useToastStore(pinia).toasts.some(item => item.type === 'loading')).toBe(true)
    await wrapper.get('[data-testid="import-file-section"]').trigger('drop', { dataTransfer: { files: [new File(['x'], 'other.zip')] } })
    expect(api.prepareLabelPlusInput).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="import-generate-button"]').trigger('click')
    expect(api.generateLabelPlusPsd).toHaveBeenCalledTimes(1)
    fail(new Error('write failed'))
    await flushPromises()
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
    expect(useToastStore(pinia).toasts.some(item => item.type === 'loading')).toBe(false)
    expect(useToastStore(pinia).toasts.some(item => item.message.includes('write failed'))).toBe(true)
  })

})
