import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * 截图检查专用配置（与主测试套件分离）。
 *
 * 主配置的 include 是 `src/**\/*.spec.ts`，会把视觉检查也扫进去；
 * 因此主配置排除 `src/renderer/src/visual/**`，由本配置单独承载。
 *
 *   pnpm run visual        # 只跑视觉检查并出图
 *   pnpm run test          # 日常核心回归（不含视觉检查）
 *   pnpm run test:full     # 完整测试（不含视觉检查）
 */
// 与 electron.vite.config.ts 注入**同一个**版本号（唯一真源 = package.json）
const APP_VERSION = (
  JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }
).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  resolve: {
    builtins: ['node:sqlite'],
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/renderer/src/visual/**/*.visual.spec.ts'],
    setupFiles: ['./src/test-setup.ts'],
    // 截图要启动浏览器，给足时间。
    testTimeout: 180000,
    hookTimeout: 180000,
    server: {
      deps: {
        external: ['node:sqlite']
      }
    }
  }
})
