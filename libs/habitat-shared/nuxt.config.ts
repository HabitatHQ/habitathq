import { getRegistryIconifyNames } from '@habitathq/utils'
import { createResolver } from '@nuxt/kit'

const { resolve } = createResolver(import.meta.url)

/**
 * Shared Nuxt layer for all Habitat apps.
 *
 * Provides the boilerplate every app needs:
 * - SPA mode (ssr: false)
 * - COOP/COEP headers for SharedArrayBuffer / SQLite WASM OPFS
 * - Vite config for SQLite WASM (optimizeDeps exclude, ES worker format)
 * - PWA injectManifest scaffold (apps supply their own manifest + sw.ts)
 * - Mobile-safe viewport meta tags
 * - Lucide icon clientBundle (offline-safe via @iconify-json/lucide)
 * - Shared `<AppIcon>` component (registry-aware UIcon wrapper)
 *
 * Apps extend this via `extends: ['../../libs/habitat-shared']` in nuxt.config.
 * App-specific config (port, PWA manifest, colors, plugins) stays in the app.
 */
export default defineNuxtConfig({
  ssr: false,

  compatibilityDate: '2025-01-01',

  routeRules: {
    '/**': {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
  },

  css: [
    resolve('./app/assets/css/safe-area.css'),
    resolve('./app/assets/css/animations.css'),
    resolve('./app/assets/css/buttons.css'),
  ],

  vite: {
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      watch: {
        ignored: [(path: string) => path.includes('/.worktrees/')],
      },
    },
    define: {
      __BUILD_TARGET__: JSON.stringify(process.env['BUILD_TARGET'] ?? 'pwa'),
    },
    optimizeDeps: {
      exclude: ['@sqlite.org/sqlite-wasm'],
    },
    worker: {
      format: 'es',
    },
  },

  app: {
    head: {
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      ],
    },
  },

  runtimeConfig: {
    public: {
      buildTarget: process.env['BUILD_TARGET'] ?? 'pwa',
    },
  },

  // Inline the Lucide icons used by the shared registry so they render offline.
  // Apps that use icons outside the registry add them via their own `icon.clientBundle`.
  icon: {
    provider: 'iconify',
    clientBundle: {
      icons: getRegistryIconifyNames(),
      sizeLimitKb: 512,
    },
  },

  // Auto-import the registry helpers so apps don't need explicit imports.
  imports: {
    presets: [
      {
        from: '@habitathq/utils',
        imports: ['resolveIcon', 'iconRegistry', 'ICON_SIZES', 'iconsByCategory'],
      },
    ],
  },
})
