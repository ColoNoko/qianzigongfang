import type { SystemFontInfo, FontPreviewResult } from '@shared/ipc-api'

export class FontPreviewLoader {
  private generation = 0
  private active = 0
  private queue: Array<() => Promise<void>> = []
  private wanted = new Set<string>()
  readonly coverage = new Map<string, Array<[number, number]> | null>()
  readonly glyphs = new Map<string, FontPreviewResult>()
  private sampleOnly = false
  private entries = new Map<string, { face?: FontFace; bytes: number; done?: boolean }>()
  constructor(private changed: (id: string, status: string) => void) {}
  family(font: SystemFontInfo): string {
    return `qianzi-face-${font.id}`
  }
  show(fonts: SystemFontInfo[], sampleOnly = false): void {
    if (this.sampleOnly !== sampleOnly) { this.clear(); this.sampleOnly = sampleOnly }
    this.wanted = new Set(fonts.map((font) => font.id))
    for (const font of fonts) this.load(font)
    this.trim('')
  }
  load(font: SystemFontInfo): void {
    if (this.entries.has(font.id)) return
    this.entries.set(font.id, { bytes: 0 })
    const generation = this.generation
    this.changed(font.id, '正在加载预览…')
    this.queue.push(async () => {
      if (!this.wanted.has(font.id)) {
        this.entries.delete(font.id)
        return
      }
      try {
        const result = await window.comicType.fontPreview(font.filePath, font.faceIndex, this.sampleOnly)
        if (generation !== this.generation) return
        if (result.glyphs) {
          this.glyphs.set(font.id,result)
          this.entries.set(font.id,{bytes:JSON.stringify(result.glyphs).length * 2,done:true})
          this.coverage.set(font.id,result.coverage)
          this.changed(font.id,'')
          this.trim(font.id)
          return
        }
        const face = new FontFace(this.family(font), result.buffer, {
          weight: String(font.weight || 400),
          style: font.italic ? 'italic' : 'normal'
        })
        await face.load()
        if (generation !== this.generation) return
        document.fonts.add(face)
        this.entries.set(font.id, { face, bytes: result.buffer.byteLength, done: true })
        this.coverage.set(font.id, result.coverage)
        this.changed(font.id, '')
        this.trim(font.id)
      } catch {
        if (generation === this.generation) {
          this.entries.set(font.id, { bytes: 0, done: true })
          this.changed(font.id, '预览加载失败，请刷新重试')
          this.trim(font.id)
        }
      }
    })
    this.pump()
  }
  private pump(): void {
    while (this.active < 4 && this.queue.length) {
      const task = this.queue.shift()!
      this.active++
      void task().finally(() => {
        this.active--
        this.pump()
      })
    }
  }
  private trim(keep: string): void {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= 64 && bytes <= 96 * 1024 * 1024) break
      if (id === keep || this.wanted.has(id) || !entry.done) continue
      if (entry.face) document.fonts.delete(entry.face)
      this.entries.delete(id)
      this.coverage.delete(id)
      this.glyphs.delete(id)
      bytes -= entry.bytes
      this.changed(id, '预览已释放')
    }
  }
  clear(): void {
    this.generation++
    this.queue = []
    for (const entry of this.entries.values()) if (entry.face) document.fonts.delete(entry.face)
    this.entries.clear()
    this.coverage.clear()
    this.glyphs.clear()
    this.wanted.clear()
  }
}
