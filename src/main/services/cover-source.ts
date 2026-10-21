import { readdir,stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { JpgPsdPair } from '@shared/types'
import { readPreview,writePreview } from './preview-cache'

/** Directory metadata invalidates the cover selection; image bytes live in the same cache DB. */
export async function coverSource(folder:string):Promise<JpgPsdPair|null> {
  try {
    const directory = await stat(folder)
    if (!directory.isDirectory()) return null
    const revision = String(directory.mtimeMs)
    const cached = readPreview('cover-source',folder,revision)
    let path:string|undefined
    if (cached) { try { path=JSON.parse(cached.payload.toString()).path } catch { /* rescan */ } }
    if (!path) {
      const files=(await readdir(folder,{withFileTypes:true})).filter(e=>e.isFile()).map(e=>e.name).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
      const name=files.find(n=>/\.(png|jpe?g|webp|bmp)$/i.test(n)) ?? files.find(n=>/\.psd$/i.test(n))
      if (!name) return null
      path=join(folder,name)
      writePreview('cover-source',folder,revision,Buffer.from(JSON.stringify({path})))
    }
    const info=await stat(path)
    return {psd:{absPath:path,mtimeMs:info.mtimeMs,ctimeMs:info.birthtimeMs,size:info.size,status:'none'},previewOnly:!/\.psd$/i.test(path)}
  } catch { return null }
}
