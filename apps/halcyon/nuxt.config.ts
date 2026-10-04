import { defineNuxtConfig } from 'nuxt/config'

const buildTarget = process.env['BUILD_TARGET'] // 'pwa' | 'native' | undefined
const appBaseURL = process.env['NUXT_APP_BASE_URL'] ?? '/'
const isNative = buildTarget === 'native'
const isPWA = !isNative

export default defineNuxtConfig({
  extends: ['@habitathq/shared'],
  devServer: {
    host: '127.0.0.1',
    port: 3300,
  },

  // Required for SharedArrayBuffer (SQLite WASM OPFS persistence).
  routeRules: {
    '/**': {
      headers: {
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
  },

  devtools: { enabled: true },

  modules: ['@nuxt/ui', ...(isPWA ? ['@vite-pwa/nuxt'] : [])],

  css: ['~/assets/css/main.css'],

  ui: {
    colorMode: true,
  },
  icon: {
    clientBundle: {
      scan: true,
    },
    serverBundle: { collections: ['heroicons', 'lucide'] },
    fallbackToApi: false,
  },

  ...(isPWA && {
    pwa: {
      strategies: 'injectManifest',
      srcDir: 'workers',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: {
        id: appBaseURL,
        name: 'Halcyon – Personal Relationship Manager',
        short_name: 'Halcyon',
        description: 'Your memory for the people you care about.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
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
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
  },

  app: {
    head: {
      title: 'Halcyon',
      meta: [
        { name: 'description', content: 'Your memory for the people you care about.' },
        { name: 'apple-mobile-web-app-title', content: 'Halcyon' },
        { name: 'theme-color', content: '#0f172a' },
      ],
      link: [
        { rel: 'icon', href: `${appBaseURL}favicon.svg`, type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: `${appBaseURL}icons/icon-192.png` },
        ...(isPWA ? [{ rel: 'manifest' as const, href: `${appBaseURL}manifest.webmanifest` }] : []),
      ],
    },
  },
})
