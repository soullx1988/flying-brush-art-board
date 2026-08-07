import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/performance/realtime-room-load.test.ts'],
    maxWorkers: 1,
  },
})
