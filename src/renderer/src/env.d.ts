/// <reference types="vite/client" />
import type { ComicTypeAPI } from '@shared/ipc-api'

declare global {
  interface Window {
    comicType: ComicTypeAPI
  }
  /**
   * 应用版本号 —— 构建期由 `electron.vite.config.ts` 的 `define` 从 `package.json` 注入。
   * ⚠️ 唯一真源是 `package.json`；界面与测试都读这个全局，别再写版本号字面量
   * （`Settings-version.spec.ts` 有源码契约锁盯着）。
   */
  const __APP_VERSION__: string
}