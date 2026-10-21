import { shallowRef } from 'vue'
import type { FontListResult, SystemFontInfo } from '@shared/ipc-api'

// One catalog and subscription per renderer API instance (also isolates test windows).
const catalogs = new WeakMap<object, ReturnType<typeof createCatalog>>()
function createCatalog(api: typeof window.comicType) {
  const fonts = shallowRef<SystemFontInfo[]>([])
  let scannedAt = -1
  const accept = (result: FontListResult) => {
    if (result.scannedAt >= scannedAt) {
      scannedAt = result.scannedAt
      fonts.value = result.fonts
    }
  }
  let pending: Promise<FontListResult> | undefined
  api?.onFontsChanged?.((result) => {
    accept(result)
  })
  return {
    fonts,
    load(refresh = false): Promise<FontListResult> {
      if (pending) return pending
      pending = api
        .fontList({ refresh })
        .then((result) => {
          accept(result)
          return { ...result, fonts: fonts.value, scannedAt }
        })
        .finally(() => {
          pending = undefined
        })
      return pending
    }
  }
}
export function fontCatalog() {
  const api = window.comicType
  if (!api) return createCatalog(api)
  let catalog = catalogs.get(api)
  if (!catalog) {
    catalog = createCatalog(api)
    catalogs.set(api, catalog)
  }
  return catalog
}
