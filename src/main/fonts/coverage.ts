/** Real non-zero glyph coverage; block intersection alone cannot prove a character exists. */
export function cmapRanges(cmap: Buffer): Array<[number, number]> | null {
  if (cmap.length < 4) return null
  const count = cmap.readUInt16BE(2)
  if (count > 1024 || 4 + count * 8 > cmap.length) return null
  const ranges: Array<[number, number]> = []
  const seen = new Set<number>()
  let supported = false
  for (let index = 0; index < count; index++) {
    const at = 4 + index * 8,
      platform = cmap.readUInt16BE(at),
      encoding = cmap.readUInt16BE(at + 2)
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue
    const start = cmap.readUInt32BE(at + 4)
    if (seen.has(start) || start + 16 > cmap.length) continue
    seen.add(start)
    const format = cmap.readUInt16BE(start)
    if (format === 4) {
      const length = cmap.readUInt16BE(start + 2),
        segments = cmap.readUInt16BE(start + 6) / 2
      if (
        !Number.isInteger(segments) ||
        segments < 1 ||
        segments > 32768 ||
        start + length > cmap.length ||
        16 + segments * 8 > length
      )
        continue
      supported = true
      const ends = start + 14,
        starts = ends + 2 * segments + 2,
        deltas = starts + 2 * segments,
        offsets = deltas + 2 * segments
      // Each BMP codepoint is visited at most once, even for malformed overlapping segments.
      let last = -1
      for (let n = 0; n < segments; n++) {
        const first = cmap.readUInt16BE(starts + n * 2),
          end = Math.min(65534, cmap.readUInt16BE(ends + n * 2))
        const delta = cmap.readInt16BE(deltas + n * 2),
          offset = cmap.readUInt16BE(offsets + n * 2)
        let run = -1
        for (let code = Math.max(first, last + 1); code <= end; code++) {
          const address = offsets + n * 2 + offset + (code - first) * 2
          let glyph =
            offset === 0
              ? (code + delta) & 0xffff
              : address + 2 <= start + length
                ? cmap.readUInt16BE(address)
                : 0
          if (offset && glyph) glyph = (glyph + delta) & 0xffff
          if (glyph && run < 0) run = code
          if (!glyph && run >= 0) {
            ranges.push([run, code - 1])
            run = -1
          }
        }
        if (run >= 0) ranges.push([run, end])
        last = Math.max(last, end)
      }
    } else if (format === 12 || format === 13) {
      const length = cmap.readUInt32BE(start + 4),
        groups = cmap.readUInt32BE(start + 12)
      if (groups > 200000 || start + length > cmap.length || 16 + groups * 12 > length) continue
      supported = true
      for (let n = 0; n < groups; n++) {
        const at = start + 16 + n * 12
        let first = cmap.readUInt32BE(at)
        const end = cmap.readUInt32BE(at + 4),
          glyph = cmap.readUInt32BE(at + 8)
        if (first > end || end > 0x10ffff || (format === 13 && glyph === 0)) continue
        if (format === 12 && glyph === 0) first++
        if (first <= end) ranges.push([first, end])
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1])
    else merged.push([...range])
  }
  return supported ? merged : null
}
