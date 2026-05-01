import { defineNuxtConfig } from 'nuxt/config'

const buildTarget = process.env['BUILD_TARGET'] // 'pwa' | 'native' | undefined
const appBaseURL = process.env['NUXT_APP_BASE_URL'] ?? '/'
const isNative = buildTarget === 'native'
const isPWA = !isNative

export default defineNuxtConfig({
  devServer: {
    host: '127.0.0.1',
    port: 3210,
  },
  devtools: { enabled: process.env['NUXT_DEVTOOLS_ENABLED'] !== 'false' },
  compatibilityDate: '2025-01-01',

  // Required for SharedArrayBuffer (SQLite WASM OPFS persistence).
  routeRules: {
    '/**': {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
  },

  // SPA mode — works for both PWA and Capacitor
  ssr: false,

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
        name: 'Hephaestus',
        short_name: 'Hephaestus',
        description: 'Track your workouts, forge your strength.',
        theme_color: '#111111',
        background_color: '#111111',
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
            name: 'Today',
            url: appBaseURL,
            description: "View today's planned workout",
          },
          {
            name: 'New Workout',
            url: `${appBaseURL}workout`,
            description: 'Start a new workout session',
          },
          {
            name: 'Log Run',
            url: `${appBaseURL}history`,
            description: 'Log a new run',
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
      title: 'Hephaestus',
      meta: [
        { name: 'description', content: 'Track your workouts, forge your strength.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Hephaestus' },
        { name: 'theme-color', content: '#111111' },
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
