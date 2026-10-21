/**
 * 「另存一份译文」（译文栏改版第 3 批，2026-10-06）—— 把**当前翻译**另存到用户选的位置。
 *
 * ## 它和"保存"的分工（本模块存在的全部理由）
 *
 * | | 写哪 | 走哪条路 |
 * |---|---|---|
 * | 保存 | 用户话目录里那份 txt | `chapter-translation-write`（指纹 / 备份 / 原子写 / 回读，**全项目唯一**会写话目录的地方） |
 * | 另存 | **用户自己选的位置**（桌面 / 给别人的文件夹…） | 这里 |
 *
 * ⇒ 所以这里**不比对基指纹、也不留备份**：它不是"改用户的原件"，是一次导出。
 * 但它仍然 **① 原子写 ② 写后回读**（写完读回来与预期不一致就如实报错，不假装成功）。
 *
 * ## "复制原文件 + 原地改"是什么意思
 *
 * 用户拍板的口径。落在这里就是：
 * · **没有待写改动** ⇒ 直接把原文件**按字节**读出来当载荷（真·复制：BOM、换行风格、
 *   连"不是合法 UTF-8 的字节"都原样过去 —— 解码成字符串再编码回去会把它们弄成另一份东西）；
 * · **有待写改动** ⇒ 走既有的纯函数 `rewriteChapterTranslationText`（P2 那套**原地改行**），
 *   它只替换被改的那几行、其余行原样拼回，所以头部那两行 `翻译：` / `校对：`（译者 / 校对者
 *   的**名字**，parser 根本不解析它们）、坐标小数位、BOM、换行风格**全都自动保住**。
 *   **这里不写第二份改写逻辑**：文件格式这件事只允许一处实现。
 *
 * ## 一条硬安全线：不许另存到**原件本身**
 *
 * 目标路径若与源文件是同一个文件，**直接拒绝**（不弹框）。理由：那等于绕过"保存"那条通道
 * 去写用户的原件 —— 没有备份、没有冲突检查，一次误点就把唯一会写话目录的通道变成了两个。
 * 想要写回原件，界面上有「保存」。
 */
import { BrowserWindow, dialog } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import type {
  ChapterTranslationExportRequest,
  ChapterTranslationExportResult
} from '@shared/chapter-translation'
import { buildEmptyChapterTranslationText } from '@shared/chapter-translation'
import { publishOutput } from './atomic-output'
import { rewriteChapterTranslationText } from './chapter-translation-rewrite'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 路径比较用（Windows 不分大小写、分隔符混用；只用于"是不是同一个文件"这**一个**判断）。 */
function samePath(left: string, right: string): boolean {
  const normalizeKey = (value: string): string =>
    normalize(resolve(value))
      .replace(/[\\/]+$/, '')
      .toLocaleLowerCase()
  return normalizeKey(left) === normalizeKey(right)
}

function joinedDefaultPath(request: ChapterTranslationExportRequest): string {
  const name = String(request?.defaultFileName ?? '').trim() || '译文.txt'
  const directory = String(request?.defaultDirectory ?? '').trim()
  return directory ? join(directory, name) : name
}

/** 载荷：有待写改动就"原地改行"，没有就**按字节复制**（见文件头）。 */
async function buildPayload(
  request: ChapterTranslationExportRequest,
  sourcePath: string | null
): Promise<
  | { ok: true; bytes: Buffer; generated: boolean }
  | { ok: false; kind: 'invalid' | 'io'; message: string }
> {
  const edits = Array.isArray(request?.edits) ? request.edits : []

  if (!sourcePath) {
    // 从零生成：这一话连一份能解析的 txt 都没有
    const pages = (Array.isArray(request?.pages) ? request.pages : [])
      .map((page) => String(page ?? '').trim())
      .filter(Boolean)
    if (pages.length === 0) {
      return {
        ok: false,
        kind: 'invalid',
        message: '这一话没有页面，也没有可用的 txt —— 没有东西可以另存。'
      }
    }
    return {
      ok: true,
      bytes: Buffer.from(buildEmptyChapterTranslationText(pages), 'utf8'),
      generated: true
    }
  }

  if (edits.length === 0) {
    try {
      return { ok: true, bytes: await readFile(sourcePath), generated: false }
    } catch (error) {
      return { ok: false, kind: 'io', message: `读不了这一话的 txt：${describeError(error)}` }
    }
  }

  let raw: string
  try {
    raw = await readFile(sourcePath, 'utf8')
  } catch (error) {
    return { ok: false, kind: 'io', message: `读不了这一话的 txt：${describeError(error)}` }
  }
  const rewritten = rewriteChapterTranslationText(raw, edits)
  if (!rewritten.ok) {
    // **整份拒绝**（不是"跳过那一条"）：另存出来的东西少一条，比不出这份更糟 ——
    // 用户会把它当成完整的译文发出去。
    return { ok: false, kind: 'invalid', message: `没有另存：${rewritten.reason}` }
  }
  return { ok: true, bytes: Buffer.from(rewritten.text, 'utf8'), generated: false }
}

export async function exportChapterTranslation(
  request: ChapterTranslationExportRequest
): Promise<ChapterTranslationExportResult> {
  const sourcePath =
    typeof request?.sourcePath === 'string' && request.sourcePath.trim()
      ? request.sourcePath.trim()
      : null

  // ①② 先算内容再弹框：内容是"这份文件长什么样"，与用户选哪没关系；
  //     而且**算不出来时不该先让用户挑半天位置**。
  const payload = await buildPayload(request, sourcePath)
  if (!payload.ok) return { ok: false, kind: payload.kind, message: payload.message }

  const win = BrowserWindow.getFocusedWindow()
  const options: Electron.SaveDialogOptions = {
    title: '另存译文',
    defaultPath: joinedDefaultPath(request),
    filters: [
      { name: 'LabelPlus 文本', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  }
  const picked = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  // 用户取消**不是失败**：界面一个字都不该说。
  if (picked.canceled || !picked.filePath) return { ok: false, kind: 'canceled', message: '' }

  // ③ 安全线：不许另存到原件本身（见文件头最后一段）
  if (sourcePath && samePath(picked.filePath, sourcePath)) {
    return {
      ok: false,
      kind: 'invalid',
      message:
        '那是这一话的原文本身。要写回原件请用「保存」（它有备份与冲突检查），另存请换一个位置。'
    }
  }

  // ④ 原子写（临时文件 → fsync → rename：任何一步失败，目标位置上不会留半份文件）
  try {
    await publishOutput(picked.filePath, payload.bytes, true)
  } catch (error) {
    return { ok: false, kind: 'io', message: `另存失败：${describeError(error)}` }
  }

  // ⑤ 写后回读：读完与写出的字节不一致就如实报错（不假装成功）
  try {
    const written = await readFile(picked.filePath)
    if (!written.equals(payload.bytes)) {
      return {
        ok: false,
        kind: 'io',
        message: `另存后读回来的内容与写出去的不一致：${picked.filePath}`
      }
    }
  } catch (error) {
    return { ok: false, kind: 'io', message: `另存后读不回来：${describeError(error)}` }
  }

  return {
    ok: true,
    path: picked.filePath,
    bytes: payload.bytes.length,
    generated: payload.generated
  }
}
