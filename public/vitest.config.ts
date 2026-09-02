import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    /**
     * Database tests share one Supabase project, so they must not race each
     * other. Slower, but a flaky test suite is worse than a slow one.
     */
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    // LLM calls are real and can take several seconds.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})