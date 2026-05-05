import { Capacitor } from '@capacitor/core'
import { createDatabasePlugin } from '@palladium/nuxt'
import { dispatchNative, initNativeDb } from '~/lib/db-native'

const { sendToWorker: _send, initialize } = createDatabasePlugin({
  appName: 'Hephaestus',
  createWorker: () =>
    new Worker(new URL('../workers/database.worker.ts', import.meta.url), { type: 'module' }),
  native: {
    init: initNativeDb,
    dispatch: dispatchNative as (req: unknown) => Promise<unknown>,
  },
})

export function sendToWorker<T>(req: Record<string, unknown>): Promise<T> {
  return _send<T>(req)
}

export default defineNuxtPlugin(async () => {
  const dbError = useState<string | null>('db-error', () => null)

  await initialize(Capacitor.isNativePlatform(), (msg) => {
    dbError.value = msg
  })

  return {
    provide: { dbError: readonly(dbError) },
  }
})
