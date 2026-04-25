import { readonly, ref } from 'vue'
import type { ParseResult, ParserContext } from '~/lib/nlp/types'
import type {
  NlpStatusData,
  NlpTier,
  NlpWorkerLifecycle,
  NlpWorkerResponse,
} from '~/lib/nlp/worker-types'

let worker: Worker | null = null
let initPromise: Promise<void> | null = null
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function sendToNlp<T>(req: Record<string, unknown>): Promise<T> {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker?.postMessage({ ...req, id })
  })
}

const status = ref<'idle' | 'ready' | 'loading' | 'error'>('idle')
const tier = ref<NlpTier>('regex')
const modelProgress = ref(0)

function handleMessage(e: MessageEvent) {
  const msg = e.data

  // Lifecycle messages (no id)
  if ('type' in msg && !('id' in msg)) {
    const lc = msg as NlpWorkerLifecycle
    switch (lc.type) {
      case 'READY':
        status.value = 'ready'
        break
      case 'MODEL_PROGRESS':
        modelProgress.value = lc.progress
        break
      case 'MODEL_LOADED':
        status.value = 'ready'
        tier.value = lc.tier
        break
      case 'MODEL_ERROR':
        // Fall back to regex — don't show error to user
        status.value = 'ready'
        break
    }
    return
  }

  // Request/response messages
  const resp = msg as NlpWorkerResponse
  const p = pending.get(resp.id)
  if (!p) return
  pending.delete(resp.id)
  resp.ok ? p.resolve(resp.data) : p.reject(new Error(resp.error))
}

export function useNlpParser() {
  function init(requestedTier: NlpTier = 'regex'): Promise<void> {
    if (initPromise) return initPromise

    worker = new Worker(new URL('../workers/nlp.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.addEventListener('message', handleMessage)

    initPromise = new Promise<void>((resolve) => {
      const onReady = (e: MessageEvent) => {
        if (e.data?.type === 'READY') {
          worker!.removeEventListener('message', onReady)
          resolve()
        }
      }
      worker!.addEventListener('message', onReady)
    })

    sendToNlp({ type: 'INIT', payload: { tier: requestedTier } })

    return initPromise
  }

  async function parse(input: string, context: ParserContext): Promise<ParseResult> {
    await (initPromise ?? init())
    return sendToNlp<ParseResult>({ type: 'PARSE', payload: { input, context } })
  }

  async function getStatus(): Promise<NlpStatusData> {
    return sendToNlp<NlpStatusData>({ type: 'GET_STATUS' })
  }

  function destroy() {
    worker?.terminate()
    worker = null
    initPromise = null
    pending.clear()
    status.value = 'idle'
  }

  return {
    status: readonly(status),
    tier: readonly(tier),
    modelProgress: readonly(modelProgress),
    init,
    parse,
    getStatus,
    destroy,
  }
}
