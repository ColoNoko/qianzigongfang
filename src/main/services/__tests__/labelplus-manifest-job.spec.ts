// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LABELPLUS_IMPORT_API_VERSION, createDefaultLabelPlusGenerateOptions } from '@shared/labelplus-import'
import { validateLabelPlusManifest, type LabelPlusManifest } from '@shared/labelplus-manifest'

/**
 * electron 在纯 node 测试里不存在，而 `app.getAppPath()`（打包路径判定）和
 * `nativeImage`（图片头尺寸探测）正是这个服务里唯一依赖 Electron 的两处。
 * 用一个可变的 holder 让每条用例都能摆出不同的"目录长什么样"。
 */
const electronState = vi.hoisted(() => ({
  appPath: process.cwd(),
  version: '0.4.0-test',
  // 真正的值在 beforeEach 里指到沙箱；这里不能用 tmpdir()，
  // 因为 vi.hoisted 跑在 import 之前。
  logRoot: ''
}))

vi.mock('electron', () => ({
  app: {
    getVersion: () => electronState.version,
    getAppPath: () => electronState.appPath,
    isPackaged: false,
    getPath: () => electronState.logRoot
  },
  // 一律返回"解不出来" —— 于是清单里不会带 width/height，正好覆盖"尺寸可选"这条。
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) })
  }
}))

const {
  buildLabelPlusJob,
  buildLauncherScript,
  labelPlusJobRoot,
  launchLauncherInPhotoshop,
  readLabelPlusJobReport,
  resolveRunnerScriptPath
} = await import('../labelplus-manifest-job')

const LABELS = [
  '1,0',
  '-',
  '框外',
  '框内',
  '-',
  '>>>>>>>>[page-001.png]<<<<<<<<',
  '----------[1]----------[0.8,0.1,1]',
  '第一条',
  '----------[2]----------[0.2,0.6,2]',
  '第二条'
].join('\n')

let sandbox = ''
let jobRoot = ''
let labelFilePath = ''
let sourceDirectory = ''
let outputDirectory = ''

async function makeFixture(): Promise<void> {
  sandbox = await mkdtemp(join(tmpdir(), 'qianzi-job-'))
  labelFilePath = join(sandbox, 'labels.txt')
  sourceDirectory = join(sandbox, 'images')
  outputDirectory = join(sandbox, 'output')
  await mkdir(sourceDirectory, { recursive: true })
  await writeFile(labelFilePath, LABELS, 'utf8')
  // 图源内容无所谓：匹配器只列目录，尺寸探测走的是被 mock 掉的 nativeImage。
  await writeFile(join(sourceDirectory, 'page-001.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  // 让 EXE 同级 temp 落到沙箱里（沿用 portable 模式那条既有通道）。
  jobRoot = join(sandbox, 'app-dir')
  process.env.PORTABLE_EXECUTABLE_DIR = jobRoot
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: LABELPLUS_IMPORT_API_VERSION,
    labelFilePath,
    sourceDirectory,
    match: { mode: 'file-name' as const, forcedExtension: '' },
    outputDirectory,
    selectedImageNames: ['page-001.png'],
    selectedGroups: ['框外', '框内'],
    options: createDefaultLabelPlusGenerateOptions(),
    ...overrides
  }
}

async function readManifest(path: string): Promise<LabelPlusManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as LabelPlusManifest
}

beforeEach(async () => {
  electronState.appPath = process.cwd()
  await makeFixture()
  // 日志落到沙箱里，别污染工作区。
  electronState.logRoot = sandbox
})

afterEach(async () => {
  delete process.env.PORTABLE_EXECUTABLE_DIR
  if (sandbox) await rm(sandbox, { recursive: true, force: true })
})

describe('引子脚本的生成', () => {
  it('把 Windows 反斜杠换成正斜杠（ExtendScript 里反斜杠是转义符）', () => {
    const script = buildLauncherScript('C:\\jobs\\a b\\manifest.json', 'D:\\app\\runner.jsx')

    expect(script).toContain("$.qianziManifestPath = 'C:/jobs/a b/manifest.json';")
    expect(script).toContain("$.qianziRunnerScriptPath = 'D:/app/runner.jsx';")
    expect(script).not.toContain('\\')
  })

  /**
   * 这条锁的是踩过两次的那个坑：ExtendScript 的 ASI 不可靠。
   * 生成的脚本同样不能有"没分号的语句行"或"以 ( 开头的行"。
   */
  it('每一行语句都以分号收尾，且没有一行以 ( [ ` + - / * 开头', () => {
    const script = buildLauncherScript('/a/m.json', '/b/r.jsx')
    const code = script
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/u, '').trim())
      .filter(Boolean)

    expect(code.length).toBeGreaterThan(0)
    for (const line of code) {
      expect(line.endsWith(';'), `这一行没有以分号结尾：${line}`).toBe(true)
      expect(['(', '[', '`', '+', '-', '/', '*']).not.toContain(line.charAt(0))
    }
  })
})

describe('runner 本体的路径解析', () => {
  it('源码目录下能找到 runner（开发/未打包）', () => {
    const resolved = resolveRunnerScriptPath()

    expect(resolved).not.toBe('')
    expect(resolved.endsWith(join('resources', 'qianzi-runner.jsx'))).toBe(true)
  })

  it('打包后优先用 app.asar.unpacked 里那份（PS 读不了 asar 里面的东西）', async () => {
    const resources = join(sandbox, 'resources')
    await mkdir(join(resources, 'app.asar.unpacked', 'resources'), { recursive: true })
    await writeFile(join(resources, 'app.asar.unpacked', 'resources', 'qianzi-runner.jsx'), '')
    const resourcesPath = process.resourcesPath
    Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true })

    try {
      expect(resolveRunnerScriptPath()).toBe(
        join(resources, 'app.asar.unpacked', 'resources', 'qianzi-runner.jsx')
      )
    } finally {
      Object.defineProperty(process, 'resourcesPath', {
        value: resourcesPath,
        configurable: true
      })
    }
  })

  it('路径里带 .asar/ 的候选一律跳过 —— 那种路径 Electron 的 fs 能读，但 Photoshop 读不了', async () => {
    const decoyAppPath = join(sandbox, 'decoy')
    await mkdir(join(decoyAppPath, 'app.asar', 'resources'), { recursive: true })
    // 这个文件真实存在，所以 existsSync 会返回 true —— 只有那条正则能拦住它。
    await writeFile(join(decoyAppPath, 'app.asar', 'resources', 'qianzi-runner.jsx'), '')
    electronState.appPath = join(decoyAppPath, 'app.asar')

    expect(resolveRunnerScriptPath()).toBe('')
  })
})

describe('指令清单的编排', () => {
  it('写出一份能通过自检的清单，并把引子、空回执一起放好', async () => {
    const result = await buildLabelPlusJob(request({ actionSetName: 'LabelPlusAction' }))

    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.imageCount).toBe(1)
    expect(result.labelCount).toBe(2)

    const manifest = await readManifest(result.manifestPath as string)
    expect(validateLabelPlusManifest(manifest).issues).toEqual([])

    // 清单和引子都落在 temp 里，而不是输出目录 —— 输出目录会被扫描器扫。
    expect(result.manifestPath?.startsWith(labelPlusJobRoot())).toBe(true)
    expect(result.launcherPath?.startsWith(labelPlusJobRoot())).toBe(true)
    expect(result.reportPath?.startsWith(labelPlusJobRoot())).toBe(true)

    const launcher = await readFile(result.launcherPath as string, 'utf8')
    // 引子里路径刻意写成正斜杠（ExtendScript 里反斜杠是转义符），所以按正斜杠比对。
    const toScriptPath = (value: string): string => value.replace(/\\/gu, '/')
    expect(launcher).toContain(toScriptPath(result.manifestPath as string))
    expect(launcher).toContain(toScriptPath(result.runnerPath as string))

    // 空回执先摆好，工坊一读就知道"还没跑完"（finishedAt 为 null）。
    const report = await readLabelPlusJobReport(result.reportPath as string)
    expect(report?.finishedAt).toBeNull()
    expect(report?.images).toEqual([])
    expect(report?.jobId).toBe(result.jobId)
  })

  it('只把勾选的分组写进清单 —— 没勾的分组连文字都不该出现', async () => {
    const result = await buildLabelPlusJob(request({ selectedGroups: ['框外'] }))
    const manifest = await readManifest(result.manifestPath as string)

    expect(manifest.images[0].labels).toHaveLength(1)
    expect(manifest.images[0].labels[0].group).toBe('框外')
    expect(Object.keys(manifest.groups)).toEqual(['框外'])
  })

  it('坐标保持 0..1 的比例，不做任何换算（换算是 PS 的事）', async () => {
    const result = await buildLabelPlusJob(request())
    const manifest = await readManifest(result.manifestPath as string)

    expect(manifest.defaults.positionUnit).toBe('normalized')
    expect(manifest.images[0].labels[1].position).toEqual({ x: 0.2, y: 0.6 })
  })

  it('文字替换规则在工坊侧就应用好，PS 那边不碰文本', async () => {
    const options = createDefaultLabelPlusGenerateOptions()
    options.textReplacementExpression = '第一条->FIRST'
    const result = await buildLabelPlusJob(request({ options }))
    const manifest = await readManifest(result.manifestPath as string)

    expect(manifest.images[0].labels[0].text).toBe('FIRST')
  })

  it('填了动作集名才会启用动作；分组没指定动作就回落到分组名', async () => {
    const off = await buildLabelPlusJob(request())
    expect((await readManifest(off.manifestPath as string)).actions.enabled).toBe(false)

    const on = await buildLabelPlusJob(
      request({ actionSetName: 'LabelPlusAction', groupActions: { 框内: '框内竖' } })
    )
    const manifest = await readManifest(on.manifestPath as string)

    expect(manifest.actions.enabled).toBe(true)
    expect(manifest.actions.setName).toBe('LabelPlusAction')
    expect(manifest.groups['框内'].action).toBe('框内竖')
    expect(manifest.groups['框外'].action).toBe('')
  })

  it('分组级方向覆盖写进清单 —— 这是"框外竖排、框内横排"唯一的实现方式', async () => {
    const result = await buildLabelPlusJob(
      request({ groupDirections: { 框外: 'vertical', 框内: 'horizontal' } })
    )
    const manifest = await readManifest(result.manifestPath as string)

    expect(manifest.groups['框外'].textStyle).toEqual({ direction: 'vertical' })
    expect(manifest.groups['框内'].textStyle).toEqual({ direction: 'horizontal' })
    // 全场默认方向不受影响。
    expect(manifest.defaults.textStyle.direction).toBe('horizontal')
  })

  it('没给分组方向就不写这个字段 —— 由 runner 回落到全场默认，而不是写个 undefined 进去', async () => {
    const result = await buildLabelPlusJob(request())
    const manifest = await readManifest(result.manifestPath as string)

    expect(manifest.groups['框外'].textStyle).toEqual({})
  })

  it('非法的分组方向被丢掉，绝不写进清单', async () => {
    const result = await buildLabelPlusJob(
      request({ groupDirections: { 框外: '斜排' as never } })
    )
    const manifest = await readManifest(result.manifestPath as string)

    expect(manifest.groups['框外'].textStyle).toEqual({})
    expect(validateLabelPlusManifest(manifest).ok).toBe(true)
  })

  it('没勾的图不进清单，但要在 skippedImages 里点名', async () => {
    const result = await buildLabelPlusJob(request({ selectedImageNames: ['另一张.png'] }))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('没有可交给 Photoshop 的图片')
    expect(result.skippedImages).toEqual(['page-001.png（未勾选）'])
  })

  it('图片尺寸是可选的：探不出来就不写这个字段，而不是写 0', async () => {
    const result = await buildLabelPlusJob(request())
    const manifest = await readManifest(result.manifestPath as string)

    expect(manifest.images[0].width).toBeUndefined()
    // 而且不带尺寸仍然是合法清单。
    expect(validateLabelPlusManifest(manifest).ok).toBe(true)
  })

  /**
   * 涂白（dialog-overlay）在 Photoshop 这条路上还没实现。
   * 以前是**静默丢掉**的：用户开着涂白跑完，以为做了，其实什么都没发生。
   */
  it('开着涂白时必须明确警告，而不是静默丢掉', async () => {
    const off = await buildLabelPlusJob(request())
    expect(off.warnings).toEqual([])

    const options = createDefaultLabelPlusGenerateOptions()
    options.dialogOverlay.enabled = true
    const on = await buildLabelPlusJob(request({ options }))

    expect(on.ok).toBe(true)
    expect(on.warnings.join()).toContain('涂白')
  })

  it('API 版本对不上直接拒绝，不写任何文件', async () => {
    const result = await buildLabelPlusJob(request({ apiVersion: 999 }))

    expect(result.ok).toBe(false)
    expect(result.manifestPath).toBeNull()
    expect(result.message).toContain('版本不兼容')
  })
})

describe('启动 Photoshop 与读回执', () => {
  it('Photoshop 路径为空时给出可执行的提示，而不是抛异常', async () => {
    const outcome = await launchLauncherInPhotoshop('', '/tmp/run.jsx')

    expect(outcome.ok).toBe(false)
    expect(outcome.message).toContain('尚未配置 Photoshop')
  })

  it('回执不存在 / 内容不合法 / 不是对象，都返回 null（调用方当"进行中"）', async () => {
    expect(await readLabelPlusJobReport(join(sandbox, '没有这个文件.json'))).toBeNull()

    const broken = join(sandbox, 'broken.json')
    await writeFile(broken, '{ 这不是 json', 'utf8')
    expect(await readLabelPlusJobReport(broken)).toBeNull()

    const wrongShape = join(sandbox, 'wrong.json')
    await writeFile(wrongShape, '{"images":"不是数组"}', 'utf8')
    expect(await readLabelPlusJobReport(wrongShape)).toBeNull()
    for (const patch of [{ images: [null] }, { warnings: {} }, { generated: '1' }, { images: [{ warnings: null }] }]) {
      await writeFile(wrongShape, JSON.stringify({ jobId: 'job', images: [], warnings: [], generated: 0, failed: 0, skipped: 0, finishedAt: null, ...patch }))
      expect(await readLabelPlusJobReport(wrongShape)).toBeNull()
    }
  })
})
