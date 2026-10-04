import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  LabelPlusPreviewMode,
  LabelPlusPreviewOpenRequest,
  LabelPlusPreviewPage,
  LabelPlusPreviewSessionInfo
} from '@shared/labelplus-import'
import {
  prepareLabelPlusPreviewContext,
  renderLabelPlusPreviewPage,
  type LabelPlusPreviewContext
} from './labelplus-import-service'

interface PreviewSession {
  info: LabelPlusPreviewSessionInfo
  mode: LabelPlusPreviewMode
  context: LabelPlusPreviewContext
  pages: Map<number, LabelPlusPreviewPage>
  window: BrowserWindow | null
}

const sessions = new Map<string, PreviewSession>()

function previewTitle(mode: LabelPlusPreviewMode): string {
  return mode === 'source' ? 'LabelPlus 原图预览' : 'LabelPlus 输出效果预览'
}

export async function openLabelPlusPreviewWindow(
  request: LabelPlusPreviewOpenRequest,
  parentWindow?: BrowserWindow | null
): Promise<{ opened: boolean; sessionId?: string; message?: string }> {
  const context = await prepareLabelPlusPreviewContext(request)
  if (request.mode === 'output' && request.previewOutputPaths) {
    const outputRows = context.rows.filter(
      (row) => Boolean(request.previewOutputPaths?.[row.labelImageName])
    )
    context.rows = outputRows
    if (outputRows.length === 0) {
      return { opened: false, message: '没有可预览的已生成 PSD' }
    }
  }
  if (context.rows.length === 0) {
    return { opened: false, message: '没有可预览的已匹配图源' }
  }
  const sessionId = randomUUID()
  const initialIndex = Math.max(
    0,
    context.rows.findIndex((row) => row.labelImageName === request.initialImageName)
  )
  const info: LabelPlusPreviewSessionInfo = {
    sessionId,
    mode: request.mode,
    title: previewTitle(request.mode),
    initialIndex,
    items: context.rows.map((row) => ({
      labelImageName: row.labelImageName,
      sourceFileName: row.sourceFileName || row.labelImageName
    }))
  }
  const session: PreviewSession = {
    info,
    mode: request.mode,
    context,
    pages: new Map(),
    window: null
  }
  sessions.set(sessionId, session)

  const previewWindow = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: info.title,
    autoHideMenuBar: true,
    parent: parentWindow ?? undefined,
    modal: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  session.window = previewWindow
  previewWindow.on('ready-to-show', () => previewWindow.show())
  previewWindow.on('closed', () => {
    sessions.delete(sessionId)
  })

  const hash = `/labelplus-preview/${encodeURIComponent(sessionId)}`
  try {
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      await previewWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
    } else {
      await previewWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }
  } catch (error) {
    sessions.delete(sessionId)
    if (!previewWindow.isDestroyed()) previewWindow.close()
    return {
      opened: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
  return { opened: true, sessionId }
}

export function getLabelPlusPreviewSession(sessionId: string): LabelPlusPreviewSessionInfo | null {
  return sessions.get(sessionId)?.info ?? null
}

export async function getLabelPlusPreviewPage(
  sessionId: string,
  index: number
): Promise<LabelPlusPreviewPage> {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('预览窗口已关闭或不存在')
  const safeIndex = Math.max(0, Math.min(session.info.items.length - 1, Math.trunc(index)))
  const cached = session.pages.get(safeIndex)
  if (cached) return cached
  const page = await renderLabelPlusPreviewPage(session.context, safeIndex, session.mode)
  session.pages.set(safeIndex, page)
  return page
}

export function clearLabelPlusPreviewSessions(): void {
  for (const session of sessions.values()) {
    if (session.window && !session.window.isDestroyed()) session.window.close()
  }
  sessions.clear()
}
