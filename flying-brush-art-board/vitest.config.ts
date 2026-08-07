import react from '@vitejs/plugin-react'
import { defineConfig, defineProject } from 'vitest/config'

export default defineConfig({
  test: {
    // High core-count Windows hosts can make native SQLite fork workers exit
    // before Vitest reports results. Four workers remains parallel and stable.
    maxWorkers: 4,
    projects: [
      defineProject({
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'apps/local-api/src/**/*.test.ts',
            'docs/adr/**/*.test.ts',
            'packages/**/*.test.ts',
            'tests/preflight/**/*.test.ts',
            'tests/security/**/*.test.ts',
          ],
        },
      }),
      defineProject({
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.ts', 'apps/web/src/**/*.test.tsx'],
          setupFiles: ['apps/web/src/test/setup.ts'],
        },
      }),
      defineProject({
        test: {
          name: 'feishu',
          environment: 'node',
          include: [
            'scripts/feishu-real-smoke.test.ts',
            'packages/test-fixtures/src/feishu/**/*.test.ts',
            'docs/adr/0002-feishu-scopes.test.ts',
          ],
        },
      }),
    ],
  },
})
