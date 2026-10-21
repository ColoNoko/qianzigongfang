import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'
import { localArchive } from '../local-release.mjs'
import { writeZip } from '../pack-archive.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'qianzi-release-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function put(root, path, content = path) {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), content)
}
function unzip(path) {
  const zip = readFileSync(path),
    entries = new Map()
  let cursor = 0
  while (zip.readUInt32LE(cursor) === 0x04034b50) {
    const method = zip.readUInt16LE(cursor + 8)
    const size = zip.readUInt32LE(cursor + 18)
    const length = zip.readUInt16LE(cursor + 26)
    const name = zip.subarray(cursor + 30, cursor + 30 + length).toString('utf8')
    const start = cursor + 30 + length + zip.readUInt16LE(cursor + 28)
    const payload = zip.subarray(start, start + size)
    entries.set(name, (method === 8 ? inflateRawSync(payload) : payload).toString())
    cursor = start + size
  }
  assert.equal(zip.readUInt32LE(cursor), 0x02014b50)
  return entries
}

test('all package node-script references exist, and builders never auto-publish', () => {
  const { scripts } = JSON.parse(readFileSync(join(repository, 'package.json')))
  for (const command of Object.values(scripts)) {
    for (const match of command.matchAll(/node (scripts\/[^\s]+\.mjs)/g))
      assert.ok(existsSync(join(repository, match[1])), match[1])
    if (command.includes('electron-builder --'))
      assert.ok(command.includes('--publish never'), command)
  }
})

test('source dry-run has no side effects and excludes local data, secrets, outputs and backups', (t) => {
  const root = fixture(t)
  for (const name of [
    'src/main.ts',
    'scripts/task.mjs',
    'README.md',
    'pnpm-lock.yaml',
    '.git/config',
    '.env',
    'latest.json',
    'SOURCE_SNAPSHOT_REPORT.json',
    'src/data/private.json',
    'src/private.db',
    'src/private.sqlite-wal',
    'src/.local-backups/secret',
    'src/task.ts.bak-old',
    'release/old.zip',
    'node_modules/pkg/index.js',
    'out/main.js',
    '.local-backups/source.zip'
  ])
    put(root, name)
  const result = localArchive(root, 'source', true)
  assert.deepEqual(result.files, ['README.md', 'pnpm-lock.yaml', 'scripts/task.mjs', 'src/main.ts'])
  assert.equal(existsSync(result.target), false)
  assert.equal(
    readFileSync(join(root, '.local-backups/source.zip'), 'utf8'),
    '.local-backups/source.zip'
  )
})

test('source export produces readable deterministic ZIP, backs up previous source, preserves original files', (t) => {
  const root = fixture(t)
  put(root, 'src/中文.ts', 'repeat '.repeat(100))
  const first = localArchive(root, 'source')
  const bytes = readFileSync(first.target)
  assert.deepEqual([...unzip(first.target)], [['src/中文.ts', 'repeat '.repeat(100)]])
  localArchive(root, 'source')
  assert.deepEqual(readFileSync(first.target), bytes)
  const backup = readdirSync(join(root, '.local-backups'))
  assert.equal(backup.length, 1)
  assert.deepEqual(readFileSync(join(root, '.local-backups', backup[0])), bytes)
  assert.equal(readFileSync(join(root, 'src/中文.ts'), 'utf8'), 'repeat '.repeat(100))
})

test('folder delivery excludes and preserves user data and local backups', (t) => {
  const root = fixture(t),
    app = join(root, 'release/latest/win-unpacked')
  for (const name of [
    '汉化工坊.exe',
    'resources/app.asar',
    'data/main.sqlite',
    'data/user-settings.json',
    '.local-backups/old.zip',
    'logs/app.log',
    'temp/a',
    'config.bak-old'
  ])
    put(app, name)
  const result = localArchive(root, 'app')
  assert.deepEqual([...unzip(result.target).keys()], ['resources/app.asar', '汉化工坊.exe'])
  for (const name of ['data/main.sqlite', 'data/user-settings.json', '.local-backups/old.zip'])
    assert.equal(readFileSync(join(app, name), 'utf8'), name)
})

test('missing build and unsupported launch fail without creating release artifacts', (t) => {
  const root = fixture(t)
  assert.throws(() => localArchive(root, 'app', true), /build:win:unpack/)
  const child = spawnSync(
    process.execPath,
    [join(repository, 'scripts/deliver-windows.mjs'), '--launch'],
    { cwd: root, encoding: 'utf8' }
  )
  assert.notEqual(child.status, 0)
  assert.match(child.stderr, /Unsupported argument/)
  assert.equal(existsSync(join(root, 'release')), false)
})

test('entry-point dry-run resolves from a clean checkout fixture', (t) => {
  const root = fixture(t)
  put(root, 'package.json', '{}')
  const child = spawnSync(
    process.execPath,
    [join(repository, 'scripts/export-windows-source.mjs'), '--dry-run'],
    { cwd: root, encoding: 'utf8' }
  )
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout).files, ['package.json'])
  assert.equal(existsSync(join(root, 'release')), false)
})

test('source symlinks cannot leak external files', (t) => {
  const root = fixture(t)
  put(root, 'README.md')
  const outside = fixture(t)
  put(outside, 'private.txt', 'private')
  symlinkSync(outside, join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => localArchive(root, 'source'), /symbolic link/)
  assert.equal(existsSync(join(root, 'release')), false)
})

test('linked release output cannot redirect writes', (t) => {
  const root = fixture(t),
    outside = fixture(t)
  put(root, 'README.md')
  symlinkSync(outside, join(root, 'release'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => localArchive(root, 'source'), /linked output/)
  assert.deepEqual(readdirSync(outside), [])
})

test('failed export leaves prior artifact and backups untouched', (t) => {
  const root = fixture(t)
  put(root, 'src/app.ts')
  const first = localArchive(root, 'source')
  const before = readFileSync(first.target)
  const outside = fixture(t)
  put(outside, 'private.txt', 'private')
  symlinkSync(outside, join(root, 'src/leak'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => localArchive(root, 'source'), /symbolic link/)
  assert.deepEqual(readFileSync(first.target), before)
  assert.equal(existsSync(join(root, '.local-backups')), false)
})

test('standalone ZIP refuses overwrite and reports bad output path promptly', (t) => {
  const root = fixture(t)
  put(root, 'app/main.exe')
  put(root, 'existing.zip', 'keep')
  assert.throws(() => writeZip(join(root, 'existing.zip'), join(root, 'app')), /EEXIST/)
  assert.equal(readFileSync(join(root, 'existing.zip'), 'utf8'), 'keep')
  const child = spawnSync(
    process.execPath,
    [
      join(repository, 'scripts/pack-archive.mjs'),
      join(root, 'missing/output.zip'),
      join(root, 'app')
    ],
    { timeout: 3000, encoding: 'utf8' }
  )
  assert.notEqual(child.status, 0)
  assert.equal(child.error, undefined)
  assert.match(child.stderr, /ENOENT/)
})

test('source preserves safe dependency hoisting config but rejects private npm settings', (t) => {
  const root = fixture(t)
  put(root, '.npmrc', 'shamefully-hoist=true\n')
  assert.deepEqual(localArchive(root, 'source', true).files, ['.npmrc'])
  put(root, '.npmrc', '//example.test/:_authToken=private\n')
  assert.throws(() => localArchive(root, 'source'), /Review .npmrc/)
  put(root, '.npmrc', '# private-token-in-comment\nshamefully-hoist=true\n')
  assert.throws(() => localArchive(root, 'source'), /Review .npmrc/)
  assert.equal(existsSync(join(root, 'release')), false)
})
