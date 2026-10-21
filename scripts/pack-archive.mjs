#!/usr/bin/env node
// Deterministic ZIP32 archive writer. No external archiver; refuses symlinks and excludes user data.
import {
  openSync,
  closeSync,
  writeSync,
  fsyncSync,
  rmSync,
  readFileSync,
  statSync,
  lstatSync
} from 'node:fs'
import { join, sep, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { collectFiles } from './archive-policy.mjs'

/** CRC-32（zip 每个条目都要）。查表一次，之后按字节查。 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
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

export function writeZip(target, source, mode = 'app') {
  /**
   * zip 里所有时间戳都写死成 `1980-01-01 00:00:00`（DOS 时间能表示的最小值）。
   *
   * 为什么不用真实 mtime：真实 mtime 会让**每次**打包的字节都不同，没法做"同一份源码
   * 两次打包 md5 是否一致"的校验；而且交付包的时间戳本来也没有语义。
   */
  const DOS_TIME = 0
  const DOS_DATE = 0x0021

  const files = collectFiles(source, mode)
  if (files.length > 65535) throw new Error('ZIP64 required: too many files')
  console.log(`  打包 ${files.length} 个文件 → ${target}`)

  const fd = openSync(target, 'wx')
  const write = (buffer) => {
    let written = 0
    while (written < buffer.length)
      written += writeSync(fd, buffer, written, buffer.length - written)
  }
  try {
    const central = []
    let offset = 0

    for (const name of files) {
      const full = join(source, name.split('/').join(sep))
      if (lstatSync(full).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${name}`)
      const raw = statSync(full).size
      if (raw > 0xffffffff) throw new Error('ZIP64 required: file too large')
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

      write(localHeader)
      write(nameBuffer)
      write(payload)

      if (offset + localHeader.length + nameBuffer.length + payload.length > 0xffffffff)
        throw new Error('ZIP64 required: archive too large')
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
      write(header)
      write(item.nameBuffer)
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
    write(end)

    fsyncSync(fd)
  } catch (error) {
    closeSync(fd)
    rmSync(target, { force: true })
    throw error
  }
  closeSync(fd)
  console.log(`  完成：${(statSync(target).size / 1048576).toFixed(1)} MB`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [target, source, ...extra] = process.argv.slice(2)
  if (!target || !source || extra.length)
    throw new Error('Usage: node scripts/pack-archive.mjs <new-output.zip> <source-directory>')
  writeZip(target, source)
}
