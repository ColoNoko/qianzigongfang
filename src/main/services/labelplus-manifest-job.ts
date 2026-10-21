/**
 * 「工坊 → Photoshop」的编排层。
 *
 * 分工（这是整个设计的地基）：
 *   工坊 = 编排：解析 LabelPlus 文本、匹配图源、算分组与样式 → 写成一份**指令清单**（JSON）
 *   PS   = 执行：真竖排文字层、按分组跑动作、存 PSD → 写回一份**回执**（JSON）
 *
 * 这个文件只干四件事，一件业务判断都不多做：
 *   1. 把请求整理成一份通过校验的清单，写到 `<EXE 同级>/temp/labelplus-jobs/<jobId>/`
 *   2. 写一个三行的引子 .jsx（指向 runner 和清单）
 *   3. 启动 Photoshop 跑那个引子
 *   4. 读回执
 *
 * 为什么清单和引子都落在 temp 而不是输出目录：输出目录会被扫描器扫，往里丢 json/jsx
 * 只会给"这个章节有几个 PSD"这类判断添乱。
 *
 * 为什么"写清单"和"启动 PS"分成两个入口：用户可能只想导出清单，自己在 PS 里手动跑
 * （runner 支持不带参数时弹窗挑清单）。这也是排查问题时唯一能把两边分开的手段。
 */

import { app, nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, extname, join, resolve } from 'node:path'
import {
  LABELPLUS_IMPORT_API_VERSION,
  applyTextReplacementRules,
  parseTextReplacementExpression
} from '@shared/labelplus-import'
import {
  LABELPLUS_MANIFEST_VERSION,
  createDefaultManifestActions,
  validateLabelPlusManifest,
  type LabelPlusJobReport,
  type LabelPlusManifest,
  type LabelPlusManifestGroup,
  type LabelPlusManifestImage,
  type LabelPlusManifestJobRequest,
  type LabelPlusManifestJobResult,
  type LabelPlusManifestLabel
} from '@shared/labelplus-manifest'
import { writeLog } from './logger'
import { listLabelPlusSourceFiles, matchLabelPlusImages } from './labelplus-matcher'
import { readLabelPlusFile } from './labelplus-parser'
import { normalizedOptions, safeOutputName } from './labelplus-import-service'

export type { LabelPlusManifestJobRequest, LabelPlusManifestJobResult }

/** EXE 同级的 temp/labelplus-jobs —— 与预览 PSD 的 temp/preview 同一套约定（§9.1）。 */
export function labelPlusJobRoot(): string {
  const executableDirectory = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
  return join(executableDirectory, 'temp', 'labelplus-jobs')
}

/**
 * 找 runner 本体的**真实磁盘路径**。
 *
 * ⚠️ 两处坑，都踩过或差点踩到：
 *   1. `resources/**` 在 electron-builder 里是 `asarUnpack`，所以它在
 *      `app.asar.unpacked/` 下 —— 那是真实路径，PS 读得到。
 *   2. 而 `app.getAppPath()` 在打包后指向 `.../app.asar`，往里拼出来的路径
 *      Electron 的 fs **能读**（它会把 asar 当目录），但 **Photoshop 读不了**。
 *      所以必须显式排掉路径里带 `.asar/` 的那些候选，否则会"找到"一个 PS 打不开的文件。
 */
export function resolveRunnerScriptPath(): string {
  const candidates: string[] = []
  // `process.resourcesPath` 只有 Electron 里有；纯 node（比如单测）里是 undefined，
  // 直接 join 会抛 TypeError。
  const resourcesPath = process.resourcesPath ?? ''
  if (resourcesPath) {
    candidates.push(join(resourcesPath, 'app.asar.unpacked', 'resources', 'qianzi-runner.jsx'))
    candidates.push(join(resourcesPath, 'resources', 'qianzi-runner.jsx'))
  }
  candidates.push(join(app.getAppPath(), 'resources', 'qianzi-runner.jsx'))

  for (const candidate of candidates) {
    if (/\.asar[\\/]/u.test(candidate)) continue
    if (existsSync(candidate)) return candidate
  }
  return ''
}

/** ExtendScript 里用正斜杠最稳；反斜杠在字符串里是转义符。 */
function toExtendScriptPath(value: string): string {
  return resolve(value).replace(/\\/gu, '/').replace(/'/gu, "\\'")
}

/**
 * 生成引子脚本。
 *
 * 刻意只有三行：真正的逻辑在 runner 里（一份、可单独打磨），数据在清单里（纯数据、
 * 不可能有语法错）。这样工坊每次只换数据，不换逻辑 —— 也就是"每次只换菜谱"。
 *
 * ⚠️ 每行都必须以分号结尾：ExtendScript 的 ASI 不可靠，少一个分号会把下一行粘上来。
 */
export function buildLauncherScript(manifestPath: string, runnerPath: string): string {
  return [
    '// 汉化工坊自动生成的引子脚本 —— 每次任务都会被覆盖，不要手改。',
    '// 逻辑在 qianzi-runner.jsx，数据在清单 JSON 里。',
    `$.qianziManifestPath = '${toExtendScriptPath(manifestPath)}';`,
    `$.qianziRunnerScriptPath = '${toExtendScriptPath(runnerPath)}';`,
    '$.evalFile(new File($.qianziRunnerScriptPath));',
    ''
  ].join('\n')
}

/**
 * 只读图片头拿尺寸 —— 不解码整张图。
 *
 * PSD 直接放弃：Electron 解不了 PSD 的尺寸，而为了写一份清单去整图解码是不划算的
 * （清单生成必须是秒级的）。清单里的尺寸只用来让 runner 发现"配错图了"，是锦上添花。
 */
function probeSourceSize(filePath: string): { width: number; height: number } | undefined {
  if (extname(filePath).toLocaleLowerCase() === '.psd') return undefined
  try {
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) return undefined
    const size = image.getSize()
    return size.width > 0 && size.height > 0 ? size : undefined
  } catch {
    return undefined
  }
}

function shortJobId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/gu, '').slice(0, 14)
  return `lp-${stamp}-${randomUUID().slice(0, 6)}`
}

/**
 * 把请求整理成清单。**不发散任何判断**：分组勾选、文本替换、样式归一化全部复用
 * 本地出图那条路用的同一批函数（`normalizedOptions` / `applyTextReplacementRules`），
 * 所以两条路不会给出不一样的字体大小或方向。
 */
export async function buildLabelPlusJob(
  request: LabelPlusManifestJobRequest
): Promise<LabelPlusManifestJobResult> {
  const result: LabelPlusManifestJobResult = {
    ok: false,
    message: '',
    jobId: null,
    manifestPath: null,
    launcherPath: null,
    reportPath: null,
    runnerPath: null,
    imageCount: 0,
    labelCount: 0,
    warnings: [],
    skippedImages: [],
    issues: []
  }

  if (request.apiVersion !== LABELPLUS_IMPORT_API_VERSION) {
    result.message = `导入 API 版本不兼容：${request.apiVersion}`
    return result
  }

  const runnerPath = resolveRunnerScriptPath()
  if (!runnerPath) {
    result.message =
      '找不到 qianzi-runner.jsx。它应该随程序一起分发 —— 如果这是打包版，说明 resources 没有被正确解包。'
    return result
  }
  result.runnerPath = runnerPath

  const document = await readLabelPlusFile(resolve(request.labelFilePath))
  const sourceFiles = await listLabelPlusSourceFiles(resolve(request.sourceDirectory))
  const preview = matchLabelPlusImages(document, sourceFiles, request.match)
  const options = normalizedOptions(request.options)
  const rules = parseTextReplacementExpression(options.textReplacementExpression)
  const outputDirectory = resolve(request.outputDirectory)

  // 涂白在 Photoshop 这条路上还没实现（本地路有）。以前是**静默丢掉**的，
  // 用户开着涂白跑完以为做了 —— 这里至少要说一声。
  if (options.dialogOverlay.enabled) {
    result.warnings.push(
      '「按标签点覆盖对白框」（涂白）在「交给 Photoshop」这条路上还没实现，这一批不会涂白；需要涂白请用上面的「生成 PSD」。'
    )
  }

  const requestedImages = Array.isArray(request.selectedImageNames)
    ? request.selectedImageNames
    : []
  const selectedImages = new Set(requestedImages)
  const requestedGroups = Array.isArray(request.selectedGroups) ? request.selectedGroups : []
  const selectedGroups = new Set(requestedGroups.length > 0 ? requestedGroups : document.groups)

  const images: LabelPlusManifestImage[] = []
  for (const row of preview.rows) {
    // 空数组 = **什么都没选**（不是"全选"）：2026-09-30 审查 critical，与
    // labelplus-import-service.ts 同一处语义（完整来由写在那边的注释里）。
    if (!selectedImages.has(row.labelImageName)) {
      result.skippedImages.push(`${row.labelImageName}（未勾选）`)
      continue
    }
    if (!row.matched || !row.sourcePath) {
      result.skippedImages.push(`${row.labelImageName}（未匹配到图源）`)
      continue
    }
    const sourceImage = document.images.find((entry) => entry.fileName === row.labelImageName)
    if (!sourceImage) {
      result.skippedImages.push(`${row.labelImageName}（文本记录不存在）`)
      continue
    }

    const labels: LabelPlusManifestLabel[] = []
    for (const label of sourceImage.labels) {
      if (!selectedGroups.has(label.group)) continue
      labels.push({
        index: label.index,
        group: label.group,
        text: applyTextReplacementRules(label.text, rules),
        position: { x: label.position.x, y: label.position.y },
        // 单条级的覆盖留着不用：分组级（方向、动作）已经够表达现有需求，
        // 而每多一个层级就多一处"到底哪层生效"的解释成本。
        styleOverride: {}
      })
    }

    const size = probeSourceSize(row.sourcePath)
    images.push({
      labelImageName: row.labelImageName,
      sourcePath: resolve(row.sourcePath),
      outputPath: join(outputDirectory, safeOutputName(row.sourceFileName ?? row.labelImageName)),
      ...(size ? { width: size.width, height: size.height } : {}),
      labels
    })
  }

  if (images.length === 0) {
    result.message = '没有可交给 Photoshop 的图片（都没勾选，或都没匹配到图源）'
    return result
  }

  // 只列被选中的分组。清单里没出现的分组不会出现任何文字，所以 enabled 恒为 true ——
  // 这个字段留在契约里是给"整组保留但不导入"这类将来用的，runner 已经会认它。
  const groups: Record<string, LabelPlusManifestGroup> = {}
  for (const name of document.groups) {
    if (!selectedGroups.has(name)) continue
    const direction = request.groupDirections?.[name]
    groups[name] = {
      enabled: true,
      // 空字符串 = 没指定 → runner 会回落到分组名本身。
      action: String(request.groupActions?.[name] ?? '').trim(),
      // 只有明确给了合法方向才写覆盖；其余一律跟随 defaults，避免写进一个 undefined。
      textStyle: direction === 'horizontal' || direction === 'vertical' ? { direction } : {}
    }
  }

  const actionSetName = String(request.actionSetName ?? '').trim()
  const jobId = shortJobId()
  const jobDirectory = join(labelPlusJobRoot(), jobId)
  const manifestPath = join(jobDirectory, 'manifest.json')
  const launcherPath = join(jobDirectory, 'run.jsx')
  const reportPath = join(jobDirectory, 'report.json')

  const manifest: LabelPlusManifest = {
    manifestVersion: LABELPLUS_MANIFEST_VERSION,
    jobId,
    generatedAt: new Date().toISOString(),
    generatedBy: `汉化工坊 ${app.getVersion()}`,
    job: {
      labelFilePath: resolve(request.labelFilePath),
      sourceDirectory: resolve(request.sourceDirectory),
      outputDirectory,
      overwrite: options.overwriteExisting !== false,
      closeAfterSave: true
    },
    document: {
      backgroundKind: 'source-image',
      backgroundTemplatePath: null,
      existingPsdPath: null,
      resolutionPpi: options.resolutionPpi,
      colorMode: 'RGB',
      layerGroupMode: options.createLayerGroups ? 'create' : 'flat',
      outputLabelNumber: options.outputLabelIndex,
      labelNumberStyle: {
        font: {
          id: 'builtin-arial',
          family: 'Arial',
          style: 'Regular',
          postScriptName: 'ArialMT'
        },
        fontSizePx: 12,
        fillColor: '#ff0000'
      }
    },
    save: { format: 'psd', asCopy: false },
    defaults: {
      positionUnit: 'normalized',
      textStyle: options.textStyle
    },
    groups,
    actions: {
      ...createDefaultManifestActions(),
      enabled: actionSetName.length > 0,
      setName: actionSetName || 'LabelPlusAction'
    },
    report: { path: reportPath, level: 'per-image' },
    images
  }

  const validation = validateLabelPlusManifest(manifest)
  if (!validation.ok) {
    // 清单一旦交给 PS，那边的报错基本没法读。宁可在这里拦住，并说清楚是哪个字段。
    result.issues = validation.issues.map((issue) => `${issue.path}：${issue.message}`)
    result.message = `指令清单自检没通过（${result.issues.length} 处），未写出任何文件`
    return result
  }

  await mkdir(jobDirectory, { recursive: true })
  // 先删掉上一份回执：否则工坊会读到"上次那批已经跑完"的旧回执，显示成已经完成了。
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeFile(launcherPath, buildLauncherScript(manifestPath, runnerPath), 'utf8')
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        manifestVersion: manifest.manifestVersion,
        jobId,
        runnerVersion: '',
        startedAt: '',
        finishedAt: null,
        ok: false,
        generated: 0,
        failed: 0,
        skipped: 0,
        images: [],
        warnings: []
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  result.ok = true
  result.jobId = jobId
  result.manifestPath = manifestPath
  result.launcherPath = launcherPath
  result.reportPath = reportPath
  result.imageCount = images.length
  result.labelCount = images.reduce((sum, image) => sum + image.labels.length, 0)
  result.message = `指令清单已生成：${result.imageCount} 张图 / ${result.labelCount} 条文字`

  await writeLog({
    level: 'info',
    scope: 'labelplus-job',
    message: 'Prepared a Photoshop job',
    data: {
      jobId,
      manifestPath,
      runnerPath,
      images: result.imageCount,
      labels: result.labelCount,
      actions: manifest.actions.enabled ? manifest.actions.setName : null,
      skipped: result.skippedImages.length
    }
  }).catch(() => undefined)

  return result
}

/** 启动 Photoshop 跑引子。与 §6.2 的 launchTool 同一套办法（spawn + detached）。 */
export async function launchLauncherInPhotoshop(
  photoshopPath: string,
  launcherPath: string
): Promise<{ ok: boolean; message: string }> {
  const exe = photoshopPath.trim()
  if (!exe) return { ok: false, message: '尚未配置 Photoshop 程序路径（设置 → 外部工具）' }
  try {
    const info = await stat(exe)
    if (!info.isFile()) return { ok: false, message: `${exe} 不是一个文件` }
  } catch {
    return { ok: false, message: `找不到 Photoshop：${exe}` }
  }

  return await new Promise<{ ok: boolean; message: string }>((resolvePromise) => {
    let settled = false
    const child = spawn(exe, [launcherPath], { detached: true, stdio: 'ignore' })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      resolvePromise({ ok: false, message: error.message })
    })
    child.once('spawn', () => {
      if (settled) return
      settled = true
      child.unref()
      resolvePromise({ ok: true, message: '' })
    })
  })
}

/** 读回执。还没写出来 / 写了一半 / 文件不存在都返回 null —— 调用方按"进行中"处理。 */
export async function readLabelPlusJobReport(
  reportPath: string
): Promise<LabelPlusJobReport | null> {
  try {
    const raw = await readFile(resolve(reportPath), 'utf8')
    const parsed = JSON.parse(raw) as LabelPlusJobReport
    const strings = (value: unknown): boolean =>
      Array.isArray(value) && value.every((item) => typeof item === 'string')
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.images) ||
      typeof parsed.jobId !== 'string' ||
      ![parsed.generated, parsed.failed, parsed.skipped].every(
        (n) => Number.isSafeInteger(n) && n >= 0
      ) ||
      !(parsed.finishedAt === null || typeof parsed.finishedAt === 'string') ||
      !strings(parsed.warnings) ||
      parsed.images.some((image) => !image || typeof image !== 'object' || !strings(image.warnings))
    )
      return null
    return parsed
  } catch {
    return null
  }
}
