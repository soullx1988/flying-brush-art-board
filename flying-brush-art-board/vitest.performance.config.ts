import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    maxWorkers: 1,
    benchmark: {
      include: ['tests/performance/**/*.bench.ts'],
    },
  },
})
