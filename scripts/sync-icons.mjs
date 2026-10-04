import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..')
const SOURCE_ICON = join(PROJECT_ROOT, 'icon.png')
const BUILD_DIR = join(PROJECT_ROOT, 'build')
const RUNTIME_DIR = join(PROJECT_ROOT, 'resources')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

function resizeWithSips(source, output, size) {
  execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', output], {
    stdio: 'ignore'
  })
}

function resizeWithPowerShell(source, output, size) {
  const escape = (value) => value.replace(/'/g, "''")
  const script = `
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Image]::FromFile('${escape(source)}')
try {
  $bitmap = New-Object Drawing.Bitmap(${size}, ${size})
  try {
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.DrawImage($source, 0, 0, ${size}, ${size})
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Save('${escape(output)}', [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $source.Dispose()
}
`
  execFileSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')
    ],
    { stdio: 'ignore', windowsHide: true }
  )
}

function resizePng(source, output, size) {
  if (process.platform === 'darwin') {
    resizeWithSips(source, output, size)
    return
  }
  if (process.platform === 'win32') {
    resizeWithPowerShell(source, output, size)
    return
  }
  throw new Error('Icon resizing currently supports macOS and Windows.')
}

async function createWindowsIco(tempDirectory) {
  const images = []
  for (const size of ICO_SIZES) {
    const output = join(tempDirectory, `icon-${size}.png`)
    resizePng(SOURCE_ICON, output, size)
    images.push({ size, data: await readFile(output) })
  }

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const entries = Buffer.alloc(images.length * 16)
  let dataOffset = header.length + entries.length
  images.forEach(({ size, data }, index) => {
    const offset = index * 16
    entries.writeUInt8(size === 256 ? 0 : size, offset)
    entries.writeUInt8(size === 256 ? 0 : size, offset + 1)
    entries.writeUInt8(0, offset + 2)
    entries.writeUInt8(0, offset + 3)
    entries.writeUInt16LE(1, offset + 4)
    entries.writeUInt16LE(32, offset + 6)
    entries.writeUInt32LE(data.length, offset + 8)
    entries.writeUInt32LE(dataOffset, offset + 12)
    dataOffset += data.length
  })

  await writeFile(
    join(BUILD_DIR, 'icon.ico'),
    Buffer.concat([header, entries, ...images.map((item) => item.data)])
  )
}

async function createMacIcns(tempDirectory) {
  const variants = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024]
  ]
  const chunks = []
  for (const [type, size] of variants) {
    const output = join(tempDirectory, `icns-${size}.png`)
    resizePng(SOURCE_ICON, output, size)
    const data = await readFile(output)
    const chunkHeader = Buffer.alloc(8)
    chunkHeader.write(type, 0, 4, 'ascii')
    chunkHeader.writeUInt32BE(data.length + 8, 4)
    chunks.push(chunkHeader, data)
  }

  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
  await writeFile(join(BUILD_DIR, 'icon.icns'), Buffer.concat([header, ...chunks]))
}

async function main() {
  await Promise.all([
    mkdir(BUILD_DIR, { recursive: true }),
    mkdir(RUNTIME_DIR, { recursive: true })
  ])
  resizePng(SOURCE_ICON, join(BUILD_DIR, 'icon.png'), 512)
  resizePng(SOURCE_ICON, join(RUNTIME_DIR, 'icon.png'), 512)

  const tempDirectory = await mkdtemp(join(tmpdir(), 'qianzi-icons-'))
  try {
    await createWindowsIco(tempDirectory)
    await createMacIcns(tempDirectory)
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }

  console.log('Icons synchronized from icon.png.')
}

await main()
