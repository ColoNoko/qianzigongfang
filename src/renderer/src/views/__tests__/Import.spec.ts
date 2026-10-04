// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Import from '../Import.vue'
import AppSelect from '@renderer/components/AppSelect.vue'
import { LABELPLUS_IMPORT_SETTINGS_KEY } from '@shared/labelplus-import'
import { useSettingsStore } from '@renderer/stores/settings'
import { useToastStore } from '@renderer/stores/toast'

/**
 * AppSelect 是自定义下拉，驱动它要点开菜单再点选项 —— 那是在测它的内部 DOM。
 * 直接触发 `update:modelValue` 是它的**公开契约**，改版也不会碎。
 */
async function setGroupDirectionChoice(
  wrapper: VueWrapper,
  group: string,
  value: string
): Promise<void> {
  const select = wrapper
    .findAllComponents(AppSelect)
    .find((component) => component.props('testId') === `import-group-direction-${group}`)
  if (!select) throw new Error(`找不到「${group}」的方向下拉`)
  select.vm.$emit('update:modelValue', value)
  await flushPromises()
}

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
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="import-font-size"]').setValue('31')
    await wrapper.get('[data-testid="import-bold"]').setValue(true)
    await wrapper.get('[data-testid="import-offset-x"]').setValue('12')
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
    expect(request.options.positionOffset).toEqual({ unit: 'px', x: 12, y: 0 })
  })

  it('persists import preferences under the versioned settings key', async () => {
    const api = setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="import-font-size"]').setValue('28')
    await wrapper.get('[data-testid="import-auto-project"]').setValue(false)
    await flushPromises()

    expect(api.storeSet).toHaveBeenCalledWith(
      LABELPLUS_IMPORT_SETTINGS_KEY,
      expect.objectContaining({
        matchMode: 'file-name',
        options: expect.objectContaining({
          textStyle: expect.objectContaining({ fontSizePx: 28 })
        }),
        autoImportProject: false
      })
    )
  })

  it('标准垂直罗马对齐默认是开的，关掉后原样发出去', async () => {
    const api = setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    const box = wrapper.get('[data-testid="import-vertical-roman"]')
    expect((box.element as HTMLInputElement).checked).toBe(true)

    await box.setValue(false)
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
    expect((box.element as HTMLInputElement).checked).toBe(true)

    await box.setValue(false)
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
  it('「交给 Photoshop」面板与两个按钮都在，且本地生成按钮照旧', async () => {
    setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    // 这块面板在"已选文件"之后才渲染（和其余面板一致），所以先选一个文件。
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="import-photoshop-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="import-export-manifest"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="import-run-photoshop"]').exists()).toBe(true)
    // 本地那条路一个按钮都没少。
    expect(wrapper.find('[data-testid="import-generate-button"]').exists()).toBe(true)
  })

  it('没配 Photoshop 路径时只提示，绝不发请求', async () => {
    setupApi()
    const runLabelPlusInPhotoshop = vi.fn()
    ;(window.comicType as unknown as Record<string, unknown>).runLabelPlusInPhotoshop =
      runLabelPlusInPhotoshop

    const pinia = createPinia()
    const wrapper = mount(Import, { global: { plugins: [pinia] } })
    // 单独挂载 Import 时，settings store 的 loadSettings 不会被跑到（那是 App 的活），
    // 所以这里直接把状态摆成"没配 Photoshop"。
    useSettingsStore(pinia).photoshopPath = ''

    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="import-run-photoshop"]').trigger('click')
    await flushPromises()

    expect(runLabelPlusInPhotoshop).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('配好 Photoshop 后，把请求原样发出去并开始轮询回执', async () => {
    setupApi()
    const runLabelPlusInPhotoshop = vi.fn().mockResolvedValue({
      ok: true,
      message: '指令清单已生成：2 张图 / 3 条文字；已在 Photoshop 里开始执行',
      jobId: 'lp-1',
      manifestPath: 'C:\\app\\temp\\labelplus-jobs\\lp-1\\manifest.json',
      launcherPath: 'C:\\app\\temp\\labelplus-jobs\\lp-1\\run.jsx',
      reportPath: 'C:\\app\\temp\\labelplus-jobs\\lp-1\\report.json',
      runnerPath: 'C:\\app\\resources\\qianzi-runner.jsx',
      imageCount: 2,
      labelCount: 3,
      skippedImages: [],
      issues: [],
      launched: true,
      launchMessage: ''
    })
    const readLabelPlusJobReport = vi.fn().mockResolvedValue(null)
    Object.assign(window.comicType as unknown as Record<string, unknown>, {
      runLabelPlusInPhotoshop,
      readLabelPlusJobReport
    })

    const pinia = createPinia()
    const wrapper = mount(Import, { global: { plugins: [pinia] } })
    useSettingsStore(pinia).photoshopPath = 'C:\\PS\\Photoshop.exe'

    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="import-run-photoshop"]').trigger('click')
    await flushPromises()

    expect(runLabelPlusInPhotoshop).toHaveBeenCalledTimes(1)
    const [request, photoshopPath] = runLabelPlusInPhotoshop.mock.calls[0] as [
      Record<string, unknown>,
      string
    ]
    expect(photoshopPath).toBe('C:\\PS\\Photoshop.exe')
    expect(request).toMatchObject({
      apiVersion: 1,
      labelFilePath: 'C:\\work\\labels.txt',
      sourceDirectory: 'C:\\work',
      outputDirectory: 'C:\\work\\output',
      selectedImageNames: ['page-01.png', 'page-02.png'],
      selectedGroups: ['框内', '框外'],
      actionSetName: ''
    })
    expect(wrapper.text()).toContain('2 张图 / 3 条文字')

    // 轮询：装配后立刻读一次回执（这样界面不会先空着等 1.2 秒）。
    expect(readLabelPlusJobReport).toHaveBeenCalledWith(
      'C:\\app\\temp\\labelplus-jobs\\lp-1\\report.json'
    )

    // 卸载必须把定时器清掉，否则测试进程会一直挂着一个 interval。
    wrapper.unmount()
  })

  it('分组映射表：每个分组一行，动作名和方向都原样发出去', async () => {
    setupApi()
    const runLabelPlusInPhotoshop = vi.fn().mockResolvedValue({
      ok: true,
      message: 'ok',
      jobId: 'lp-1',
      manifestPath: 'C:\\app\\temp\\lp-1\\manifest.json',
      launcherPath: 'C:\\app\\temp\\lp-1\\run.jsx',
      reportPath: 'C:\\app\\temp\\lp-1\\report.json',
      runnerPath: 'C:\\app\\resources\\qianzi-runner.jsx',
      imageCount: 1,
      labelCount: 2,
      skippedImages: [],
      issues: [],
      launched: true,
      launchMessage: ''
    })
    Object.assign(window.comicType as unknown as Record<string, unknown>, {
      runLabelPlusInPhotoshop,
      readLabelPlusJobReport: vi.fn().mockResolvedValue(null)
    })

    const pinia = createPinia()
    const wrapper = mount(Import, { global: { plugins: [pinia] } })
    useSettingsStore(pinia).photoshopPath = 'C:\\PS\\Photoshop.exe'
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    // 文件里的两个分组各一行。
    expect(wrapper.find('[data-testid="import-group-mapping"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="import-group-action-框内"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="import-group-action-框外"]').exists()).toBe(true)

    // 动作名：显式填的走显式的，没填的留空（runner 会回落到分组名）。
    await wrapper.get('[data-testid="import-group-action-框内"]').setValue('框内竖')

    // 方向：AppSelect 是自定义下拉，直接驱动它的公开事件，不依赖内部 DOM 结构。
    await setGroupDirectionChoice(wrapper, '框外', 'vertical')
    await flushPromises()

    await wrapper.get('[data-testid="import-run-photoshop"]').trigger('click')
    await flushPromises()

    const [request] = runLabelPlusInPhotoshop.mock.calls[0] as [Record<string, unknown>]
    expect(request.groupActions).toEqual({ 框内: '框内竖' })
    // 'inherit' 不落进请求 —— 不写那个字段就是跟随全场默认。
    expect(request.groupDirections).toEqual({ 框外: 'vertical' })

    // 再点一次、改成"跟随默认"，应彻底消失而不是留下 'inherit'。
    await setGroupDirectionChoice(wrapper, '框外', 'inherit')
    await wrapper.get('[data-testid="import-run-photoshop"]').trigger('click')
    await flushPromises()
    const [second] = runLabelPlusInPhotoshop.mock.calls[1] as [Record<string, unknown>]
    expect(second.groupDirections).toEqual({})

    wrapper.unmount()
  })

  it('分组映射表会把没勾选的分组标出来（避免以为它会一起导出）', async () => {
    setupApi()
    const wrapper = mount(Import, { global: { plugins: [createPinia()] } })
    await wrapper.get('[data-testid="import-file-button"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="import-groups-inside"]').trigger('click')
    await flushPromises()

    const row = wrapper.get('[data-testid="import-group-action-框外"]').element.closest('tr')
    expect(row?.textContent).toContain('未勾选')

    wrapper.unmount()
  })

  /**
   * 2026-09-30 审查 critical：「清空图片」之后点生成，不许把整份图跑一遍。
   *
   * 「清空」把 `selectedImageNames` 置空（已选 0 张），而主进程原判据
   * `selectedImages.size > 0 && !selectedImages.has(name)` 在 size === 0 时永不成立
   * —— 空数组等于「全选」：整份文本的每一张图都会出图，勾了「覆盖已有 PSD」时
   * 更是直接覆盖用户没勾的文件。
   *
   * 锁：0 张时**在渲染侧就拦住**（不发请求），并给一句明确的提示。
   * 主进程侧的同一条语义由 labelplus-import-service.spec 锁着。
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
})
