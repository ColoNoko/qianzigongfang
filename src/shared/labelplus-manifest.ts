/**
 * 指令清单（manifest）契约 —— 汉化工坊「编排」与 Photoshop「执行」之间唯一的数据接口。
 *
 * 为什么单独放一份契约：
 * - 工坊负责解析 LabelPlus 文本、匹配图源、算分组与样式（快、纯本地、可单测）；
 * - Photoshop 负责建真竖排文字层、跑动作、存 PSD（专业、可靠）；
 * - 两边不共享代码，只共享这份 JSON。契约放 shared，main 与 renderer 都不会各写一份。
 *
 * 设计原则：
 * 1. 清单只装「事实」，不装「算法」。坐标就是坐标，谁来排、怎么排是 PS 的事。
 * 2. 文字样式分三层：defaults（全场）→ groups（按分组）→ labels[].styleOverride（单条）。
 *    和 CSS 一个道理，一层压一层。**只在这一处**表达方向，别在别处再放一个 direction。
 * 3. 字段名尽量贴近 LabelPlus 官方 .jsx 的叫法，减少翻译成本（对照表见 docs/labelplus-import-api.md）。
 *
 * 版本规则：改字段语义就要升 LABELPLUS_MANIFEST_VERSION，
 * 并且 resources/qianzi-runner.jsx 必须同时认识新旧两个版本。
 */

import type {
  LabelPlusGenerateRequest,
  StandardFontRef,
  StandardTextStyle,
  TextAlignment,
  TextDirection
} from './labelplus-import'

export const LABELPLUS_MANIFEST_VERSION = 2 as const
export type LabelPlusManifestVersion = typeof LABELPLUS_MANIFEST_VERSION

/** 底图从哪来。`template-psd` 已在契约里留位，但 runner v1 尚未实现，校验会直接拦下。 */
export type LabelPlusBackgroundKind = 'source-image' | 'template-psd' | 'existing-psd'
export type LabelPlusSaveFormat = 'psd' | 'psb'
/** `after-each-label` 抄的是 LabelPlus 官方脚本：每建完一条文字就跑一次对应动作。 */
export type LabelPlusActionTiming = 'after-each-label' | 'after-image'
export type LabelPlusReportLevel = 'summary' | 'per-image'

/**
 * 单层样式覆盖。刻意不用 Partial<StandardTextStyle>：
 * Partial 会把 font / shadow 变成「要么整个给、要么整个不给」，
 * 这里要的是「我只想改字号，字体别动」。
 */
export interface LabelPlusTextStyleOverride {
  font?: StandardFontRef
  fontSizePx?: number
  direction?: TextDirection
  leadingPercent?: number
  alignment?: TextAlignment
  fillColor?: string
  strokeColor?: string
  strokeWidthPx?: number
  fauxBold?: boolean
  fauxItalic?: boolean
  ligatures?: boolean
  standardVerticalRoman?: boolean
  shadow?: StandardTextStyle['shadow']
}

export interface LabelPlusManifestJob {
  /** LabelPlus 原文本路径。动作/日志都写在它旁边，与官方脚本一致。 */
  labelFilePath: string
  sourceDirectory: string
  outputDirectory: string
  overwrite: boolean
  closeAfterSave: boolean
}

export interface LabelPlusManifestDocument {
  backgroundKind: LabelPlusBackgroundKind
  /** backgroundKind = 'template-psd' 时使用。 */
  backgroundTemplatePath: string | null
  /** backgroundKind = 'existing-psd' 时使用：往这一份已有 PSD 上叠文字层。 */
  existingPsdPath: string | null
  resolutionPpi: number
  colorMode: 'RGB' | 'CMYK' | 'Grayscale'
  /** `create` = 按分组建图层组；`flat` = 不建组（对应 LabelPlus 的 layerNotGroup）。 */
  layerGroupMode: 'create' | 'flat'
  outputLabelNumber: boolean
  labelNumberStyle: {
    font: StandardFontRef
    fontSizePx: number
    fillColor: string
  }
}

export interface LabelPlusManifestGroup {
  /** false = 这个分组整组不导入（对应工坊里的分组勾选）。 */
  enabled: boolean
  /**
   * 动作名。留空则回落到分组名本身 —— 这正是 LabelPlus 官方脚本的规矩
   * （`doAction(labelGroup, opts.runActionGroup)`），所以老动作集不用改就能用。
   */
  action: string
  textStyle: LabelPlusTextStyleOverride
}

export interface LabelPlusManifestActions {
  enabled: boolean
  /** 动作集名。LabelPlus 官方脚本的下拉框默认就选中 `LabelPlusAction`。 */
  setName: string
  timing: LabelPlusActionTiming
  /** 每张图打开时跑一次，跑不到就跳过（官方脚本同样用 try/catch 吞掉）。 */
  onStart: string
  /** 每张图存盘前跑一次。 */
  onEnd: string
  /** 动作在 PS 里不存在时：true = 安静跳过并记进回执；false = 记成失败。 */
  skipMissing: boolean
}

export interface LabelPlusManifestLabel {
  /** LabelPlus 里的第几条（1 起）。用于编号层与错误定位。 */
  index: number
  group: string
  text: string
  /** 0..1 的比例坐标，相对原图左上角 —— 与 LabelPlus 的 LabelheadValue 语义完全一致。 */
  position: { x: number; y: number }
  styleOverride: LabelPlusTextStyleOverride
}

export interface LabelPlusManifestImage {
  /** 标签里的图片名（LabelPlus 用它找文本记录）。 */
  labelImageName: string
  /** 实际打开的图源路径。 */
  sourcePath: string
  outputPath: string
  /**
   * 像素尺寸。**可选**，而且**只用来发现「配错图了」**。
   *
   * 真正的坐标换算一律用 runner 打开后的**实际文档尺寸** —— 相对比例乘错了尺寸，
   * 字就会跑到错误的位置，而且看不出错。这里留着只是为了让 runner 能做一次
   * 尺寸比对，从而发现"标签配了另一张图"这种事故。
   *
   * 之所以可选：拿它要读图片头（快），但 PSD 图源拿不到（Electron 解不了 PSD 的
   * 尺寸），而为了写一份清单去整图解码是不划算的 —— 清单生成本身应该是秒级的。
   */
  width?: number
  height?: number
  /** 空数组是合法的：这张图只出底图、不加字。 */
  labels: LabelPlusManifestLabel[]
}

export interface LabelPlusManifest {
  manifestVersion: LabelPlusManifestVersion
  /** 这一次任务的身份证。回执靠它和清单对上。 */
  jobId: string
  generatedAt: string
  generatedBy: string
  job: LabelPlusManifestJob
  document: LabelPlusManifestDocument
  save: {
    format: LabelPlusSaveFormat
    asCopy: boolean
  }
  defaults: {
    /** 坐标单位恒为 normalized，写死在这里以免下游误会成像素。 */
    positionUnit: 'normalized'
    textStyle: StandardTextStyle
  }
  /** 分组名 → 该分组的开关、动作名、样式覆盖。 */
  groups: Record<string, LabelPlusManifestGroup>
  actions: LabelPlusManifestActions
  /** 回执写到哪。PS 每处理完一张图刷一次，工坊据此显示进度。 */
  report: {
    path: string
    level: LabelPlusReportLevel
  }
  images: LabelPlusManifestImage[]
}

export function createDefaultManifestActions(): LabelPlusManifestActions {
  return {
    enabled: false,
    setName: 'LabelPlusAction',
    timing: 'after-each-label',
    onStart: '_start',
    onEnd: '_end',
    skipMissing: true
  }
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * 三层样式合并（defaults → 分组 → 单条覆盖）。
 *
 * ⚠️ **现状（2026-10-01 结构审计，别被旧注释骗了）**：这句话原来写的是"这是全项目唯一一处该逻辑"，
 * 但实测**生产代码一处都没调它**：
 *   · 本地预览（`labelplus-import-service.ts` 的 `selectedLabels`）直接用 `options.textStyle`，**只有 defaults**；
 *   · 真正在合并的是 `resources/qianzi-runner.jsx` 里那份 ExtendScript —— **那边没有任何测试**。
 * 保留本函数 + 它的用例的理由：**它是这条规则唯一被测试锁住的实现**（可执行的规格）。
 * 删掉它等于连规格一起删，而线上那份仍然没人管 —— 所以**先留着，别删**。
 * 真正该做的是把预览接上它（现值：预览会忽略分组样式与单条覆盖 → 与 PS 出的图不一致），属第三批。
 */
export function resolveManifestTextStyle(
  defaults: StandardTextStyle,
  group?: LabelPlusTextStyleOverride | null,
  label?: LabelPlusTextStyleOverride | null
): StandardTextStyle {
  const groupStyle = group ?? {}
  const labelStyle = label ?? {}
  return {
    font: { ...(labelStyle.font ?? groupStyle.font ?? defaults.font) },
    fontSizePx: firstDefined(labelStyle.fontSizePx, groupStyle.fontSizePx, defaults.fontSizePx) as number,
    direction: firstDefined(labelStyle.direction, groupStyle.direction, defaults.direction) as TextDirection,
    leadingPercent: firstDefined(
      labelStyle.leadingPercent,
      groupStyle.leadingPercent,
      defaults.leadingPercent
    ) as number,
    alignment: firstDefined(labelStyle.alignment, groupStyle.alignment, defaults.alignment) as TextAlignment,
    fillColor: firstDefined(labelStyle.fillColor, groupStyle.fillColor, defaults.fillColor) as string,
    strokeColor: firstDefined(labelStyle.strokeColor, groupStyle.strokeColor, defaults.strokeColor) as string,
    strokeWidthPx: firstDefined(
      labelStyle.strokeWidthPx,
      groupStyle.strokeWidthPx,
      defaults.strokeWidthPx
    ) as number,
    fauxBold: firstDefined(labelStyle.fauxBold, groupStyle.fauxBold, defaults.fauxBold) as boolean,
    fauxItalic: firstDefined(labelStyle.fauxItalic, groupStyle.fauxItalic, defaults.fauxItalic) as boolean,
    ligatures: firstDefined(labelStyle.ligatures, groupStyle.ligatures, defaults.ligatures) as boolean,
    standardVerticalRoman: firstDefined(
      labelStyle.standardVerticalRoman,
      groupStyle.standardVerticalRoman,
      defaults.standardVerticalRoman
    ) as boolean,
    shadow: { ...(labelStyle.shadow ?? groupStyle.shadow ?? defaults.shadow) }
  }
}

/**
 * 决定某条文字该跑哪个动作。返回空串表示「不跑」。
 *
 * 只有两个理由不跑：动作总开关关掉、或这个分组被显式禁用。
 * 其余一律回落到分组名本身 —— 这正是 LabelPlus 官方脚本的规矩
 * （`doAction(labelGroup, opts.runActionGroup)`），所以用户现有的
 * LabelPlusAction 动作集（框外/框内/标题…）不改一个字就能用。
 *
 * ⚠️ 这条规则在 resources/qianzi-runner.jsx 的 qianziActionName() 里有一份
 * 同样的实现（那边是 ES3，没法 import）。改这里必须同时改那边。
 *
 * ⚠️ 现状（2026-10-01 结构审计）：生产侧**只有 ExtendScript 那份在用**，本函数只被测试调用。
 * 保留理由同 `resolveManifestTextStyle` —— 它是唯一被测试锁住的版本，删它等于把规格一起删。
 */
export function resolveManifestActionName(
  groups: Record<string, LabelPlusManifestGroup>,
  groupName: string,
  actionsEnabled: boolean
): string {
  if (!actionsEnabled) return ''
  const group = groups[groupName]
  if (group && group.enabled === false) return ''
  const explicit = String(group?.action ?? '').trim()
  return explicit || groupName
}

/** 分组是否要导入。清单里没登记的分组按「导入、不跑动作」处理，避免静默丢字。
 *
 * ⚠️ 与上面两个一样：**生产侧当前只由 ExtendScript 那份在用**，这里是唯一被测试锁住的版本，
 * 保留理由见 `resolveManifestTextStyle` 的注释（2026-10-01 结构审计）。 */
export function isManifestGroupEnabled(
  groups: Record<string, LabelPlusManifestGroup>,
  groupName: string
): boolean {
  const group = groups[groupName]
  return !group || group.enabled !== false
}

export interface LabelPlusManifestValidationIssue {
  /** 出问题的字段路径，例如 `images[2].labels[0].position.x`。 */
  path: string
  message: string
}

export interface LabelPlusManifestValidationResult {
  ok: boolean
  issues: LabelPlusManifestValidationIssue[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 写盘前的自检。**必须在工坊侧跑**：清单一旦交给 PS，那边的报错信息基本没法读，
 * 与其让用户在 Photoshop 里对着一个语焉不详的脚本错误发呆，不如这里先拦住。
 */
export function validateLabelPlusManifest(value: unknown): LabelPlusManifestValidationResult {
  const issues: LabelPlusManifestValidationIssue[] = []
  const add = (path: string, message: string): void => {
    issues.push({ path, message })
  }

  if (!isPlainObject(value)) {
    return { ok: false, issues: [{ path: '', message: '清单根节点必须是一个对象' }] }
  }

  if (value.manifestVersion !== LABELPLUS_MANIFEST_VERSION) {
    add(
      'manifestVersion',
      `清单版本不兼容：期望 ${LABELPLUS_MANIFEST_VERSION}，实际 ${String(value.manifestVersion)}`
    )
  }
  if (!isNonEmptyString(value.jobId)) add('jobId', '缺少任务编号')

  const job = value.job
  if (!isPlainObject(job)) {
    add('job', '缺少 job 区块')
  } else {
    for (const key of ['labelFilePath', 'sourceDirectory', 'outputDirectory'] as const) {
      if (!isNonEmptyString(job[key])) add(`job.${key}`, '路径不能为空')
    }
  }

  const document = value.document
  if (!isPlainObject(document)) {
    add('document', '缺少 document 区块')
  } else {
    const backgroundKind = document.backgroundKind
    if (backgroundKind === 'template-psd') {
      // 契约里留了位，但 runner v1 没实现。宁可现在拦下，也不要让用户以为模板生效了。
      add('document.backgroundKind', '「模板 PSD」模式尚未实现，请改用「图源原图」或「已有 PSD」')
    } else if (backgroundKind !== 'source-image' && backgroundKind !== 'existing-psd') {
      add('document.backgroundKind', `未知的底图来源：${String(backgroundKind)}`)
    }
    if (backgroundKind === 'existing-psd' && !isNonEmptyString(document.existingPsdPath)) {
      add('document.existingPsdPath', '选「已有 PSD」时必须给出 PSD 路径')
    }
    if (typeof document.resolutionPpi !== 'number' || !Number.isFinite(document.resolutionPpi)) {
      add('document.resolutionPpi', '分辨率必须是数字')
    }
  }

  const defaults = value.defaults
  if (!isPlainObject(defaults)) {
    add('defaults', '缺少 defaults 区块')
  } else {
    if (defaults.positionUnit !== 'normalized') {
      add('defaults.positionUnit', '坐标单位必须为 normalized')
    }
    const style = defaults.textStyle
    if (!isPlainObject(style)) add('defaults.textStyle', '缺少默认文字样式')
    else if (style.direction !== 'horizontal' && style.direction !== 'vertical') {
      add('defaults.textStyle.direction', '文字方向只能是 horizontal 或 vertical')
    }
  }

  const actions = value.actions
  if (!isPlainObject(actions)) {
    add('actions', '缺少 actions 区块')
  } else if (actions.enabled === true && !isNonEmptyString(actions.setName)) {
    add('actions.setName', '启用动作时必须给出动作集名')
  }

  const groups = value.groups
  const groupMap = isPlainObject(groups) ? groups : {}
  if (!isPlainObject(groups)) {
    add('groups', '缺少 groups 区块')
  } else {
    // 逐组校验**不看**动作总开关：动作名写歪了、方向拼错了，都是清单本身的问题，
    // 不该因为"这一趟没打算跑动作"就放过。
    for (const [name, group] of Object.entries(groupMap)) {
      if (!isPlainObject(group)) {
        add(`groups.${name}`, '分组配置必须是对象')
        continue
      }
      if (group.enabled === false) continue
      if (group.action !== undefined && typeof group.action !== 'string') {
        add(`groups.${name}.action`, '动作名必须是字符串')
      }
      // 分组级方向覆盖写错了，整组文字会悄悄用错方向 —— 这种"看不出错"的必须拦。
      const override = group.textStyle
      if (isPlainObject(override) && override.direction !== undefined) {
        if (override.direction !== 'horizontal' && override.direction !== 'vertical') {
          add(`groups.${name}.textStyle.direction`, '文字方向只能是 horizontal 或 vertical')
        }
      }
    }
  }

  const images = value.images
  if (!Array.isArray(images)) {
    add('images', 'images 必须是数组')
  } else if (images.length === 0) {
    add('images', '清单里一张图都没有')
  } else {
    images.forEach((image, imageIndex) => {
      const at = `images[${imageIndex}]`
      if (!isPlainObject(image)) {
        add(at, '图片条目必须是对象')
        return
      }
      if (!isNonEmptyString(image.labelImageName)) add(`${at}.labelImageName`, '缺少标签图片名')
      if (!isNonEmptyString(image.sourcePath)) add(`${at}.sourcePath`, '缺少图源路径')
      if (!isNonEmptyString(image.outputPath)) add(`${at}.outputPath`, '缺少输出路径')
      for (const key of ['width', 'height'] as const) {
        const dimension = image[key]
        // 尺寸是可选的（PSD 图源拿不到、也没必要为此整图解码）。
        // 一旦给了就必须是正数 —— 给个 0 或负数说明上游算错了。
        if (dimension === undefined || dimension === null) continue
        if (typeof dimension !== 'number' || !Number.isFinite(dimension) || dimension <= 0) {
          add(`${at}.${key}`, '尺寸如果给了，就必须是大于 0 的数字')
        }
      }
      const labels = image.labels
      if (!Array.isArray(labels)) {
        add(`${at}.labels`, 'labels 必须是数组（可以是空数组）')
        return
      }
      labels.forEach((label, labelIndex) => {
        const labelAt = `${at}.labels[${labelIndex}]`
        if (!isPlainObject(label)) {
          add(labelAt, '文字条目必须是对象')
          return
        }
        if (!isNonEmptyString(label.text)) add(`${labelAt}.text`, '文字内容不能为空')
        if (!isNonEmptyString(label.group)) add(`${labelAt}.group`, '缺少分组名')
        const position = label.position
        if (!isPlainObject(position)) {
          add(`${labelAt}.position`, '缺少坐标')
          return
        }
        for (const axis of ['x', 'y'] as const) {
          const coordinate = position[axis]
          if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) {
            add(`${labelAt}.position.${axis}`, '坐标必须是数字')
          } else if (coordinate < -10 || coordinate > 10) {
            add(`${labelAt}.position.${axis}`, '坐标超出合理范围（0..1 之外请确认是不是写成了像素）')
          }
        }
      })
    })
  }

  return { ok: issues.length === 0, issues }
}

// ====================================================================
// 工坊 → PS 的任务请求与结果（跨 IPC，所以放契约里）
// ====================================================================

/**
 * 与本地出图**同一个**请求结构 —— 这一点是刻意的：两条路吃同一份输入，
 * 才可能在界面上做成"同一个设置、两种出图方式"，而不是两套要各自维护的表单。
 */
export interface LabelPlusManifestJobRequest extends LabelPlusGenerateRequest {
  /** 动作集名（PS 动作面板里那一层文件夹）。留空 = 不跑动作。 */
  actionSetName?: string
  /** 分组名 → 动作名。没写到的分组回落到分组名本身（LabelPlus 官方脚本的规矩）。 */
  groupActions?: Record<string, string>
  /**
   * 分组名 → 文字方向。没写到的分组跟随 `defaults.textStyle.direction`。
   *
   * 这一条是"框外竖排、框内横排"能同时存在的原因 —— 而它正是本地 ag-psd
   * 那条路做不到的：那边全场只能有一个方向，而且写进 PSD 的文字层永远是横排。
   */
  groupDirections?: Record<string, TextDirection>
}

export interface LabelPlusManifestJobResult {
  ok: boolean
  message: string
  jobId: string | null
  manifestPath: string | null
  launcherPath: string | null
  reportPath: string | null
  runnerPath: string | null
  imageCount: number
  labelCount: number
  /** 被跳过的图（没匹配上图源、或用户没勾）。 */
  skippedImages: string[]
  /** 清单自检不通过的原因。非空即 ok=false。 */
  issues: string[]
  /**
   * 这一批**有东西没被处理**的提醒（不阻断运行）。
   *
   * 存在的理由：涂白（dialog-overlay）在 Photoshop 这条路上还没实现，
   * 而它以前是**静默丢掉**的 —— 用户开着涂白跑完，以为做了，其实什么都没发生。
   */
  warnings: string[]
}

export interface LabelPlusPhotoshopRunResult extends LabelPlusManifestJobResult {
  /** Photoshop 是否真的被拉起来了（清单写成功但这一步可能失败）。 */
  launched: boolean
  /** 启动失败的原因。 */
  launchMessage: string
}

// ====================================================================
// 回执（runner → 工坊）
// ====================================================================

/**
 * runner 每处理完一张图就把整份回执重写一次，所以工坊轮询这个文件就能拿到进度，
 * 不需要额外的进度事件通道 —— 少一条跨进程链路，就少一处会漂移的契约。
 */
export type LabelPlusJobImageStatus = 'generated' | 'skipped' | 'failed'

export interface LabelPlusJobActionOutcome {
  group: string
  action: string
  /** 只要有一次失败就是 false —— 一次失败不能被后面的成功盖掉。 */
  ok: boolean
  /**
   * 这个动作在这张图上实际跑了几次（= 该分组有几条文字）。
   *
   * 按「分组 + 动作」**聚合**成一条，而不是每条文字一条记录：
   * 一张图十几条文字会让回执躺着十几条一模一样的记录，真正的报错反而看不见。
   */
  count: number
}

export interface LabelPlusJobReportImage {
  labelImageName: string
  status: LabelPlusJobImageStatus
  outputPath: string | null
  textLayerCount: number
  message: string
  warnings: string[]
  actions: LabelPlusJobActionOutcome[]
}

export interface LabelPlusJobReport {
  manifestVersion: number
  jobId: string
  /** runner 自己的版本，用来判断"工坊升级了但用户的 runner 还是旧的"。 */
  runnerVersion: string
  startedAt: string
  /** null 表示还没跑完 —— 工坊据此显示"进行中"。 */
  finishedAt: string | null
  /** 只有整批跑完且一张都没失败才是 true。 */
  ok: boolean
  generated: number
  failed: number
  skipped: number
  images: LabelPlusJobReportImage[]
  warnings: string[]
}
