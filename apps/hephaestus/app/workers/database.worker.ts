import { BrowserSqliteAdapter } from '@palladium/sqlite-browser'
import type { DbOwnerConfig } from '@palladium/worker'
import { startDbOwner } from '@palladium/worker/owner'
import {
  createHephaestusBackend,
  type HephaestusBackend,
  type HephaestusRequest,
} from '~/lib/hephaestus-backend'

interface HephaestusService {
  ping(): Promise<boolean>
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
  mutate(sql: string, params?: readonly unknown[]): Promise<number>
  dispatch(request: HephaestusRequest): Promise<unknown>
}

let storage: BrowserSqliteAdapter | null = null
let backend: HephaestusBackend | null = null

const owner: DbOwnerConfig<HephaestusService> = {
  dbName: 'hephaestus',
  methods: ['ping', 'query', 'mutate', 'dispatch'],
  create(context) {
    return {
      async open() {
        const opened = new BrowserSqliteAdapter({
          vfs: { type: 'opfs-sah-pool', directory: '/hephaestus', filename: '/hephaestus.db' },
        })
        storage = opened
        try {
          backend = await createHephaestusBackend(opened, {
            invalidate: (tables) => context.invalidate(tables),
          })
        } catch (error) {
          await opened.close()
          storage = null
          throw error
        }
      },
      async ping() {
        if (!backend) throw new Error('Hephaestus database is not initialized')
        return true
      },
      async query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
        if (!backend) throw new Error('Hephaestus database is not initialized')
        return backend.query<T>(sql, params)
      },
      async mutate(sql, params) {
        if (!backend) throw new Error('Hephaestus database is not initialized')
        return backend.mutate(sql, params)
      },
      async dispatch(request) {
        if (!backend) throw new Error('Hephaestus database is not initialized')
        return backend.dispatch(request)
      },
      async close() {
        const opened = storage
        const current = backend
        storage = null
        backend = null
        try {
          await current?.close()
        } finally {
          await opened?.close()
        }
      },
    }
  },
}

startDbOwner(owner)
