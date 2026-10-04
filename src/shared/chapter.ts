/** Keep digits, Han characters and at most one decimal point. */
export function sanitizeChapterInput(value: string): string {
  const allowed = value.normalize('NFC').replace(/[^\d.\p{Script=Han}]/gu, '')
  const dotIndex = allowed.indexOf('.')
  if (dotIndex === -1) return allowed
  return allowed.slice(0, dotIndex + 1) + allowed.slice(dotIndex + 1).replace(/\./g, '')
}

/** Convert values such as "003", "第003话" and "七龙珠003" to "3". */
export function extractChapterNumber(value: string): string {
  const matches = [...value.matchAll(/\d+(?:\.\d+)?/g)]
  const raw = matches.at(-1)?.[0]
  if (!raw) return ''

  const [integerPart, decimalPart] = raw.split('.')
  const integer = String(Number.parseInt(integerPart, 10))
  if (decimalPart === undefined) return integer

  const decimal = decimalPart.replace(/0+$/, '')
  return decimal ? `${integer}.${decimal}` : integer
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
  if (/^\d+(?:\.\d+)?$/.test(sanitized)) return extractChapterNumber(sanitized)
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
