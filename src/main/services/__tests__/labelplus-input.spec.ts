// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareLabelPlusInput } from '../labelplus-input'

vi.mock('electron', () => ({ nativeImage: {} }))

const temporaryDirectories: string[] = []

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
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
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
      ['1,0', '-', '框内', '-', 'comment', '>>>>>>>>[page.png]<<<<<<<<', '------[1]------[0.2,0.3,1]', '文字'].join('\n'),
      'utf8'
    )
    await writeFile(zipPath, storedZip([{ name: 'labels.txt', data: labels }, { name: 'images/page.png', data: Buffer.from([1]) }]))

    const selection = await prepareLabelPlusInput(zipPath, join(root, 'temp'))

    expect(selection.inputKind).toBe('zip')
    expect(selection.extractedDirectory).toBe(join(root, 'temp', 'sample-bundle'))
    expect(selection.suggestedSourceDirectory).toBe(join(root, 'temp', 'sample-bundle', 'images'))
    expect(selection.suggestedOutputDirectory).toBe(join(root, 'temp', 'sample-bundle', 'output'))
  })
})
