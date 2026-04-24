import { defineNuxtConfig } from 'nuxt/config'

const buildTarget = process.env.BUILD_TARGET // 'pwa' | 'native' | undefined
const appBaseURL = process.env.NUXT_APP_BASE_URL ?? '/'
const isNative = buildTarget === 'native'
const isPWA = !isNative

export default defineNuxtConfig({
  devServer: {
    host: '127.0.0.1',
  },
  compatibilityDate: '2025-01-01',

  // COOP/COEP required for SQLite WASM (SharedArrayBuffer / OPFS)
  routeRules: {
    '/**': {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
  },

  // SPA — works for both PWA and Capacitor
  ssr: false,

  devtools: { enabled: true },

  modules: ['@nuxt/ui', ...(isPWA ? ['@vite-pwa/nuxt'] : [])],

  css: ['~/assets/css/main.css'],

  ui: {
    colorMode: true,
  },

  ...(isPWA && {
    pwa: {
      strategies: 'injectManifest',
      srcDir: 'workers',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: {
        id: appBaseURL,
        name: 'Hearth – Family Finance',
        short_name: 'Hearth',
        description: 'Family expense tracking and envelope budgeting.',
        theme_color: '#0c1219',
        background_color: '#0c1219',
        display: 'standalone',
        orientation: 'portrait',
        start_url: appBaseURL,
        scope: appBaseURL,
        icons: [
          {
            src: `${appBaseURL}icons/icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: `${appBaseURL}icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: `${appBaseURL}icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Dashboard',
            url: appBaseURL,
            description: 'Monthly spending overview',
          },
          {
            name: 'Add Expense',
            url: `${appBaseURL}transactions/add`,
            description: 'Quickly add a transaction',
          },
          {
            name: 'Envelopes',
            url: `${appBaseURL}envelopes`,
            description: 'View budget envelopes',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
      },
      devOptions: {
        enabled: false,
      },
    },
  }),

  vite: {
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
    define: {
      __BUILD_TARGET__: JSON.stringify(buildTarget ?? 'pwa'),
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
      title: 'Hearth',
      meta: [
        { name: 'description', content: 'Family expense tracking and envelope budgeting.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Hearth' },
        { name: 'theme-color', content: '#0c1219' },
      ],
      link: [
        { rel: 'icon', href: `${appBaseURL}favicon.svg`, type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: `${appBaseURL}icons/icon-192.png` },
        ...(isPWA ? [{ rel: 'manifest' as const, href: `${appBaseURL}manifest.webmanifest` }] : []),
      ],
    },
  },

  runtimeConfig: {
    public: {
      buildTarget: buildTarget ?? 'pwa',
    },
  },
})
