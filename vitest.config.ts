import { readFileSync } from 'fs'
import { resolve } from 'path'
import { configDefaults, defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 与 electron.vite.config.ts 注入**同一个**版本号（唯一真源 = package.json）
const APP_VERSION = (
  JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }
).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  // Node 22 exposes `node:sqlite` at runtime but does not list it in
  // `module.builtinModules`; declaring it explicitly keeps Vitest's jsdom
  // environment from trying to bundle the native built-in during tests.
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
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    // 视觉检查（会启动无头浏览器、产出图片）由 vitest.visual.config.ts 单独承载，
    // 不能混进常规测试套件，否则每次跑测试都会拖慢并污染测试计数。
    exclude: [...configDefaults.exclude, 'src/renderer/src/visual/**'],
    setupFiles: ['./src/test-setup.ts'],
    server: {
      deps: {
        external: ['node:sqlite']
      }
    }
  }
})
