import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { guideAssetsPlugin } from './build/guide-assets'

/**
 * 版本号的**唯一真源** = `package.json`（2026-10-04 唯一化）。
 *
 * 构建期注入成全局 `__APP_VERSION__`，界面与测试都读它 —— 以前版本号散在四处
 * （这里 / `Settings.vue` 的字面量 / 一条测试断言 / 交接文档），改版本漏一处就出错。
 * ⚠️ 三个 vitest 配置（`vitest.config.ts` / `vitest.visual.config.ts`）必须注入**同一个**值，
 * 否则测试里读到的和打包出来的不是一回事。锁在 `Settings-version.spec.ts`。
 */
const APP_VERSION = (
  JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }
).version
const DEFINE = { __APP_VERSION__: JSON.stringify(APP_VERSION) }

export default defineConfig({
  main: {
    define: DEFINE,
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    define: DEFINE,
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    define: DEFINE,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue(), guideAssetsPlugin()]
  }
})
