import { defineConfig } from 'vitest/config'
import base from './vitest.config'

// Daily safety checks. Feature changes use `pnpm test:related <source-path>`.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      'src/shared/__tests__/chapter.spec.ts',
      'src/main/services/__tests__/atomic-output.spec.ts',
      'src/main/services/__tests__/labelplus-input.spec.ts',
      'src/main/services/__tests__/project-repository.spec.ts',
      'src/main/services/__tests__/project-scan-scheduler.spec.ts',
      'src/main/services/__tests__/directory-watch-pool.spec.ts',
      'src/main/services/db/__tests__/mark-audit-store.spec.ts',
      'src/renderer/src/stores/__tests__/projectWorkspace-scan-order.spec.ts'
    ]
  }
})
