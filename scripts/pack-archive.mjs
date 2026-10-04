#!/usr/bin/env node
/**
 * pack-archive.mjs — 只用 Node 内置模块打一个 zip（`deliver-windows.mjs --archive=zip`
 * 在**找不到任何 7-Zip** 时的兜底归档器）。
 *
 * 为什么需要它：正常情况下 `deliver-windows.mjs` 会找到 7-Zip（PATH 上自己装的，
 * 或 `electron-winstaller` 依赖树里自带的 `vendor/7z.exe`），用 LZMA2 压到约 63 MB。
 * 但那是**尽力而为**——传递依赖的路径将来可能变。这条兜底保证"即使一个 7z 都没有，
 * `--archive` 也不会失败"，代价只是 deflate 比 LZMA2 多出约 24 MB。
 *
 * 存在理由（为什么不直接用 PowerShell `Compress-Archive`）：本机实测 PowerShell 5.1 +
 * .NET 4.0，`Compress-Archive` **不支持 LZMA**（`CompressionLevel` 只有
 * Optimal/Fastest/NoCompression），而且它对"5 万个小文件 + 中文长路径"会明显变慢。
 * Node 内置 zlib 走 libuv，长路径和中文都不需要额外处理。
 *
 * 用法：node scripts/pack-archive.mjs <输出.zip> <源目录>
 *
 * ⚠️ 刻意**不支持**排除清单参数：调用方（deliver 脚本）传的三个东西
 *    （data / temp / *.bak-*）在这里按同样的规则硬编码，免得两边规则漂移。
 *    归档内容 = `app/` 的**程序本体**，用户数据一律不进包。
 */
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const [target, source] = process.argv.slice(2)
if (!target || !source) {
  console.error('用法：node scripts/pack-archive.mjs <输出.zip> <源目录>')
  process.exit(1)
}
if (!existsSync(source)) {
  console.error(`源目录不存在：${source}`)
  process.exit(1)
}

/** 与 deliver 脚本的 `-xr!` 排除项保持同一口径。 */
const EXCLUDED_DIRS = new Set(['data', 'temp', 'logs'])
const isExcludedFile = (name) => name.includes('.bak-') || name === 'delivery-record.json'

/** CRC-32（zip 每个条目都要）。查表一次，之后按字节查。 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

/** 递归收集要进包的文件（相对路径，统一用 `/` 分隔 —— zip 规范如此）。 */
function collectFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue
      collectFiles(full, base, out)
    } else if (entry.isFile()) {
      if (isExcludedFile(entry.name)) continue
      out.push(relative(base, full).split(sep).join('/'))
    }
  }
  return out
}

/**
 * zip 里所有时间戳都写死成 `1980-01-01 00:00:00`（DOS 时间能表示的最小值）。
 *
 * 为什么不用真实 mtime：真实 mtime 会让**每次**打包的字节都不同，没法做"同一份源码
 * 两次打包 md5 是否一致"的校验；而且交付包的时间戳本来也没有语义。
 */
const DOS_TIME = 0
const DOS_DATE = 0x0021

const files = collectFiles(source)
console.log(`  打包 ${files.length} 个文件 → ${target}`)

const out = createWriteStream(target)
// ⚠️ error 监听器**只挂一次**。早先的写法是在每次 write 里 `out.once('error', ...)`，
//    归档 app/ 那种五万文件量级会直接撞上 Node 的 MaxListenersExceededWarning
//    （实测在小样本上就已经报 "11 error listeners added"）。
let writeFailure = null
out.on('error', (error) => {
  writeFailure = error
})
const write = (buffer) =>
  new Promise((resolveWrite, rejectWrite) => {
    if (writeFailure) {
      rejectWrite(writeFailure)
      return
    }
    if (out.write(buffer)) {
      resolveWrite()
      return
    }
    out.once('drain', resolveWrite)
  })

const central = []
let offset = 0

for (const name of files) {
  const full = join(source, name.split('/').join(sep))
  const raw = statSync(full).size
  const content = readFileSync(full)
  const deflated = deflateRawSync(content, { level: 9 })
  // 压不小就存原始数据（zip 允许逐条选方法）：小文件/已压缩文件常见这种情形。
  const stored = deflated.length >= content.length
  const payload = stored ? content : deflated
  const method = stored ? 0 : 8
  const nameBuffer = Buffer.from(name, 'utf8')
  const crc = crc32(content)

  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0) // 本地文件头签名
  localHeader.writeUInt16LE(20, 4) // 解压所需版本 2.0
  localHeader.writeUInt16LE(0x0800, 6) // 通用位标志：文件名是 UTF-8
  localHeader.writeUInt16LE(method, 8)
  localHeader.writeUInt16LE(DOS_TIME, 10)
  localHeader.writeUInt16LE(DOS_DATE, 12)
  localHeader.writeUInt32LE(crc, 14)
  localHeader.writeUInt32LE(payload.length, 18)
  localHeader.writeUInt32LE(raw, 22)
  localHeader.writeUInt16LE(nameBuffer.length, 26)
  localHeader.writeUInt16LE(0, 28) // 无扩展字段

  await write(localHeader)
  await write(nameBuffer)
  await write(payload)

  central.push({ nameBuffer, method, crc, compressed: payload.length, raw, offset })
  offset += localHeader.length + nameBuffer.length + payload.length
}

const centralStart = offset
for (const item of central) {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0) // 中央目录头签名
  header.writeUInt16LE(20, 4) // 打包工具版本
  header.writeUInt16LE(20, 6) // 解压所需版本
  header.writeUInt16LE(0x0800, 8)
  header.writeUInt16LE(item.method, 10)
  header.writeUInt16LE(DOS_TIME, 12)
  header.writeUInt16LE(DOS_DATE, 14)
  header.writeUInt32LE(item.crc, 16)
  header.writeUInt32LE(item.compressed, 20)
  header.writeUInt32LE(item.raw, 24)
  header.writeUInt16LE(item.nameBuffer.length, 28)
  header.writeUInt16LE(0, 30) // 扩展字段
  header.writeUInt16LE(0, 32) // 注释
  header.writeUInt16LE(0, 34) // 起始磁盘
  header.writeUInt16LE(0, 36) // 内部属性
  header.writeUInt32LE(0, 38) // 外部属性
  header.writeUInt32LE(item.offset, 42)
  await write(header)
  await write(item.nameBuffer)
  offset += header.length + item.nameBuffer.length
}

const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0) // 中央目录结束记录
end.writeUInt16LE(0, 4)
end.writeUInt16LE(0, 6)
end.writeUInt16LE(central.length, 8)
end.writeUInt16LE(central.length, 10)
end.writeUInt32LE(offset - centralStart, 12)
end.writeUInt32LE(centralStart, 16)
end.writeUInt16LE(0, 20)
await write(end)

await new Promise((resolveEnd) => out.end(resolveEnd))
console.log(`  完成：${(statSync(target).size / 1048576).toFixed(1)} MB`)
