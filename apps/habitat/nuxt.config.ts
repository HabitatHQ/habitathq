import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineNuxtConfig } from 'nuxt/config'

const buildTarget = process.env['BUILD_TARGET'] // 'pwa' | 'native' | undefined (defaults to dev/pwa)

// Base path for all pages — set via NUXT_APP_BASE_URL env var (e.g. '/habitat/' for GitHub Pages).
// Nuxt automatically picks this up for routing and assets; we also use it for the PWA manifest.
const appBaseURL = process.env['NUXT_APP_BASE_URL'] ?? '/'

// Inject coi-serviceworker to polyfill COOP/COEP on hosts that can't set custom headers (e.g. GitHub Pages).
// Enable via ENABLE_COI_SW=true at build time.
const enableCoiSw = process.env['ENABLE_COI_SW'] === 'true'

function gitExec(cmd: string): string | null {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null }
  catch { return null }
}

const appVersion: string = JSON.parse(readFileSync('./package.json', 'utf8')).version ?? ''
const commitSha: string = gitExec('git rev-parse --short HEAD') ?? ''
const gitTag: string = gitExec('git describe --tags --exact-match HEAD') ?? ''
const isNative = buildTarget === 'native'
const isPWA = !isNative

export default defineNuxtConfig({
  devServer: {
    host: '127.0.0.1'
  },
  compatibilityDate: '2025-01-01',

  // Required for SharedArrayBuffer (SQLite WASM OPFS persistence)
  routeRules: {
    '/**': {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  },

  // SPA mode — works for both PWA and Capacitor
  ssr: false,

  devtools: { enabled: true },

  modules: [
    '@nuxt/ui',
    ...(isPWA ? ['@vite-pwa/nuxt'] : []),
  ],

  // Global CSS (custom Tailwind v4 utilities — safe areas, etc.)
  css: ['~/assets/css/main.css'],

  // Nuxt UI module options
  ui: {
    colorMode: true,
  },

  // PWA config (only active when BUILD_TARGET=pwa or dev)
  ...(isPWA && {
    pwa: {
      registerType: 'autoUpdate',
      manifest: {
        name: 'Habitat – Habit Tracker',
        short_name: 'Habitat',
        description: 'Track your habits, build your life.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: appBaseURL,
        scope: appBaseURL,
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: appBaseURL,
        navigateFallbackAllowlist: [new RegExp(`^${appBaseURL}`)],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    },
  }),

  // Vite config
  vite: {
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    define: {
      __BUILD_TARGET__: JSON.stringify(buildTarget ?? 'pwa'),
    },
    optimizeDeps: {
      exclude: ['@sqlite.org/sqlite-wasm'],  // prevents esbuild from breaking WASM dynamic import
    },
    worker: {
      format: 'es',  // worker bundle must be ES module for sqlite-wasm's dynamic imports
    },
  },

  // App meta
  app: {
    head: {
      title: 'Habitat',
      meta: [
        { name: 'description', content: 'Track your habits, build your life.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Habitat' },
        { name: 'theme-color', content: '#0f172a' },
      ],
      link: [
        { rel: 'icon', href: `${appBaseURL}favicon.svg`, type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: `${appBaseURL}icons/icon-192.png` },
      ],
      // Polyfill COOP/COEP via service worker on hosts that can't set headers (e.g. GitHub Pages).
      // Must run before any other script so SharedArrayBuffer is available for SQLite WASM.
      script: enableCoiSw ? [{ src: `${appBaseURL}coi-serviceworker.js` }] : [],
    },
  },

  // Runtime config for build target access in app
  runtimeConfig: {
    public: {
      buildTarget: buildTarget ?? 'pwa',
      appVersion,
      commitSha,
      gitTag,
    },
  },
})
