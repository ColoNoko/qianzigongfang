// @vitest-environment node
/**
 * LabelPlus 输入准备回归锁（2026-10-05 从并行分支 T5 移植）。
 *
 * 在旧版两条用例（目录发现 / ZIP 解压发现）之外，多锁四件：
 *   1. 损坏 ZIP ⇒ 报错，但旧的 output 目录原样保留；
 *   2. 解压守卫：条目数 / 单文件 / 总体积 / 越界路径 / 符号链接都在解压前拦截；
 *   3. 重导入同一 ZIP（含并发两次）保留用户手工编辑过的 output；
 *   4. 同名 ZIP 并发导入串行发布，不会相互覆盖。
 */
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareLabelPlusInput, createLabelPlusZipEntryGuard } from '../labelplus-input'

vi.mock('electron', () => ({ nativeImage: {} }))

const temporaryDirectories: string[] = []

it('preserves existing output when a replacement ZIP is corrupt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qianzi-zip-preserve-'))
  temporaryDirectories.push(root)
  const output = join(root, 'temp', 'book', 'output')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'previous.psd'), 'original output')
  const zip = join(root, 'book.zip')
  await writeFile(zip, 'broken zip')
  await expect(prepareLabelPlusInput(zip, join(root, 'temp'))).rejects.toThrow()
  expect(await readFile(join(output, 'previous.psd'), 'utf8')).toBe('original output')
})

it('rejects oversized or linked archive entries before extraction', () => {
  const guard = createLabelPlusZipEntryGuard({
    maximumEntries: 2,
    maximumEntryUncompressedBytes: 10,
    maximumTotalUncompressedBytes: 12
  })
  const entry = {
    fileName: 'safe.txt',
    uncompressedSize: 8,
    externalFileAttributes: 0,
    generalPurposeBitFlag: 0
  }
  guard(entry, 2)
  expect(() => guard({ ...entry, fileName: 'second.txt' }, 2)).toThrow(/总大小/)
  expect(() => createLabelPlusZipEntryGuard()({ ...entry, fileName: '../escape' })).toThrow(/越界/)
  expect(() =>
    createLabelPlusZipEntryGuard()({ ...entry, externalFileAttributes: 0xa000 << 16 })
  ).toThrow(/符号链接/)
})

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const checksum = crc32(entry.data)
    const local = Buffer.alloc(30 + name.length + entry.data.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    entry.data.copy(local, 30 + name.length)
    localParts.push(local)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centralParts.push(central)
    offset += local.length
  }
  const local = Buffer.concat(localParts)
  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(local.length, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([local, central, end])
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('LabelPlus input bundle discovery', () => {
  it('discovers a TXT file and images from a dropped directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qianzi-labelplus-'))
    temporaryDirectories.push(root)
    await mkdir(join(root, 'images'))
    await writeFile(
      join(root, 'labels.txt'),
      [
        '1,0',
        '-',
        '框内',
        '框外',
        '-',
        'comment',
        '>>>>>>>>[page-01.png]<<<<<<<<',
        '------[1]------[0.2,0.3,1]',
        '文字'
      ].join('\n'),
      'utf8'
    )
    await writeFile(join(root, 'images', 'page-01.png'), Buffer.from([1, 2, 3]))

    const selection = await prepareLabelPlusInput(root, join(root, 'temp'))

    expect(selection.inputKind).toBe('directory')
    expect(selection.fileName).toBe('labels.txt')
    expect(selection.suggestedSourceDirectory).toBe(join(root, 'images'))
    expect(selection.suggestedOutputDirectory).toBe(join(root, 'output'))
    expect(selection.images[0]?.fileName).toBe('page-01.png')
  })

  it('extracts a ZIP into temp/<zip-name> and applies the same discovery flow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qianzi-labelplus-zip-'))
    temporaryDirectories.push(root)
    const zipPath = join(root, 'sample-bundle.zip')
    const labels = Buffer.from(
      [
        '1,0',
        '-',
        '框内',
        '-',
        'comment',
        '>>>>>>>>[page.png]<<<<<<<<',
        '------[1]------[0.2,0.3,1]',
        '文字'
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      zipPath,
      storedZip([
        { name: 'labels.txt', data: labels },
        { name: 'images/page.png', data: Buffer.from([1]) }
      ])
    )

    const selection = await prepareLabelPlusInput(zipPath, join(root, 'temp'))

    expect(selection.inputKind).toBe('zip')
    expect(selection.extractedDirectory).toBe(join(root, 'temp', 'sample-bundle'))
    expect(selection.suggestedSourceDirectory).toBe(join(root, 'temp', 'sample-bundle', 'images'))
    expect(selection.suggestedOutputDirectory).toBe(join(root, 'temp', 'sample-bundle', 'output'))
    await mkdir(selection.suggestedOutputDirectory, { recursive: true })
    const saved = join(selection.suggestedOutputDirectory, 'edited.psd')
    await writeFile(saved, 'hand edited')
    await Promise.all([
      prepareLabelPlusInput(zipPath, join(root, 'temp')),
      prepareLabelPlusInput(zipPath, join(root, 'temp'))
    ])
    expect(await readFile(saved, 'utf8')).toBe('hand edited')
  })
})
