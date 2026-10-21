// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { mediaInfo, readMedia } from '../media-source'
const root = resolve(__dirname, '../../../../.omo/fixtures/media-source-test')
beforeAll(async () => {
  await mkdir(root, { recursive: true })
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})
it('estimates PSD memory from its header and rejects changed files before reading', async () => {
  const file = join(root, 'sample.psd')
  const header = Buffer.alloc(26)
  header.write('8BPS')
  header.writeUInt32BE(640, 14)
  header.writeUInt32BE(960, 18)
  await writeFile(file, header)
  const info = await mediaInfo(file)
  expect(info.estimatedBytes).toBeGreaterThanOrEqual(640 * 960 * 16)
  expect(Buffer.from(await readMedia(file, info))).toEqual(header)
  await writeFile(file, Buffer.concat([header, Buffer.from('changed')]))
  await expect(readMedia(file, info)).rejects.toThrow('更新')
})
it('rejects oversized declared bitmap dimensions before decoding', async () => {
  const file = join(root, 'huge.psd'),
    header = Buffer.alloc(26)
  header.write('8BPS')
  header.writeUInt32BE(30000, 14)
  header.writeUInt32BE(30000, 18)
  await writeFile(file, header)
  await expect(mediaInfo(file)).rejects.toThrow('尺寸超过')
})
it('estimates ordinary PNGs and rejects directories', async () => {
  const file = join(root, 'sample.png'),
    header = Buffer.alloc(24)
  header.write('PNG', 1)
  header.writeUInt32BE(640, 16)
  header.writeUInt32BE(960, 20)
  await writeFile(file, header)
  expect((await mediaInfo(file)).estimatedBytes).toBe(24 + 640 * 960 * 12)
  await expect(mediaInfo(root)).rejects.toThrow('图源')
})
