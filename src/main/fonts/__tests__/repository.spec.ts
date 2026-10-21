// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const mock = vi.hoisted(() => ({ root: '', parse: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => mock.root } }))
vi.mock('../metadata', () => ({ parseFontFile: mock.parse }))
import { readFontMetadata, closeFontRepository } from '../repository'
afterEach(async () => {
  closeFontRepository()
  if (mock.root) await rm(mock.root, { recursive: true, force: true })
})
it('persists metadata across reopening and invalidates changed files', async () => {
  mock.root = await mkdtemp(join(tmpdir(), 'font-repository-'))
  const path = join(mock.root, 'test.ttf')
  await writeFile(path, 'fixture')
  mock.parse.mockResolvedValue([{ family: 'fixture', style: 'Regular', faceIndex: 0 }])
  await Promise.all([readFontMetadata(path), readFontMetadata(path)])
  expect(mock.parse).toHaveBeenCalledTimes(1)
  closeFontRepository()
  await readFontMetadata(path)
  expect(mock.parse).toHaveBeenCalledTimes(1)
  await writeFile(path, 'changed-file')
  await readFontMetadata(path)
  expect(mock.parse).toHaveBeenCalledTimes(2)
})
