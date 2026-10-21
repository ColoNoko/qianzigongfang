// @vitest-environment jsdom
/**
 * 「译文导入」页的截图检查（2026-10-05，第三批大工程 P7 补的）。
 *
 * 为什么现在才补：这张页是**全项目最大的一个 view**（2111 行），而 11 组截图工装里
 * **没有一组覆盖它** —— 也就是说 P7 要拆它，却没有任何"拆前 / 拆后长得一样"的证据。
 * 单测（`Import.spec.ts`）能证明"点哪个按钮调哪个通道"，证明不了**版面**：
 * 九个分块（文件 / 路径 / 分组 / 样式 / 高级 / 叠字 / 预览 / 结果 / Photoshop）
 * 在一屏里的层级、间距、控件对齐，只有看图才算数。
 *
 * 口径与其它组一致：挂**真实组件**（不是截图用的替身）、用真实编译出的 CSS 出图，
 * 前置是至少跑过一次 `electron-vite build`（要 `out/renderer/assets/index-*.css`）。
 * 产出：<工作区>/temp/visual/import/{dark,light}.png
 *
 * ⚠️ 用到的漫画名 / 文件名都是**编的中性占位**，不引真实作品。
 */
import { beforeEach, describe, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Import from '@renderer/views/Import.vue'
import { shoot } from './panel-harness'

/** 与 `Import.spec.ts` 同形状的夹具（那边是断言用的，这边是出图用的）。 */
function makeSelection() {
  return {
    apiVersion: 1,
    filePath: 'D:\\工作\\第01话\\labels.txt',
    fileName: 'labels.txt',
    groups: ['框内', '框外', '旁白'],
    images: [
      { fileName: 'page-01.png', labelCount: 3, groupCounts: { 框内: 2, 框外: 1 } },
      { fileName: 'page-02.png', labelCount: 2, groupCounts: { 框外: 2 } }
    ],
    totalLabels: 5,
    warnings: [],
    suggestedSourceDirectory: 'D:\\工作\\第01话\\图源',
    suggestedOutputDirectory: 'D:\\工作\\第01话\\成品'
  }
}

function makePreview() {
  return {
    apiVersion: 1,
    rows: [
      {
        labelImageName: 'page-01.png',
        labelCount: 3,
        sourceFileName: 'page-01.jpg',
        sourcePath: 'D:\\工作\\第01话\\图源\\page-01.jpg',
        matched: true,
        message: '匹配到 page-01.jpg'
      },
      {
        labelImageName: 'page-02.png',
        labelCount: 2,
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
  }
}

function makeGenerated() {
  return {
    apiVersion: 1,
    generatedCount: 1,
    skippedCount: 1,
    failedCount: 1,
    outputDirectory: 'D:\\工作\\第01话\\成品',
    files: [
      {
        labelImageName: 'page-01.png',
        sourcePath: 'D:\\工作\\第01话\\图源\\page-01.jpg',
        outputPath: 'D:\\工作\\第01话\\成品\\page-01.psd',
        status: 'generated',
        textLayerCount: 3,
        message: '已生成',
        warnings: []
      },
      {
        labelImageName: 'page-02.png',
        sourcePath: 'D:\\工作\\第01话\\图源\\page-02.jpg',
        outputPath: 'D:\\工作\\第01话\\成品\\page-02.psd',
        status: 'skipped',
        textLayerCount: 0,
        message: '已存在，跳过',
        warnings: []
      },
      {
        // 三个状态各一行：这三行的颜色是 `resultClass()` 的三个分支，
        // 只有把 Failed 也摆上去，改坏那个分支才会在图上露出来。
        labelImageName: 'page-03.png',
        sourcePath: 'D:\\工作\\第01话\\图源\\page-03.jpg',
        outputPath: null,
        status: 'failed',
        textLayerCount: 0,
        message: '图源读不出来',
        warnings: []
      }
    ],
    warnings: []
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  ;(window as unknown as { comicType: unknown }).comicType = {
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined),
    writeLog: vi.fn().mockResolvedValue(undefined),
    pickLabelPlusFile: vi.fn().mockResolvedValue(makeSelection()),
    pickDirectory: vi.fn().mockResolvedValue('D:\\工作\\第01话\\图源'),
    prepareLabelPlusInput: vi.fn().mockResolvedValue(makeSelection()),
    previewLabelPlusImport: vi.fn().mockResolvedValue(makePreview()),
    openLabelPlusPreview: vi.fn().mockResolvedValue({ opened: true, sessionId: 'preview-1' }),
    generateLabelPlusPreviewPsd: vi.fn().mockResolvedValue(makeGenerated()),
    generateLabelPlusPsd: vi.fn().mockResolvedValue(makeGenerated()),
    exportLabelPlusManifest: vi.fn().mockResolvedValue({
      ok: true,
      message: '清单已写好',
      jobId: 'job-1',
      manifestPath: 'D:\\工作\\job\\manifest.json',
      launcherPath: 'D:\\工作\\job\\launch.jsx',
      reportPath: 'D:\\工作\\job\\report.json',
      runnerPath: 'D:\\工作\\job\\runner.jsx',
      imageCount: 2,
      labelCount: 5,
      skippedImages: [],
      issues: []
    }),
    fontList: vi.fn().mockResolvedValue({
      supported: true,
      scannedAt: 1_700_000_000_000,
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
  }
})

/**
 * 挂载并推到一个"有内容"的状态：选好文件 → 匹配预览出来 →（可选）真的出一次图。
 *
 * ⚠️ 两个按钮要都点：只点「预览」的话 **结果表根本不会渲染**（它 `v-if="result"`），
 * 于是"改坏结果行的配色"这类问题在图上完全看不出来 —— 第一版就是这么漏的，
 * 变异验证（把 failed 行的颜色改掉）**没被截图抓住**，回来补上这一步才咬住。
 */
async function mountReady(alsoGenerate = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Import, { global: { plugins: [pinia] } })
  await flushPromises()

  await wrapper.get('[data-testid="import-file-button"]').trigger('click')
  await flushPromises()

  if (alsoGenerate) {
    await wrapper.get('[data-testid="import-generate-preview-button"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="import-generate-button"]').trigger('click')
    await flushPromises()
  }
  return wrapper
}

describe('visual: 译文导入页', () => {
  it('九个分块 + 匹配表格 + 结果表', async () => {
    const wrapper = await mountReady(true)
    const page = wrapper.get('[data-testid="import-page"]')

    const panel = (testId: string): string => page.get(`[data-testid="${testId}"]`).html()

    const panels = [
      {
        label: '① 选择文件 + ② 路径',
        html: panel('import-file-section') + panel('import-path-section'),
        width: 1160,
        height: '560px'
      },
      {
        label: '③ 分组 + ④ 文字样式',
        html: panel('import-groups-section') + panel('import-style-section'),
        width: 1160,
        height: '660px'
      },
      {
        label: '⑤ 高级 + ⑥ 叠字',
        html: panel('import-advanced-section') + panel('import-overlay-section'),
        width: 1160,
        height: '660px'
      },
      {
        label: '⑦ 匹配预览表（一行一页，含未匹配行）',
        html: panel('import-preview-section'),
        width: 1160,
        height: '560px'
      },
      {
        label: '⑧ 生成结果 + ⑨ 交给 Photoshop',
        html: panel('import-result-section') + panel('import-photoshop-section'),
        width: 1160,
        height: '560px'
      }
    ]

    // ⚠️ 面板是**竖着摞**的（每个 1160 宽，一行放不下两个），而 `shoot` 的视口要自己给 ——
    // 给矮了，后面几个面板会被**静默裁掉**（第一版就是这样：1400px 只拍到第 3 个面板，
    // 而截图照样"成功生成"，是一张只有一半证据的图）。所以这里按
    // 「各面板高度之和 + 每个面板的标题与间距」算，宁可留白也不许裁。
    const stackHeight = panels.reduce(
      (sum, item) => sum + Number.parseInt(item.height, 10) + 46,
      40
    )

    await shoot({
      name: 'import',
      panels,
      viewport: { width: 1660, height: stackHeight },
      scale: 1
    })
  })
})
