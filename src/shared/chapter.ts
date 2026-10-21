/** Keep digits, Han characters and at most one decimal point. */
export function sanitizeChapterInput(value: string): string {
  const allowed = value.normalize('NFC').replace(/[^\d.\p{Script=Han}]/gu, '')
  const dotIndex = allowed.indexOf('.')
  if (dotIndex === -1) return allowed
  return allowed.slice(0, dotIndex + 1) + allowed.slice(dotIndex + 1).replace(/\./g, '')
}

function canonicalNumber(raw: string): string {
  const [integerPart, decimalPart] = raw.split('.')
  const integer = String(Number.parseInt(integerPart, 10))
  if (decimalPart === undefined) return integer

  const decimal = decimalPart.replace(/0+$/, '')
  return decimal ? `${integer}.${decimal}` : integer
}

const hanDigits = '零一二三四五六七八九'
const hanNumber = '[零〇一二两兩三四五六七八九十百千壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]+'
const numberToken = `(?:\\d+(?:\\.\\d+)?|${hanNumber})`

function parseNumber(raw: string): string {
  if (/^\d+(?:\.\d+)?$/.test(raw)) return canonicalNumber(raw)
  const simplified = raw.replace(/[〇两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]/g, char =>
    ({ 〇: '零', 两: '二', 兩: '二', 壹: '一', 贰: '二', 貳: '二', 叁: '三', 參: '三',
      肆: '四', 伍: '五', 陆: '六', 陸: '六', 柒: '七', 捌: '八', 玖: '九', 拾: '十', 佰: '百', 仟: '千' })[char]!)
  if ([...simplified].every(char => hanDigits.includes(char))) {
    return canonicalNumber([...simplified].map(char => hanDigits.indexOf(char)).join(''))
  }
  let total = 0
  let pending: number | undefined
  let previousUnit = 10000
  for (const char of simplified) {
    const digit = hanDigits.indexOf(char)
    if (digit >= 0) {
      if (pending !== undefined && pending !== 0) return ''
      pending = digit
      continue
    }
    const unit = ({ 十: 10, 百: 100, 千: 1000 })[char]
    if (!unit || unit >= previousUnit || pending === 0) return ''
    if (pending === undefined && (unit !== 10 || total !== 0)) return ''
    total += (pending ?? 1) * unit
    previousUnit = unit
    pending = undefined
  }
  return String(total + (pending ?? 0))
}

interface ChapterMatch { chapterNumber: string; start: number; end: number }

/** Ordered semantic rules; independently implemented, informed by Kavita's parser design. */
function findChapter(value: string): ChapterMatch | undefined {
  const text = value.normalize('NFKC')
  // Mask rather than remove, keeping title offsets and preventing adjacent tokens joining.
  let clean = text
  const mask = (pattern: RegExp) => { clean = clean.replace(pattern, token => ' '.repeat(token.length)) }
  mask(/(?<!\d)(?:19|20)\d{2}[-_.年]\d{1,2}[-_.月]\d{1,2}日?(?!\d)/g)
  mask(/(?<!\d)(?:19|20)\d{6}(?!\d)/g)
  mask(/(?<!\d)\d{3,5}\s*[x×]\s*\d{3,5}(?!\d)/gi)
  mask(/(?<![a-z\d])\d{3,4}\s*[pi]\b|\b[248]k\b/gi)
  // A directory consisting solely of a bracketed number is a chapter, not a release tag.
  const bracket = /^\s*(?:\[\s*(\d+(?:\.\d+)?)\s*\]|【\s*(\d+(?:\.\d+)?)\s*】|\(\s*(\d+(?:\.\d+)?)\s*\))\s*$/.exec(clean)
  if (bracket) return { chapterNumber: canonicalNumber(bracket[1] ?? bracket[2] ?? bracket[3]), start: 0, end: text.length }
  const explicit = [
    new RegExp(`第\\s*(${numberToken})(?:\\s*[-~〜～–—至]\\s*(${numberToken}))?\\s*[话話集回章]`, 'g'),
    new RegExp(`(?<![\\p{L}\\d.])(${numberToken})(?:\\s*[-~〜～–—至]\\s*(${numberToken}))?\\s*[话話集回章]`, 'gu'),
    /(?<![a-z\d])(?:chapter|chapters|chp|ch|c|episode|ep)\.?[\s_-]*(\d+(?:\.\d+)?)(?:\s*[-~〜～–—]\s*(\d+(?:\.\d+)?))?(?![a-z\d.])/gi,
    /(?<![a-z\d])#\s*(\d+(?:\.\d+)?)(?:\s*[-~〜～–—]\s*(\d+(?:\.\d+)?))?(?![a-z\d.])/gi
  ]
  const matches: ChapterMatch[] = []
  for (const rule of explicit) for (const match of clean.matchAll(rule)) {
    if (matches.some(existing => match.index! < existing.end && match.index! + match[0].length > existing.start)) continue
    const chapterNumber = parseNumber(match[1])
    // The project's field stores one chapter, not a collection/range.
    if (!chapterNumber || match[2]) return undefined
    matches.push({ chapterNumber, start: match.index!, end: match.index! + match[0].length })
  }
  if (matches.length) return new Set(matches.map(match => match.chapterNumber)).size === 1 ? matches[0] : undefined

  const special = new RegExp(`番外\\s*(${numberToken})((?:\\s*[~～\\-–—]\\s*\\d+(?:\\.\\d+)?|\\s+\\d+(?:\\.\\d+)?)*)`).exec(clean)
  if (special) {
    const value = parseNumber(special[1])
    if (value) return { chapterNumber: `番外${value}`, start: special.index, end: special.index + special[0].length }
  }
  mask(/\d+\s*[岁歲]/g)
  mask(new RegExp(`(?:第\\s*)?${numberToken}\\s*[卷巻册冊]`, 'g'))
  mask(/(?<![a-z\d])(?:vol(?:ume)?\.?|v|s|sp|ver(?:sion)?\.?)\s*\d+(?:\.\d+)?(?![a-z\d])/gi)
  mask(/(?<!\d)\d+(?:\.\d+)?\s*[-~〜～–—至]\s*\d+(?:\.\d+)?(?!\d)/g)
  mask(/\[[^\]]*\]|【[^】]*】|\([^)]*\)/g)
  mask(/(?<!\d)(?:19|20)\d{2}(?!\d)/g)
  const numbers = [...clean.matchAll(/(?<![\d.])\d+(?:\.\d+)?(?![\d.])/g)].filter(match => {
    // Reject numbers glued to Latin words/tags, but retain Chinese titles such as 七龙珠003.
    const start = match.index!
    return !/[a-z]/i.test(clean[start - 1] ?? '') && !/[a-z]/i.test(clean[start + match[0].length] ?? '')
  })
  if (numbers.length !== 1) return undefined
  const match = numbers[0]
  return { chapterNumber: canonicalNumber(match[0]), start: match.index!, end: match.index! + match[0].length }
}

export function extractChapterNumber(value: string): string {
  return findChapter(value)?.chapterNumber ?? ''
}

/** Shared by batch import and background/manual discovery; preserve non-prefix titles. */
export function inferChapterAndTitle(folderName: string): { chapterNumber: string; projectTitle: string } {
  const normalized = folderName.trim().normalize('NFKC')
  const match = findChapter(normalized)
  const tail = match?.start === 0 ? normalized.slice(match.end).replace(/^[\s._\-—–·]+/, '').trim() : ''
  return { chapterNumber: match?.chapterNumber ?? '', projectTitle: tail || folderName.trim() }
}

export function isValidChapterNumber(value: string): boolean {
  const normalized = value.trim().normalize('NFC')
  return (
    normalized.length > 0 &&
    normalized === sanitizeChapterInput(normalized) &&
    !normalized.startsWith('.') &&
    !normalized.endsWith('.')
  )
}

/** Normalize numeric chapters while preserving explicitly entered Chinese labels. */
export function normalizeChapterNumber(value: string): string {
  const sanitized = sanitizeChapterInput(value.trim())
  if (/^\d+(?:\.\d+)?$/.test(sanitized)) return canonicalNumber(sanitized)
  // Keep compatibility with values stored by older builds.
  if (/^第\d+(?:\.\d+)?[集話话]$/.test(sanitized)) return extractChapterNumber(sanitized)
  return sanitized
}

export function formatChapterNumber(value: string): string {
  const chapter = normalizeChapterNumber(value)
  if (!chapter) return '未设置集数'
  return /^\d+(?:\.\d+)?$/.test(chapter) ? `第${chapter}集` : chapter
}

/** Numeric chapters come first; Chinese/custom chapters follow in natural order. */
export function compareChapterNumbers(a: string, b: string): number {
  const left = normalizeChapterNumber(a)
  const right = normalizeChapterNumber(b)
  const leftNumeric = /^\d+(?:\.\d+)?$/.test(left)
  const rightNumeric = /^\d+(?:\.\d+)?$/.test(right)

  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  if (leftNumeric && rightNumeric) {
    const difference = Number(left) - Number(right)
    if (difference !== 0) return difference
  }
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

export type ChildSortOrder = 'ascending' | 'descending'

/**
 * Sort numeric chapters in the selected direction while always keeping
 * Chinese/custom labels after numeric chapters.
 */
export function compareChapterNumbersByOrder(a: string, b: string, order: ChildSortOrder): number {
  const left = normalizeChapterNumber(a)
  const right = normalizeChapterNumber(b)
  const leftNumeric = /^\d+(?:\.\d+)?$/.test(left)
  const rightNumeric = /^\d+(?:\.\d+)?$/.test(right)

  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  const comparison = compareChapterNumbers(left, right)
  return order === 'descending' ? -comparison : comparison
}

export interface ChapterToken { value: string; start: number; end: number }
export function findChapterToken(value: string): ChapterToken | null {
 const found = findChapter(value.trim()); return found ? {value: found.chapterNumber, start: found.start, end: found.end} : null
}
function normalizeNameKey(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * 把**文件夹名**切成「作品名键 + 集数键」（2026-10-05，P1）。
 *
 * 为什么要有它：老的冲突判定只看集数（"同一个父级下集数唯一"），一旦一个父级里
 * 放了多部作品，数字巧合就撞号（真实现场：`一根筋 96` 撞 `矢野同學觀察日記 - 96`、
 * `番外 22 23 24` 被解析成 24 撞 `惡役千金LV99 - 24`）。
 *
 * 规则刻意**保守且无猜测**：把名字里**最后一个**数字（连同它所在的那一段数字）切掉，
 * 剩下的就是作品名键；切不出数字时集数键为空（调用方据此不参与冲突比较）。
 *
 * ⚠️ 已知边界（**故意**，不是漏做）：
 *   · 数字**后面**的尾巴留在作品名键里（如 `… - 姐煩19 - 中文（繁体）` 的键是
 *     `… - 姐煩 - 中文（繁体）`）—— 因为"到哪儿算作品名"没有客观答案；
 *   · 多数字标题只切最后一个（`番外 22 23 24` ⇒ 作品键 `…番外 22 23`）——
 *     "切得更准"属于下一步 A（模式化解析），不在本步；
 *   · 整个名字就是一个数字时作品名键为空 —— 调用方**退回"只比集数"的保守口径**。
 */
export function splitChapterIdentity(folderName: string): {
  worksKey: string
  chapterKey: string
} {
  const name = folderName.trim()
  const token = findChapterToken(name)
  if (!token) return { worksKey: normalizeNameKey(name), chapterKey: '' }
  // 切掉的是**被选中的那一段**（带单位的连"第…话"一起切），不是"最后一个数字"。
  const withoutToken = name.slice(0, token.start) + name.slice(token.end)
  return { worksKey: normalizeNameKey(withoutToken), chapterKey: token.value }
}
