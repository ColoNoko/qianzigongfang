// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { installUserFonts, resetFontManagerMemory, uninstallUserFonts } from '../windows'
const mock = vi.hoisted(() => ({ set: vi.fn(), remove: vi.fn(), resource: vi.fn(), save: vi.fn(), root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => mock.root } }))
vi.mock('../native', () => ({
  queryRegistryFonts: () => [],
  setFontRegistration: mock.set,
  removeFontRegistration: mock.remove,
  changeFontResource: mock.resource
}))
vi.mock('../../services/database', () => ({
  getStoredValue: async () => ({ installed: {} }),
  setStoredValue: mock.save
}))
vi.mock('../repository', () => ({
  invalidateFontMetadata: vi.fn(),
  readFontMetadata: async () => [
    {
      faceIndex: 0,
      family: 'Fixture',
      style: 'Regular',
      postScriptName: 'Fixture-Regular',
      weight: 400,
      italic: false,
      languages: ['latin']
    }
  ]
}))
afterEach(async () => {
  vi.unstubAllEnvs()
  if (mock.root) await rm(mock.root, { recursive: true, force: true })
})
async function setup() {
  mock.root = await mkdtemp(join(tmpdir(), 'font-mutation-'))
  vi.stubEnv('LOCALAPPDATA', mock.root)
  vi.stubEnv('WINDIR', mock.root)
  resetFontManagerMemory()
  mock.set.mockReset()
  mock.remove.mockReset()
  mock.resource.mockReset().mockResolvedValue(undefined)
  mock.save.mockReset().mockResolvedValue(undefined)
  const source = join(mock.root, 'fixture.ttf')
  await writeFile(source, 'original-font')
  return source
}
it('compensates registration and preserves the original source when metadata persistence fails', async () => {
  const source = await setup()
  mock.save.mockRejectedValueOnce(new Error('disk full'))
  const result = await installUserFonts([source])
  expect(result.installed).toHaveLength(0)
  expect(result.failed[0].message).toContain('disk full')
  expect(await readFile(source, 'utf8')).toBe('original-font')
  expect(await readdir(join(mock.root, 'Microsoft', 'Windows', 'Fonts'))).toEqual([])
  expect(mock.remove).toHaveBeenCalledOnce()
})
it('restores the staged font if registry removal fails and handles a TTC face ID as its file', async () => {
  const source = await setup()
  const installed = (await installUserFonts([source])).installed[0]
  mock.remove.mockImplementation(() => { throw new Error('registry denied') })
  const result = await uninstallUserFonts([`${installed.id}:1`, installed.id])
  expect(result.succeeded).toEqual([])
  expect(result.failed).toHaveLength(1)
  expect(await readFile(installed.filePath, 'utf8')).toBe('original-font')
  expect(mock.set).toHaveBeenCalledTimes(2)
})
