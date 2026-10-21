export interface TranslationCredits {
  translator: string
  proofreader: string
  source?: string
  typesetter?: string
  supervisor?: string
  initialized?: boolean
  combined: boolean
}

// LabelPlus permits comments after the second header separator. Never inspect
// image bodies: translated dialogue can contain the same words as these fields.
function headerRange(text: string): { start: number; end: number } | null {
  const image = /^>{6,}\[/m.exec(text)
  if (!image) return null
  const separators = [...text.slice(0, image.index).matchAll(/^-[ \t]*\r?$/gm)]
  if (separators.length < 2) return null
  const separator = separators[1]
  const start = separator.index! + separator[0].length
  return { start, end: image.index }
}
const field = /^(图源|翻译|校对|嵌字|监修|翻校一体|署名已编辑|翻译\s*[/／?？、&＆+＋与和]\s*校对)[：:][ \t]*(.*)$/
export function readTranslationCredits(text: string): TranslationCredits {
  const result: TranslationCredits = { translator: '', proofreader: '', combined: false }
  const range = headerRange(text)
  if (!range) return result
  for (const line of text.slice(range.start, range.end).split(/\r?\n/)) {
    const match = field.exec(line)
    if (match && /^翻译\s*[/／?？、&＆+＋与和]\s*校对$/.test(match[1])) {
      result.translator = match[2].trim()
      result.proofreader = match[2].trim()
      result.combined = true
    }
    if (match?.[1] === '图源') result.source = match[2].trim()
    if (match?.[1] === '嵌字') result.typesetter = match[2].trim()
    if (match?.[1] === '监修') result.supervisor = match[2].trim()
    if (match?.[1] === '署名已编辑') result.initialized = match[2].trim() === '是'
    if (match?.[1] === '翻译') result.translator = match[2].trim()
    if (match?.[1] === '校对') result.proofreader = match[2].trim()
    if (match?.[1] === '翻校一体') result.combined = match[2].trim() === '是'
  }
  return result
}
export function rewriteTranslationCredits(text: string, credits: TranslationCredits): string {
  const range = headerRange(text)
  if (!range) throw new Error('译文文件头格式不支持署名编辑')
  if (!credits || typeof credits.combined !== 'boolean' ||
      [credits.translator, credits.proofreader, credits.source ?? '', credits.typesetter ?? '', credits.supervisor ?? ''].some(name => typeof name !== 'string' || name.length > 120 || /[\r\n\x00-\x1f]/.test(name))) {
    throw new Error('署名须为单行文本，最多 120 字')
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const comments = text.slice(range.start, range.end).split(/\r?\n/).filter(line => !field.test(line))
  while (comments.length && !comments[0]) comments.shift()
  while (comments.length && !comments[comments.length - 1]) comments.pop()
  const previous = readTranslationCredits(text)
  const extras = { ...previous, ...credits }
  const translator = credits.translator.trim()
  const proofreader = credits.combined ? translator : credits.proofreader.trim()
  const extraLines = (['source', 'typesetter', 'supervisor'] as const).filter(key => extras[key] !== undefined).map(key => `${{source:'图源',typesetter:'嵌字',supervisor:'监修'}[key]}：${extras[key]?.trim() ?? ''}`)
  if (extras.initialized) extraLines.push('署名已编辑：是')
  const translationLines = credits.combined ? [`翻译/校对：${translator}`] : [`翻译：${translator}`, `校对：${proofreader}`]
  const header = [...comments, ...extraLines, ...translationLines].join(newline)
  return text.slice(0, range.start) + newline + header + newline + text.slice(range.end)
}

export function initialTranslationCredits(current: TranslationCredits, previous: Partial<TranslationCredits>, mode: string, name: string): TranslationCredits {
  const fromFileEachTime = mode === 'typeset' || mode === 'supervised'
  if (current.initialized && !fromFileEachTime) return { ...current }
  const own = ({ translated: 'translator', proofread: 'proofreader', typeset: 'typesetter', supervised: 'supervisor' } as const)[mode as 'translated' | 'proofread' | 'typeset' | 'supervised']
  const result = { ...current }
  for (const key of ['source', 'translator', 'proofreader', 'typesetter', 'supervisor'] as const) {
    if (!result[key]?.trim()) result[key] = (!fromFileEachTime && key === own ? name.trim() : '') || (typeof previous[key] === 'string' ? previous[key].trim() : '') || ''
  }
  if (result.combined) result.proofreader = result.translator
  return result
}
export function formatTranslationCredits(credits: TranslationCredits): string {
  return `图源：${credits.source ?? ''}\n翻译：${credits.translator}\n校对：${credits.combined ? credits.translator : credits.proofreader}\n嵌字：${credits.typesetter ?? ''}\n监修：${credits.supervisor ?? ''}`
}
