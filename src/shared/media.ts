export interface MediaInfo {
  size: number
  mtimeMs: number
  estimatedBytes: number
}
export const sameMedia = (
  a: Pick<MediaInfo, 'mtimeMs' | 'size'>,
  b: Pick<MediaInfo, 'mtimeMs' | 'size'>
): boolean => a.size === b.size && a.mtimeMs === b.mtimeMs
