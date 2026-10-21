import { readdirSync, lstatSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const excluded = new Set([
  'data',
  'temp',
  'logs',
  '.local-backups',
  '.git',
  'node_modules',
  '.pnpm-store',
  '.omo',
  'out',
  'release',
  'dist',
  'cache',
  '.cache'
])
const sourceRoots = new Set(['src', 'resources', 'build', 'scripts', 'doc', 'docs'])
const sourceFiles = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'LICENSE',
  'README.md',
  '.npmrc',
  'AGENTS.md',
  'CHANGELOG.md',
  'components.json',
  'icon.png',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.eslintrc.cjs',
  '.prettierignore',
  '.prettierrc',
  'electron-builder.yml',
  'electron.vite.config.ts',
  'postcss.config.cjs',
  'tailwind.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'vitest.config.ts',
  'vitest.smoke.config.ts',
  'vitest.visual.config.ts'
])

export function permitted(path, mode = 'app') {
  const parts = path.split('/')
  if (parts.some((part) => ['data', 'temp', 'logs', '.local-backups'].includes(part.toLowerCase())))
    return false
  const name = parts.at(-1).toLowerCase()
  if (
    name.includes('.bak-') ||
    /\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/.test(name) ||
    /\.(bak|log|tsbuildinfo)$/.test(name) ||
    name.startsWith('.env') ||
    name === 'delivery-record.json'
  )
    return false
  if (mode === 'source') {
    if (parts.some((part) => excluded.has(part.toLowerCase()))) return false
    return sourceRoots.has(parts[0]) || (parts.length === 1 && sourceFiles.has(path))
  }
  return true
}

export function collectFiles(source, mode = 'app') {
  if (!lstatSync(source).isDirectory())
    throw new Error(`Source must be a real directory: ${source}`)
  const files = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      const full = join(directory, entry.name)
      const name = relative(source, full).split(sep).join('/')
      if (!permitted(name, mode)) continue
      // Never follow links into local data or another workspace.
      if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${name}`)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        if (mode === 'source' && name === '.npmrc') {
          const settings = readFileSync(full, 'utf8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
          if (settings.some((line) => line !== 'shamefully-hoist=true'))
            throw new Error(
              'Review .npmrc before exporting: only shamefully-hoist=true is allowed; credentials and private registries must not be exported'
            )
        }
        files.push(name)
      } else throw new Error(`Unsupported file type: ${name}`)
    }
  }
  walk(source)
  return files
}
