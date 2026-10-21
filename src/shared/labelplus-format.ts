// Official exporters use eight delimiters; older files may use six.
const FILE_HEADER = /^\s*>{6,}\[(.*)\]<{6,}\s*$/

/** Match one image header line, including the whitespace accepted by LabelPlus. */
export function matchLabelPlusFileHeader(line: string): string | null {
  const match = FILE_HEADER.exec(line)
  return match ? (match[1] ?? '').trim() : null
}
