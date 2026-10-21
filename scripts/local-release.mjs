import { existsSync, lstatSync, mkdirSync, copyFileSync, renameSync, rmSync } from 'node:fs'
import { join, dirname, resolve, parse } from 'node:path'
import { randomUUID } from 'node:crypto'
import { collectFiles } from './archive-policy.mjs'
import { writeZip } from './pack-archive.mjs'

function safeDirectory(path) {
  const absolute = resolve(path)
  let current = parse(absolute).root
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part)
    if (
      existsSync(current) &&
      (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink())
    ) {
      throw new Error(`Refusing non-directory or linked output path: ${current}`)
    }
  }
}

export function localArchive(root, mode, dryRun = false) {
  root = resolve(root)
  const source = mode === 'source' ? root : join(root, 'release/latest/win-unpacked')
  safeDirectory(source)
  if (mode === 'app' && !existsSync(join(source, '汉化工坊.exe'))) {
    throw new Error(
      'Missing release/latest/win-unpacked/汉化工坊.exe; run pnpm build:win:unpack first. No build or launch was attempted.'
    )
  }
  const target = join(
    root,
    'release/latest',
    mode === 'source' ? 'qianzi-gongfang-source-latest.zip' : '汉化工坊-latest-文件夹版.zip'
  )
  safeDirectory(dirname(target))
  const files = collectFiles(source, mode)
  if (!files.length) throw new Error('Refusing an empty archive')
  if (dryRun) return { source, target, files, dryRun: true }
  const backups = join(root, '.local-backups')
  safeDirectory(backups)
  if (existsSync(target) && (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()))
    throw new Error(`Refusing non-file target: ${target}`)
  mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    writeZip(temporary, source, mode)
    if (existsSync(target)) {
      mkdirSync(backups, { recursive: true })
      copyFileSync(target, join(backups, `${mode}-${randomUUID()}.zip`))
    }
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
  return { source, target, files, dryRun: false }
}

export function runArchiveCli(mode, args) {
  const allowed = mode === 'app' ? ['--dry-run', '--archive', '--archive=zip'] : ['--dry-run']
  for (const arg of args)
    if (!allowed.includes(arg))
      throw new Error(`Unsupported argument: ${arg}. See doc/本地交付说明.md.`)
  console.log(
    JSON.stringify(localArchive(process.cwd(), mode, args.includes('--dry-run')), null, 2)
  )
}
