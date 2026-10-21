// @vitest-environment node
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { MAX_IMPORT_FILE_BYTES } from '@shared/achievement-profile'
const { pick } = vi.hoisted(() => ({ pick: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showOpenDialog: pick }
}))
import { importAchievementFile } from '../achievement-io'
let directory = ''
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
it('实际文件按字节限制读取，接受边界并拒绝超限，保留中文', async () => {
  directory = await mkdtemp(join(tmpdir(), 'achievement-io-'))
  const file = join(directory, 'profile.json')
  pick.mockResolvedValue({ canceled: false, filePaths: [file] })
  await writeFile(file, '{"name":"汉化"}')
  expect((await importAchievementFile()).text).toBe('{"name":"汉化"}')
  await writeFile(file, Buffer.alloc(MAX_IMPORT_FILE_BYTES, 32))
  expect((await importAchievementFile()).text?.length).toBe(MAX_IMPORT_FILE_BYTES)
  await writeFile(file, Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1, 32))
  expect((await importAchievementFile()).error).toContain('文件太大')
})
