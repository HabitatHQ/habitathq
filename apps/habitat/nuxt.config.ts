import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineNuxtConfig } from 'nuxt/config'
import license from 'rollup-plugin-license'
import {
  buildFullCsp,
  cspHashPlugin,
  extractInlineScriptHashes,
  injectFullCspMetaTag,
} from './lib/csp-hashes'

const buildTarget = process.env.BUILD_TARGET // 'pwa' | 'native' | undefined (defaults to dev/pwa)

// Base path for all pages — set via NUXT_APP_BASE_URL env var (e.g. '/habitat/' for GitHub Pages).
// Nuxt automatically picks this up for routing and assets; we also use it for the PWA manifest.
const appBaseURL = process.env.NUXT_APP_BASE_URL ?? '/'

function gitExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

const appVersion: string = JSON.parse(readFileSync('./package.json', 'utf8')).version ?? ''
const commitSha: string = gitExec('git rev-parse --short HEAD') ?? ''
const gitTag: string = gitExec('git describe --tags --exact-match HEAD') ?? ''
const buildTime: string = new Date().toISOString()
const isNative = buildTarget === 'native'
const isPWA = !isNative

export default defineNuxtConfig({
  devServer: {
    host: '127.0.0.1',
  },
  compatibilityDate: '2025-01-01',

  // Required for SharedArrayBuffer (SQLite WASM OPFS persistence).
  // The full Content-Security-Policy lives in the HTML <meta> tag — it is
  // injected by the `nitro:build:done` hook (build) / cspHashPlugin (dev) so
  // that inline-script hashes can be computed dynamically.
  // `frame-ancestors` cannot be set via a meta tag so it stays here.
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

  devtools: { enabled: true },

  modules: ['@nuxt/ui', ...(isPWA ? ['@vite-pwa/nuxt'] : [])],

  // Global CSS (custom Tailwind v4 utilities — safe areas, etc.)
  css: ['~/assets/css/main.css'],

  // Nuxt UI module options
  ui: {
    colorMode: true,
  },

  // PWA config (only active when BUILD_TARGET=pwa or dev)
  ...(isPWA && {
    pwa: {
      // injectManifest: we supply a custom sw.ts that handles both Workbox
      // precaching and COOP/COEP header injection on navigation responses.
      // This replaces the old generateSW + coi-serviceworker.js combination —
      // one SW avoids the scope-conflict/reload-loop that two SWs caused.
      strategies: 'injectManifest',
      srcDir: 'workers',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: {
        id: appBaseURL,
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
        screenshots: [
          {
            src: `${appBaseURL}screenshots/mobile.png`,
            sizes: '390x844',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Habitat home screen',
          },
          {
            src: `${appBaseURL}screenshots/desktop.png`,
            sizes: '1280x800',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Habitat on desktop',
          },
        ],
        shortcuts: [
          {
            name: 'Today',
            url: appBaseURL,
            description: "View today's habits",
          },
          {
            name: 'Habits',
            url: `${appBaseURL}habits`,
            description: 'Manage your habits',
          },
          {
            name: 'Check-in',
            url: `${appBaseURL}checkin`,
            description: 'Daily check-in and journalling',
          },
          {
            name: 'Stats',
            url: `${appBaseURL}stats`,
            description: 'View habit statistics',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
      },
      devOptions: {
        // Keep disabled in dev: Vite already serves COOP/COEP headers directly,
        // so the PWA SW is not needed and would cause HMR reload loops via the
        // autoUpdate controllerchange handler.
        enabled: false,
      },
    },
  }),

  // Vite config
  vite: {
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        // Full CSP is injected into HTML by cspHashPlugin() in dev mode.
        // frame-ancestors must be an HTTP header (ignored in meta tags).
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
    define: {
      __BUILD_TARGET__: JSON.stringify(buildTarget ?? 'pwa'),
    },
    optimizeDeps: {
      exclude: ['@sqlite.org/sqlite-wasm'], // prevents esbuild from breaking WASM dynamic import
    },
    worker: {
      format: 'es', // worker bundle must be ES module for sqlite-wasm's dynamic imports
    },
    plugins: [
      // Post-order: scan final HTML for inline <script> elements, compute
      // their SHA-256 hashes, and patch them into the CSP meta tag's script-src.
      cspHashPlugin(),
      license({
        thirdParty: {
          includePrivate: false,
          output: {
            file: resolve('public/licenses.json'),
            template: (deps) =>
              JSON.stringify(
                deps
                  .filter((d) => d.name)
                  .map((d) => ({
                    name: d.name,
                    version: d.version,
                    license: d.license,
                    homepage: d.homepage ?? null,
                  }))
                  .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
              ),
          },
        },
      }),
    ],
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
        // Content-Security-Policy meta tag is injected by nitro:build:done hook
        // (production) or cspHashPlugin transformIndexHtml (dev) so that
        // inline-script hashes can be computed from the actual HTML output.
      ],
      link: [
        { rel: 'icon', href: `${appBaseURL}favicon.svg`, type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: `${appBaseURL}icons/icon-192.png` },
        ...(isPWA ? [{ rel: 'manifest' as const, href: `${appBaseURL}manifest.webmanifest` }] : []),
      ],
    },
  },

  // Inject the full Content-Security-Policy meta tag into every generated HTML
  // file after Nitro's prerenderer has written them to `.output/public/`.
  // This is necessary because inline-script hashes (e.g. Nuxt's color-mode
  // IIFE) are only known once the final HTML is produced — they can't be
  // hardcoded in nuxt.config and can't be patched by Vite's transformIndexHtml
  // hook (which runs before the prerenderer).
  hooks: {
    // nitro:build:done is a valid Nuxt hook; fires after Nitro writes all static
    // HTML files to .output/public/. Absent from the generated NuxtHooks type.
    // @ts-expect-error — valid hook, incomplete type definition
    'nitro:build:done': (nitro: { options: { output: { publicDir: string } } }) => {
      const publicDir = nitro.options.output.publicDir as string

      function processDir(dir: string) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            processDir(fullPath)
          } else if (entry.name.endsWith('.html')) {
            const html = readFileSync(fullPath, 'utf8')
            const hashes = extractInlineScriptHashes(html)
            const csp = buildFullCsp(hashes)
            const patched = injectFullCspMetaTag(html, csp)
            if (patched !== html) writeFileSync(fullPath, patched)
          }
        }
      }

      processDir(publicDir)
    },
  },

  // Runtime config for build target access in app
  runtimeConfig: {
    public: {
      buildTarget: buildTarget ?? 'pwa',
      appVersion,
      commitSha,
      gitTag,
      buildTime,
    },
  },
})
