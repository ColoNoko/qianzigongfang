/** Resolve the selected real face before applying synthetic bold/italic. */
export function fontFaceCss(style: {
  fauxBold?: boolean
  fauxItalic?: boolean
  font: { style: string; weight?: number; italic?: boolean }
}): {
  weight: number
  style: 'normal' | 'italic'
} {
  const name = style.font.style.toLowerCase().replace(/[\s_-]+/gu, '')
  let weight = 400
  if (/thin|hairline/u.test(name)) weight = 100
  else if (/extralight|ultralight/u.test(name)) weight = 200
  else if (/light/u.test(name)) weight = 300
  else if (/semibold|demibold/u.test(name)) weight = 600
  else if (/extrabold|ultrabold/u.test(name)) weight = 800
  else if (/black|heavy/u.test(name)) weight = 900
  else if (/bold/u.test(name)) weight = 700
  else if (/medium/u.test(name)) weight = 500
  if (Number.isFinite(style.font.weight) && style.font.weight! >= 1 && style.font.weight! <= 1000)
    weight = style.font.weight!
  if (style.fauxBold) weight = Math.max(700, weight)
  return {
    weight,
    style:
      style.fauxItalic || (style.font.italic ?? /italic|oblique/u.test(name)) ? 'italic' : 'normal'
  }
}
