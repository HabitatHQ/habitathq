import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('reads and updates battery exemption through the Capacitor plugin proxy', async () => {
  vi.resetModules()
  let ignoring = false
  vi.stubGlobal('CapacitorCustomPlatform', { name: 'android' })
  vi.stubGlobal('Capacitor', {
    PluginHeaders: [
      {
        name: 'BatteryOptim',
        methods: [
          { name: 'isIgnoringOptimizations', rtype: 'promise' },
          { name: 'requestIgnore', rtype: 'promise' },
        ],
      },
    ],
    nativePromise: async (_plugin: string, method: string) => {
      if (method === 'isIgnoringOptimizations') return { ignoring }
      if (method === 'requestIgnore') {
        ignoring = true
        return
      }
      throw new Error(`Unexpected native method: ${method}`)
    },
  })
  vi.stubGlobal('useNuxtApp', () => ({ $config: { app: { baseURL: '/' } } }))
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
  const { useNotifications } = await import('../../app/composables/useNotifications')
  const notifications = useNotifications()

  await notifications.checkBatteryOptim()
  expect(notifications.batteryOptim.value).toBe('optimized')
  await notifications.requestBatteryExemption()
  expect(notifications.batteryOptim.value).toBe('exempt')
})
