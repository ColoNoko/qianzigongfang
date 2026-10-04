// @vitest-environment node
/**
 * 直接**执行** `resources/qianzi-runner.jsx` —— 用一套假 Photoshop。
 *
 * 为什么要这样测：runner 是 ExtendScript（ES3），跑在 PS 里，这台机器上**一行都执行不了**；
 * 而它已经因为 ASI 的坑让我陪用户跑了两次真机。在真机之外唯一能拿到反馈的办法，
 * 就是把它当普通 JS 执行、把 PS 的全局对象全部换成假货 —— 于是它的**真实代码路径**
 * （清单读取 → 建文字层 → 跑动作 → 存盘 → 写回执）能在单测里跑完。
 *
 * 这里验的是刻意挑出来的那几件"错了会静默出问题"的事：
 *   - 动作不存在时，警告**每组每张图只记一条**（不是每条文字一条）
 *   - `actions` 按「分组 + 动作」**聚合**，`count` 记实际跑了几次
 *   - 一次失败不能被后面的成功盖掉（`ok` 单调向下）
 *   - `_start` / `_end` 每张图各一次
 *   - 竖排真的传到了 `textItem.direction`
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDefaultTextStyle } from '@shared/labelplus-import'
import {
  LABELPLUS_MANIFEST_VERSION,
  validateLabelPlusManifest,
  type LabelPlusJobReport,
  type LabelPlusManifest
} from '@shared/labelplus-manifest'

const RUNNER_PATH = resolve(__dirname, '../../../../resources/qianzi-runner.jsx')

// ---------------------------------------------------------------------------
// 假 Photoshop
// ---------------------------------------------------------------------------

interface FakeLayer {
  name: string
  kind: unknown
  textItem: Record<string, unknown>
  move: (target: unknown, placement: unknown) => void
}

interface HarnessResult {
  report: LabelPlusJobReport
  alerts: string[]
  savedPaths: string[]
  layers: FakeLayer[]
  openedPaths: string[]
  actionsCalled: string[]
}

function run(
  manifest: LabelPlusManifest,
  options: {
    /** 这些「动作组/动作」在假 PS 里存在，其余一律按"不存在"抛错。 */
    existingActions?: string[]
    /** 覆盖默认判定：给「第几次调用该失败」用（callIndex 从 0 起，按动作分别计）。 */
    shouldFail?: (fullName: string, callIndex: number) => boolean
    /**
     * 假文件系统里"已存在"的路径。默认把清单里的图源当作存在 ——
     * 否则 runner 会在 `app.open` 之前就判定"找不到底图"直接返回，
     * 后面每条断言都会退化成"它其实什么都没干"。
     */
    existingPaths?: string[]
  } = {}
): HarnessResult {
  const existingActions = options.existingActions ?? []
  const shouldFail = options.shouldFail
  const existingPaths =
    options.existingPaths ?? manifest.images.map((image) => image.sourcePath)
  const written = new Map<string, string>()
  const alerts: string[] = []
  const savedPaths: string[] = []
  const layers: FakeLayer[] = []
  const openedPaths: string[] = []
  const actionsCalled: string[] = []
  const source = readFileSync(RUNNER_PATH, 'utf8')

  // ExtendScript 的 File：只需要够 runner 读写用。
  class FakeFile {
    fsName: string
    encoding = ''
    parent: { exists: boolean; fsName: string; create: () => boolean }
    private mode = ''
    private buffer = ''

    constructor(path: string) {
      this.fsName = path
      this.parent = {
        exists: true,
        fsName: path.replace(/[\\/][^\\/]*$/u, ''),
        create: () => true
      }
    }

    /** 真 PS 里这是真实文件系统；这里用"声明存在的路径 + 已写出的路径"顶上。 */
    get exists(): boolean {
      return written.has(this.fsName) || existingPaths.includes(this.fsName)
    }

    open(mode: string): boolean {
      this.mode = mode
      this.buffer = ''
      return true
    }

    write(text: string): void {
      this.buffer += text
    }

    read(): string {
      return written.get(this.fsName) ?? ''
    }

    close(): void {
      if (this.mode === 'w') written.set(this.fsName, this.buffer)
    }
  }

  const newTextLayer = (): FakeLayer => {
    const textItem: Record<string, unknown> = {}
    const layer: FakeLayer = { name: '', kind: null, textItem, move: () => undefined }
    layers.push(layer)
    return layer
  }

  let documentCounter = 0
  const callCounts = new Map<string, number>()
  const app = {
    displayDialogs: 'ORIGINAL',
    doAction(actionName: string, setName: string): void {
      const fullName = `${setName}/${actionName}`
      const callIndex = callCounts.get(fullName) ?? 0
      callCounts.set(fullName, callIndex + 1)
      actionsCalled.push(fullName)

      if (shouldFail && shouldFail(fullName, callIndex)) {
        // 用一句**不含**「不可用」的措辞，走的是"执行失败"那条分支而不是"不存在"。
        throw new Error(`The action "${actionName}" did not run.`)
      }
      if (existingActions.includes(fullName)) return
      // PS 对「动作不存在」的真实措辞，runner 就是靠这个字符串判断的。
      throw new Error(`The action "${actionName}" is not currently available.`)
    },
    open(file: { fsName: string }): Record<string, unknown> {
      openedPaths.push(file.fsName)
      documentCounter += 1
      const image = manifest.images[documentCounter - 1]
      const groups = new Map<string, { name: string; children: FakeLayer[] }>()
      return {
        mode: 'RGB',
        width: { value: image?.width ?? 100 },
        height: { value: image?.height ?? 100 },
        activeLayer: null,
        changeMode: () => undefined,
        artLayers: { add: newTextLayer },
        layerSets: {
          add: () => {
            const set = { name: '', children: [] as FakeLayer[] }
            return set
          }
        },
        saveAs: (file: { fsName: string }) => {
          savedPaths.push(file.fsName)
        },
        close: () => undefined,
        __groups: groups
      }
    }
  }

  const globals: Record<string, unknown> = {
    $: { qianziManifest: manifest },
    app,
    File: FakeFile,
    alert: (message: string) => alerts.push(message),
    UnitValue: class {
      constructor(
        public value: number,
        public units: string
      ) {}
    },
    SolidColor: class {
      rgb = { red: 0, green: 0, blue: 0 }
    },
    LayerKind: { TEXT: 'text' },
    Direction: { HORIZONTAL: 'horizontal', VERTICAL: 'vertical' },
    AntiAlias: { SMOOTH: 'smooth' },
    TextType: { POINTTEXT: 'point' },
    Justification: { LEFT: 'left', CENTER: 'center', RIGHT: 'right' },
    ElementPlacement: { PLACEATBEGINNING: 'placeAtBeginning' },
    DocumentMode: { INDEXEDCOLOR: 'indexed' },
    ChangeMode: { RGB: 'RGB' },
    PhotoshopSaveOptions: class {},
    Extension: { LOWERCASE: 'lowercase' },
    SaveOptions: { DONOTSAVECHANGES: 2 },
    DialogModes: { NO: 3 }
  }

  const names = Object.keys(globals)
  const evaluator = new Function(...names, source)
  evaluator(...names.map((name) => globals[name]))

  const raw = written.get(manifest.report.path)
  if (!raw) throw new Error('runner 没有写出回执')
  return {
    report: JSON.parse(raw) as LabelPlusJobReport,
    alerts,
    savedPaths,
    layers,
    openedPaths,
    actionsCalled
  }
}

// ---------------------------------------------------------------------------
// 清单构造
// ---------------------------------------------------------------------------

const ACTIONS = {
  enabled: true,
  setName: '三图层',
  timing: 'after-each-label' as const,
  onStart: '_start',
  onEnd: '_end',
  skipMissing: true
}

function makeManifest(
  labels: Array<{ group: string; text: string }>,
  overrides: Partial<LabelPlusManifest> = {}
): LabelPlusManifest {
  const textStyle = createDefaultTextStyle()
  textStyle.direction = 'vertical'
  // 夹具里关掉「标准垂直罗马对齐」：PS 这条路设不了它，开着会让**每一条**用例都多出
  // 一条警告，把各自真正要验的东西淹掉。专门验它的那条用例自己会打开。
  // （真实产物里这个字段默认是 true，所以真跑起来是会看到那条警告的 —— 那是预期的。）
  textStyle.standardVerticalRoman = false
  return {
    manifestVersion: LABELPLUS_MANIFEST_VERSION,
    jobId: 'lp-test-runner',
    generatedAt: '2026-09-23T20:00:00+08:00',
    generatedBy: 'test',
    job: {
      labelFilePath: '/tmp/labels.txt',
      sourceDirectory: '/tmp/images',
      outputDirectory: '/tmp/output',
      overwrite: true,
      closeAfterSave: true
    },
    document: {
      backgroundKind: 'source-image',
      backgroundTemplatePath: null,
      existingPsdPath: null,
      resolutionPpi: 300,
      colorMode: 'RGB',
      layerGroupMode: 'create',
      outputLabelNumber: false,
      labelNumberStyle: {
        font: { id: 'a', family: 'Arial', style: 'Regular', postScriptName: 'ArialMT' },
        fontSizePx: 12,
        fillColor: '#ff0000'
      }
    },
    save: { format: 'psd', asCopy: false },
    defaults: { positionUnit: 'normalized', textStyle },
    groups: {
      框外: { enabled: true, action: '', textStyle: {} },
      框内: { enabled: true, action: '', textStyle: {} }
    },
    actions: ACTIONS,
    report: { path: '/tmp/job/report.json', level: 'per-image' },
    images: [
      {
        labelImageName: '1.jpg',
        sourcePath: '/tmp/images/1.jpg',
        outputPath: '/tmp/output/1.psd',
        width: 800,
        height: 1137,
        labels: labels.map((label, index) => ({
          index: index + 1,
          group: label.group,
          text: label.text,
          position: { x: 0.5, y: 0.5 },
          styleOverride: {}
        }))
      }
    ],
    ...overrides
  }
}

const fiveOutside = [
  { group: '框外', text: '一' },
  { group: '框外', text: '二' },
  { group: '框外', text: '三' },
  { group: '框外', text: '四' },
  { group: '框外', text: '五' }
]

// ---------------------------------------------------------------------------

describe('runner（假 Photoshop 下真执行）', () => {
  it('清单本身先得是合法的，否则后面验的都是别的东西', () => {
    expect(validateLabelPlusManifest(makeManifest(fiveOutside)).issues).toEqual([])
  })

  /**
   * 这就是用户报的那处噪音：一张图 10 条文字 → 以前是 10 条一模一样的警告
   * + 10 条一模一样的 actions 记录，把真正的报错埋掉了。
   */
  it('动作不存在时，警告每组每张图只记一条，actions 聚合成一条', () => {
    const { report } = run(makeManifest(fiveOutside))

    const image = report.images[0]
    const missingWarnings = image.warnings.filter((warning) => warning.includes('不存在，已跳过'))
    expect(missingWarnings).toHaveLength(1)
    expect(missingWarnings[0]).toBe('分组「框外」：动作「框外」不存在，已跳过')

    // 五条文字 → 一条记录，count 记实际跑了几次。
    expect(image.actions).toEqual([{ group: '框外', action: '框外', ok: false, count: 5 }])
  })

  it('动作存在时不产生警告，并且标记为成功', () => {
    const { report, actionsCalled } = run(makeManifest(fiveOutside), { existingActions: ['三图层/框外'] })

    expect(report.images[0].warnings).toEqual([])
    expect(report.images[0].actions).toEqual([{ group: '框外', action: '框外', ok: true, count: 5 }])
    expect(actionsCalled.filter((name) => name === '三图层/框外')).toHaveLength(5)
  })

  it('两个分组各自一条记录，互不干扰', () => {
    const { report } = run(
      makeManifest([...fiveOutside, { group: '框内', text: '甲' }, { group: '框内', text: '乙' }]),
      { existingActions: ['三图层/框内'] }
    )

    expect(report.images[0].actions).toEqual([
      { group: '框外', action: '框外', ok: false, count: 5 },
      { group: '框内', action: '框内', ok: true, count: 2 }
    ])
    // 只有不存在的那一组留下警告。
    expect(report.images[0].warnings).toHaveLength(1)
  })

  it('一次失败不会被后面的成功盖掉（ok 单调向下）', () => {
    // 第 1 条文字失败、后面 4 条都成功 —— 聚合出来必须仍然是 false，
    // 否则"偶尔失败一次"会被静默吞掉，用户以为整组都跑好了。
    const { report } = run(makeManifest(fiveOutside), {
      existingActions: ['三图层/框外'],
      shouldFail: (_fullName, callIndex) => callIndex === 0
    })

    expect(report.images[0].actions).toEqual([{ group: '框外', action: '框外', ok: false, count: 5 }])
    // 失败原因（不是"不存在"）也要留在警告里。
    expect(report.images[0].warnings.join()).toContain('执行失败')
  })

  it('_start / _end 每张图各跑一次（不是每条文字一次）', () => {
    const { report, actionsCalled } = run(makeManifest(fiveOutside), {
      existingActions: ['三图层/_start', '三图层/_end']
    })

    expect(actionsCalled.filter((name) => name === '三图层/_start')).toHaveLength(1)
    expect(actionsCalled.filter((name) => name === '三图层/_end')).toHaveLength(1)
    // 它们不进 actions —— 那张表记的是"按分组跑的动作"。
    expect(report.images[0].actions.map((entry) => entry.action)).toEqual(['框外'])
  })

  it('竖排真的传到了文字层，横排分组不受影响', () => {
    const manifest = makeManifest([
      { group: '框外', text: '竖' },
      { group: '框内', text: '横' }
    ])
    manifest.groups['框内'].textStyle = { direction: 'horizontal' }

    const { layers } = run(manifest)

    const textLayers = layers.filter((layer) => layer.kind === 'text')
    expect(textLayers).toHaveLength(2)
    expect(textLayers[0].textItem.direction).toBe('vertical')
    expect(textLayers[1].textItem.direction).toBe('horizontal')
    expect(textLayers[0].textItem.contents).toBe('竖')
  })

  /**
   * 字号必须是**像素**。
   *
   * 2026-09-23 真机发现：这里原来写的是 `UnitValue(n, 'pt')`，PS 按文档自己的分辨率
   * 换算 —— 扫图通常 72ppi，于是 18pt → 18px；而本地预览按"300ppi"算成 75px。
   * **同一个数字两条路差 4 倍多。** 改成 px 之后与分辨率无关，两边像素级一致。
   */
  it('字号按像素写进 PS，与文档分辨率无关', () => {
    const manifest = makeManifest([{ group: '框外', text: '大字' }])
    manifest.defaults.textStyle.fontSizePx = 42

    const { layers } = run(manifest)

    const size = layers[0].textItem.size as { value: number; units: string }
    expect(size.units).toBe('px')
    expect(size.value).toBe(42)
  })

  /** 自由连字：PS 的 TextItem 确实有这个属性（查过官方 DOM 属性表），默认开。 */
  it('自由连字传进文字层，默认开、可关', () => {
    const manifest = makeManifest([{ group: '框外', text: '字' }])

    const on = run(manifest)
    expect(on.layers[0].textItem.ligatures).toBe(true)

    manifest.defaults.textStyle.ligatures = false
    const off = run(manifest)
    expect(off.layers[0].textItem.ligatures).toBe(false)
  })

  /**
   * 标准垂直罗马对齐方式（= 描述符里的 baselineDirection，1 开 / 2 关）。
   *
   * **PS 这条路设不了**：2026-09-23 实测，PS 的 ExtendScript DOM 没暴露这个属性 ——
   * `item.baselineDirection = 1` 不报错，但生成的 PSD 里仍是 2（空写）。
   * 所以 runner 的做法是**明确报警**，而不是留一句看着像生效的死代码。
   * 本地路（ag-psd）是真能写的，见 labelplus-psd.spec 里那条真读写测试。
   */
  it('竖排 + 要求罗马对齐时，明确警告 PS 这条路设不了（而不是静默产出反方向）', () => {
    const manifest = makeManifest([{ group: '框外', text: '竖' }])
    manifest.defaults.textStyle.direction = 'vertical'
    manifest.defaults.textStyle.standardVerticalRoman = true

    const warned = run(manifest)
    expect(warned.report.images[0].warnings.join()).toContain('标准垂直罗马对齐')
    // 不写这个属性，别留死代码。
    expect(warned.layers[0].textItem.baselineDirection).toBeUndefined()

    // 关掉它就不该有这条警告（用户本来就不要这个效果）。
    manifest.defaults.textStyle.standardVerticalRoman = false
    expect(run(manifest).report.images[0].warnings.join()).not.toContain('标准垂直罗马对齐')

    // 横排也不该有（这个选项只对竖排有意义）。
    manifest.defaults.textStyle.standardVerticalRoman = true
    manifest.defaults.textStyle.direction = 'horizontal'
    expect(run(manifest).report.images[0].warnings.join()).not.toContain('标准垂直罗马对齐')
  })

  it('跑完一张：存到 outputPath、状态是 generated、整批 ok', () => {
    const manifest = makeManifest(fiveOutside)
    const { report, savedPaths, openedPaths } = run(manifest)

    expect(openedPaths).toEqual(['/tmp/images/1.jpg'])
    expect(savedPaths).toEqual(['/tmp/output/1.psd'])
    expect(report.images[0].status).toBe('generated')
    expect(report.images[0].textLayerCount).toBe(5)
    expect(report.generated).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.ok).toBe(true)
    expect(report.finishedAt).not.toBeNull()
  })

  it('动作总开关关掉时，一条动作都不跑、也不产生警告', () => {
    const manifest = makeManifest(fiveOutside)
    manifest.actions = { ...ACTIONS, enabled: false }

    const { report, actionsCalled } = run(manifest)

    expect(actionsCalled).toEqual([])
    expect(report.images[0].actions).toEqual([])
    expect(report.images[0].warnings).toEqual([])
  })

  /**
   * `_start` / `_end` 是**可选钩子** —— 动作组里没有它们才是常态。
   * 用户的「三图层」就只有 `_end`、没有 `_start`，所以"不存在"绝不能报警告
   * （否则又是每张图两条纯噪音）。但**存在却跑失败**必须报出来。
   */
  it('_start / _end 不存在时安静跳过；存在却失败要报', () => {
    const quiet = run(makeManifest(fiveOutside), {
      existingActions: ['三图层/框外', '三图层/_end']
    })
    expect(quiet.actionsCalled).toContain('三图层/_start')
    expect(quiet.report.images[0].warnings).toEqual([])

    const loud = run(makeManifest(fiveOutside), {
      existingActions: ['三图层/框外', '三图层/_end'],
      shouldFail: (fullName) => fullName === '三图层/_end'
    })
    const warnings = loud.report.images[0].warnings.join()
    expect(warnings).toContain('收尾')
    expect(warnings).toContain('执行失败')
  })
})
