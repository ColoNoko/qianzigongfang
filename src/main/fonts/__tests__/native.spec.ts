// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { changeFontResource, queryRegistryFonts, removeFontRegistration, setFontRegistration } from '../native'

it.skipIf(process.platform !== 'win32')('round-trips a Unicode registration and balances a temporary font resource without a shell', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'font-native-'))
  const name = `汉化工坊临时测试-${randomUUID()}`
  const path = join(directory, '测试字体.ttf')
  let added = false
  try {
    const fonts = queryRegistryFonts()
    expect(fonts.some(font => font.scope === 'system')).toBe(true)
    await copyFile(join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf'), path)
    setFontRegistration(name, path)
    expect(queryRegistryFonts().find(font => font.name === name)).toEqual({ name, value: path, scope: 'user' })
    await changeFontResource('add', path)
    added = true
    await changeFontResource('remove', path)
    added = false
    removeFontRegistration(name)
    expect(queryRegistryFonts().some(font => font.name === name)).toBe(false)
  } finally {
    if (added) await changeFontResource('remove', path)
    removeFontRegistration(name)
    await rm(directory, { recursive: true, force: true })
  }
}, 20000)
