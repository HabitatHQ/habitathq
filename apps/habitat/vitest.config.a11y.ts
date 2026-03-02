import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'app'),
      '@': resolve(__dirname, 'app'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/a11y/unit/**/*.test.ts'],
  },
})
