import { registerTranslationHandlers } from './translation-handlers'
import { registerSystemHandlers } from './system-handlers'
import { registerMediaHandlers } from './media-handlers'
import { registerImportHandlers } from './import-handlers'
import { registerProjectHandlers } from './project-handlers'
import { registerMarksHandlers } from './marks-handlers'
import { registerAchievementsHandlers } from './achievements-handlers'
import { registerStorageHandlers } from './storage-handlers'
import { registerFontHandlers } from '../fonts/ipc'

/** Composition root: each domain owns its IPC registrations. */
export function registerHandlers(): void {
  registerTranslationHandlers()
  registerSystemHandlers()
  registerMediaHandlers()
  registerImportHandlers()
  registerProjectHandlers()
  registerMarksHandlers()
  registerAchievementsHandlers()
  registerStorageHandlers()
  registerFontHandlers()
}
