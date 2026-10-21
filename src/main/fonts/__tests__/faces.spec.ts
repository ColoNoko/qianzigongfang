// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFontFile } from '../metadata'
import { extractFontFace } from '../preview'

function collection(): Buffer {
  const bytes = Buffer.alloc(1024)
  bytes.write('ttcf')
  bytes.writeUInt32BE(0x10000, 4)
  bytes.writeUInt32BE(2, 8)
  for (let face = 0; face < 2; face++) {
    const start = 32 + face * 480
    bytes.writeUInt32BE(start, 12 + face * 4)
    bytes.writeUInt32BE(0x10000, start)
    bytes.writeUInt16BE(3, start + 4)
    const names = [
      'Fixture',
      face ? 'SemiBold Italic' : 'Regular',
      face ? 'Fixture-SemiBoldItalic' : 'Fixture-Regular'
    ]
    const name = Buffer.alloc(200)
    name.writeUInt16BE(3, 2)
    name.writeUInt16BE(42, 4)
    let cursor = 42
    names.forEach((value, i) => {
      const text = Buffer.from(value, 'utf16le').swap16(),
        at = 6 + i * 12
      name.writeUInt16BE(3, at)
      name.writeUInt16BE(1, at + 2)
      name.writeUInt16BE(0x409, at + 4)
      name.writeUInt16BE([1, 2, 6][i], at + 6)
      name.writeUInt16BE(text.length, at + 8)
      name.writeUInt16BE(cursor - 42, at + 10)
      text.copy(name, cursor)
      cursor += text.length
    })
    const os2 = Buffer.alloc(64)
    os2.writeUInt16BE(face ? 600 : 400, 4)
    os2.writeUInt16BE(face, 62)
    const tables = [
      ['name', name],
      ['OS/2', os2],
      ['head', Buffer.alloc(54)]
    ] as const
    let offset = start + 64
    tables.forEach(([tag, data], i) => {
      const at = start + 12 + i * 16
      bytes.write(tag, at)
      bytes.writeUInt32BE(offset, at + 8)
      bytes.writeUInt32BE(data.length, at + 12)
      data.copy(bytes, offset)
      offset += data.length
    })
  }
  return bytes
}
describe('OpenType collection faces', () => {
  it('reads both faces and extracts the selected face with a valid SFNT checksum', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'font-faces-'))
    try {
      const original = collection(),
        path = join(directory, 'fixture.ttc')
      await writeFile(path, original)
      const faces = await parseFontFile(path)
      expect(faces.map((f) => [f.faceIndex, f.weight, f.italic, f.postScriptName])).toEqual([
        [0, 400, false, 'Fixture-Regular'],
        [1, 600, true, 'Fixture-SemiBoldItalic']
      ])
      const extracted = extractFontFace(original, 1)
      let sum = 0
      for (let at = 0; at < extracted.length; at += 4)
        sum = (sum + extracted.readUInt32BE(at)) >>> 0
      expect(sum).toBe(0xb1b0afba)
      await writeFile(join(directory, 'face.ttf'), extracted)
      expect((await parseFontFile(join(directory, 'face.ttf')))[0].postScriptName).toBe(
        'Fixture-SemiBoldItalic'
      )
      expect(original).toEqual(collection())
      expect(() => extractFontFace(original, 2)).toThrow()
      const corrupt = Buffer.from(original)
      corrupt.writeUInt32BE(0xffffffff, 52)
      expect(() => extractFontFace(corrupt, 0)).toThrow()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
