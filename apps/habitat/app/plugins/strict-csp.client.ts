/**
 * Strict-CSP plugin — runs once on every page load, client-side only.
 *
 * If the user has enabled `strictCsp` in their settings, this plugin injects
 * an additional Content-Security-Policy <meta> tag that restricts
 * `connect-src` to `'none'`, blocking all fetch() and XHR requests for the
 * lifetime of this document.  Because CSPs cannot be relaxed once applied, the
 * session-active state is stored in `useState` so the settings page can show
 * the locked UI and offer a "Disable and reload" action.
 */
export default defineNuxtPlugin(() => {
  const active = parseStrictCspSetting(localStorage.getItem(SETTINGS_STORAGE_KEY))

  // Expose whether the strict CSP was active at page-load time.
  // This is read by settings.vue to show the locked toggle UI.
  useState('strict-csp-session-active', () => active)

  if (active) {
    useHead({
      meta: [
        {
          'http-equiv': 'Content-Security-Policy',
          content: STRICT_CSP,
          // key ensures unhead doesn't duplicate this tag
          key: 'strict-csp-meta',
        },
      ],
    })
  }
})
