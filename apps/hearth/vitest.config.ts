import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'

// Replace Nuxt-specific import.meta.* flags so composables work in vitest
const nuxtMetaPlugin: Plugin = {
  name: 'nuxt-meta-replace',
  transform(code) {
    return code.replace(/import\.meta\.client/g, 'true').replace(/import\.meta\.server/g, 'false')
  },
}

export default defineConfig({
  plugins: [nuxtMetaPlugin],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    alias: {
      '~': resolve(__dirname, 'app'),
    },
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, 'app'),
    },
  },
})
