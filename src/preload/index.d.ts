import { ElectronAPI } from '@electron-toolkit/preload'
import type { ComicTypeAPI } from '../shared/ipc-api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    comicType: ComicTypeAPI
  }
}
