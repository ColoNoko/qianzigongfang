import { app } from 'electron'
import { appendFile, mkdir, open, stat } from 'fs/promises'
import { join } from 'path'
import type { LogEntry } from '@shared/ipc-api'

function getLogBaseDir(): string {
  if (!app.isPackaged) return process.cwd()
  try {
    return app.getPath('userData')
  } catch {
    return process.cwd()
  }
}

export function getLogPath(): string {
  return join(getLogBaseDir(), 'logs', 'psd-manager.log')
}

/** 诊断面板最多读回多少字节的日志（只读尾部，日志可能有几十 MB）。 */
export const LOG_TAIL_MAX_BYTES = 200_000

/**
 * 读日志尾部（D2：应用内诊断）。
 *
 * 只读文件末尾的一段（默认 200 KB），并把第一行截断掉 —— 它多半是被切开的半行。
 * 读不到（没有日志 / 权限）返回空串，**不抛**：诊断面板打不开比没有日志更糟。
 */
export async function readLogTail(maxBytes = LOG_TAIL_MAX_BYTES): Promise<string> {
  const logPath = getLogPath()
  try {
    const info = await stat(logPath)
    const start = Math.max(0, info.size - Math.max(1024, Math.floor(maxBytes)))
    const length = info.size - start
    const handle = await open(logPath, 'r')
    try {
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, start)
      const text = buffer.toString('utf8')
      if (start === 0) return text
      const firstBreak = text.indexOf('\n')
      return firstBreak >= 0 ? text.slice(firstBreak + 1) : text
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/** 日志文件有多大（诊断面板显示"日志文件 12.3 MB"）。 */
export async function getLogSize(): Promise<number> {
  try {
    return (await stat(getLogPath())).size
  } catch {
    return 0
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify(String(value))
  }
}

export async function writeLog(entry: LogEntry): Promise<void> {
  const baseDir = getLogBaseDir()
  const logPath = join(baseDir, 'logs', 'psd-manager.log')
  await mkdir(join(baseDir, 'logs'), { recursive: true })
  const line = [
    new Date().toISOString(),
    entry.level.toUpperCase(),
    `[${entry.scope}]`,
    entry.message,
    entry.data === undefined ? '' : safeJson(entry.data)
  ].filter(Boolean).join(' ')
  await appendFile(logPath, `${line}\n`, 'utf8')
}

