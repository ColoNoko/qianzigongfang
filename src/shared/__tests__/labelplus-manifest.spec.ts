import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDefaultTextStyle } from '../labelplus-import'
import {
  LABELPLUS_MANIFEST_VERSION,
  createDefaultManifestActions,
  isManifestGroupEnabled,
  resolveManifestActionName,
  resolveManifestTextStyle,
  validateLabelPlusManifest,
  type LabelPlusManifest
} from '../labelplus-manifest'

function baseManifest(): LabelPlusManifest {
  return {
    manifestVersion: LABELPLUS_MANIFEST_VERSION,
    jobId: 'lp-test-0001',
    generatedAt: '2026-09-23T15:04:05+08:00',
    generatedBy: '汉化工坊 test',
    job: {
      labelFilePath: 'E:/work/labels.txt',
      sourceDirectory: 'E:/work/images',
      outputDirectory: 'E:/work/output',
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
        font: { id: 'builtin-arial', family: 'Arial', style: 'Regular', postScriptName: 'ArialMT' },
        fontSizePx: 12,
        fillColor: '#ff0000'
      }
    },
    save: { format: 'psd', asCopy: false },
    defaults: {
      positionUnit: 'normalized',
      textStyle: createDefaultTextStyle()
    },
    groups: {
      框外: { enabled: true, action: '', textStyle: {} },
      框内: { enabled: true, action: '框内竖', textStyle: {} }
    },
    actions: createDefaultManifestActions(),
    report: { path: 'E:/work/output/.qianzi-report-lp-test-0001.json', level: 'per-image' },
    images: [
      {
        labelImageName: 'page-001.png',
        sourcePath: 'E:/work/images/page-001.jpg',
        outputPath: 'E:/work/output/page-001.psd',
        width: 2480,
        height: 3508,
        labels: [
          {
            index: 1,
            group: '框外',
            text: '……そろそろ帰らないと',
            position: { x: 0.812, y: 0.104 },
            styleOverride: {}
          }
        ]
      }
    ]
  }
}

describe('LabelPlus manifest · 三层样式合并', () => {
  it('单条覆盖 > 分组覆盖 > 全场默认', () => {
    const defaults = createDefaultTextStyle()
    defaults.fontSizePx = 24
    defaults.direction = 'horizontal'

    const merged = resolveManifestTextStyle(
      defaults,
      { fontSizePx: 30, direction: 'vertical' },
      { fontSizePx: 18 }
    )

    expect(merged.fontSizePx).toBe(18)
    expect(merged.direction).toBe('vertical')
  })

  it('没写到的字段一律回落到上一层，不会被 undefined 抹掉', () => {
    const defaults = createDefaultTextStyle()
    defaults.leadingPercent = 130
    defaults.fauxBold = true

    const merged = resolveManifestTextStyle(defaults, { fontSizePx: 40 }, {})

    expect(merged.leadingPercent).toBe(130)
    expect(merged.fauxBold).toBe(true)
    expect(merged.shadow).toEqual(defaults.shadow)
  })

  it('自由连字也走三层合并，而且默认是开', () => {
    const defaults = createDefaultTextStyle()
    expect(defaults.ligatures).toBe(true)

    // false 必须能压过 true —— firstDefined 只跳过 undefined，不跳过 false。
    expect(resolveManifestTextStyle(defaults, { ligatures: false }, {}).ligatures).toBe(false)
    expect(resolveManifestTextStyle(defaults, {}, { ligatures: false }).ligatures).toBe(false)
  })

  it('标准垂直罗马对齐也走三层合并，默认开、false 能压过 true', () => {
    const defaults = createDefaultTextStyle()
    expect(defaults.standardVerticalRoman).toBe(true)

    expect(
      resolveManifestTextStyle(defaults, { standardVerticalRoman: false }, {}).standardVerticalRoman
    ).toBe(false)
    expect(
      resolveManifestTextStyle(defaults, {}, { standardVerticalRoman: false }).standardVerticalRoman
    ).toBe(false)
  })

  it('合并结果是副本，改它不会污染上一层', () => {
    const defaults = createDefaultTextStyle()
    const merged = resolveManifestTextStyle(defaults, null, null)

    merged.font.family = '被改坏了'
    merged.shadow.blurPx = 99

    expect(defaults.font.family).not.toBe('被改坏了')
    expect(defaults.shadow.blurPx).not.toBe(99)
  })
})

describe('LabelPlus manifest · 分组与动作', () => {
  const groups = {
    框外: { enabled: true, action: '', textStyle: {} },
    框内: { enabled: true, action: '框内竖', textStyle: {} },
    废弃: { enabled: false, action: '废弃', textStyle: {} }
  }

  it('动作名留空时回落到分组名（与 LabelPlus 官方脚本一致）', () => {
    expect(resolveManifestActionName(groups, '框外', true)).toBe('框外')
  })

  it('显式写了动作名就用显式的（分组名可以映射到别的动作）', () => {
    expect(resolveManifestActionName(groups, '框内', true)).toBe('框内竖')
  })

  it('动作总开关关掉、分组被禁用、分组没登记 —— 三种情况都不跑动作', () => {
    expect(resolveManifestActionName(groups, '框外', false)).toBe('')
    expect(resolveManifestActionName(groups, '废弃', true)).toBe('')
    // 清单里没登记的分组按「导入、不跑动作」处理，绝不静默丢字
    expect(resolveManifestActionName(groups, '没登记的分组', true)).toBe('没登记的分组')
    expect(isManifestGroupEnabled(groups, '没登记的分组')).toBe(true)
    expect(isManifestGroupEnabled(groups, '废弃')).toBe(false)
  })
})

describe('LabelPlus manifest · 写盘前自检', () => {
  it('一份完整清单应当通过', () => {
    const result = validateLabelPlusManifest(baseManifest())
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('坐标写成像素（忘了归一化）要能抓出来', () => {
    const manifest = baseManifest()
    manifest.images[0].labels[0].position = { x: 2013.8, y: 364.8 }

    const result = validateLabelPlusManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain('images[0].labels[0].position.x')
    expect(result.issues[0].message).toContain('像素')
  })

  it('空文字的条目要抓出来（PS 里会建出一个空文字层）', () => {
    const manifest = baseManifest()
    manifest.images[0].labels[0].text = '   '

    const result = validateLabelPlusManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain('images[0].labels[0].text')
  })

  it('没有标签的图片是合法的，不算错', () => {
    const manifest = baseManifest()
    manifest.images[0].labels = []

    expect(validateLabelPlusManifest(manifest).ok).toBe(true)
  })

  it('模板 PSD 模式尚未实现，必须在工坊侧就拦下', () => {
    const manifest = baseManifest()
    manifest.document.backgroundKind = 'template-psd'
    manifest.document.backgroundTemplatePath = 'E:/work/template.psd'

    const result = validateLabelPlusManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain('document.backgroundKind')
  })

  it('版本号对不上要拒绝（runner 与工坊必须同代）', () => {
    const manifest = { ...baseManifest(), manifestVersion: 999 }

    const result = validateLabelPlusManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain('manifestVersion')
  })

  it('启用动作却没给动作集名要拒绝', () => {
    const manifest = baseManifest()
    manifest.actions.enabled = true
    manifest.actions.setName = '  '

    const result = validateLabelPlusManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain('actions.setName')
  })

  it('非对象输入不会抛异常，而是返回一条可读的问题', () => {
    const result = validateLabelPlusManifest('这不是清单')

    expect(result.ok).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].message).toContain('对象')
  })

  it('分组级方向是合法的覆盖', () => {
    const manifest = baseManifest()
    manifest.groups['框外'] = { enabled: true, action: '', textStyle: { direction: 'vertical' } }

    expect(validateLabelPlusManifest(manifest).ok).toBe(true)
  })

  it('分组方向拼错了要拒绝 —— 写错一个字整组方向就悄悄不对，看不出错', () => {
    const manifest = baseManifest()
    manifest.groups['框外'] = {
      enabled: true,
      action: '',
      textStyle: { direction: '斜排' as never }
    }

    const result = validateLabelPlusManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain(
      'groups.框外.textStyle.direction'
    )
  })

  it('动作总开关关着时，分组里的动作名写歪了照样要拦', () => {
    const manifest = baseManifest()
    manifest.actions.enabled = false
    manifest.groups['框内'] = { enabled: true, action: 123 as never, textStyle: {} }

    const result = validateLabelPlusManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain('groups.框内.action')
  })
})

/**
 * runner 是 ExtendScript（ES3），没法 import 这份契约，所以它跟这里的一致性
 * 只能靠「读源码断言」来锁 —— 和 boot-theme-args.spec.ts 锁 main↔preload 契约同一个思路。
 * 这类断言只在「忘了同步」时才红，是这片代码里唯一能防住跨语言漂移的手段。
 */
describe('LabelPlus manifest · 与 runner 的跨语言契约', () => {
  const runnerPath = resolve(__dirname, '../../../resources/qianzi-runner.jsx')
  const runnerSource = readFileSync(runnerPath, 'utf8')
  // 注释里提到这些语法是允许的，所以先把注释剥掉再查。
  const runnerCode = runnerSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

  it('runner 认的清单版本必须与契约一致（升版本时不能忘了改 runner）', () => {
    expect(runnerSource).toContain(`manifest.manifestVersion !== ${LABELPLUS_MANIFEST_VERSION}`)
  })

  it('runner 里不能出现现代表 JS 语法 —— ExtendScript 只认 ES3', () => {
    const forbidden = [
      { pattern: /\bconst\s/, hint: 'const' },
      { pattern: /\blet\s/, hint: 'let' },
      { pattern: /=>/, hint: '箭头函数' },
      { pattern: /`/, hint: '模板字符串' },
      { pattern: /\bArray\.isArray\b/, hint: 'Array.isArray（ES5）' },
      { pattern: /\.forEach\(/, hint: 'forEach（ES5）' }
    ]
    const hits = forbidden.filter((entry) => entry.pattern.test(runnerCode)).map((entry) => entry.hint)

    expect(hits, `runner 里出现了 ES3 不支持的语法：${hits.join('、')}`).toEqual([])
  })

  /**
   * 2026-09-23 真踩过：`if (x) continue`（无分号）在 Node 里解析得好好的，
   * 在 PS 里报「错误 25: 应为: ;」—— ExtendScript 不会给 continue/break 这两个
   * 受限语句自动补分号，它会把下一行的语句接到上一行去。
   * `new Function()` 用的 Node 解析器有正常 ASI，所以上一条测试抓不到这一类。
   */
  it('runner 里 continue / break 必须带分号 —— ExtendScript 不会自动补', () => {
    const bare = runnerCode.match(/\b(?:continue|break)\b(?!\s*;)/g) ?? []

    expect(bare, 'continue / break 后面必须显式写分号（建议连大括号一起写：`{ continue; }`）').toEqual([])
  })

  /**
   * 同一类病的另一半（2026-09-23 第二次踩）：
   *
   *   $.qianziRunnerVersion = '1.0.0'      ← 没写分号
   *   (function () { ... })()              ← 行首是 (
   *
   * 被读成 `'1.0.0'(function(){...})()` —— 把字符串当函数调用，
   * PS 报「错误 24: "1.0.0" 不是函数」。注意这个错**是运行期**报的：
   * 代码语法完全合法，所以解析器一声不吭，跑起来才炸。
   *
   * 只要一行以 ( [ ` + - / * 开头，就有被粘到上一行的风险 —— 直接禁掉最省事。
   */
  it('runner 里不能有以 ( [ ` + - / * 开头的代码行 —— ExtendScript 的 ASI 会把它粘到上一行', () => {
    const continuationStarters = ['(', '[', '`', '+', '-', '/', '*']
    const offenders = runnerCode
      .split('\n')
      .map((line, index) => ({ text: line.replace(/^\s+/, ''), lineNumber: index + 1 }))
      .filter((entry) => entry.text && continuationStarters.indexOf(entry.text.charAt(0)) >= 0)
      .map((entry) => `第 ${entry.lineNumber} 行：${entry.text.slice(0, 60)}`)

    expect(offenders, `这些行会被 ASI 粘到上一行，必须改写：\n${offenders.join('\n')}`).toEqual([])
  })

  it('runner 必须能通过 JS 语法解析（PS 的报错信息基本没法读，别让它有机会报）', () => {
    expect(() => new Function(runnerSource)).not.toThrow()
  })

  it('docs/samples 里那份手写清单必须仍然合法（改契约时别把样例落下）', () => {
    const samplePath = resolve(__dirname, '../../../docs/samples/labelplus-manifest.sample.json')
    const parsed = JSON.parse(readFileSync(samplePath, 'utf8'))

    expect(validateLabelPlusManifest(parsed).issues).toEqual([])
  })
})
