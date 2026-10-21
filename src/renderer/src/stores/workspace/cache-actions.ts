import { THUMB_CACHE_MAX } from './helpers'
import type { WorkspaceContext } from './context'

export const cacheActions = {
  async readThumbUrl(this: WorkspaceContext, absPath: string): Promise<string> {
    const cached = this.thumbUrlCache.get(absPath)
    if (cached !== undefined) {
      // LRU: move to end (most-recently-used).
      this.thumbUrlCache.delete(absPath)
      this.thumbUrlCache.set(absPath, cached)
      return cached
    }
    const url = await window.comicType.readFileDataURL(absPath)
    if (this.thumbUrlCache.size >= THUMB_CACHE_MAX) {
      // Evict the oldest (first) entry — Map preserves insertion order.
      const oldest = this.thumbUrlCache.keys().next().value
      if (oldest !== undefined) {
        this.thumbUrlCache.delete(oldest)
      }
    }
    this.thumbUrlCache.set(absPath, url)
    return url
  },
  clearCaches(this: WorkspaceContext): void {
    this.thumbUrlCache.clear()
  }
}
