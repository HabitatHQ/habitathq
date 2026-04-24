import { parseUtterance } from '~/lib/nlp/parser'
import type {
  NlpTier,
  NlpWorkerLifecycle,
  NlpWorkerRequest,
  NlpWorkerResponse,
} from '~/lib/nlp/worker-types'

let currentTier: NlpTier = 'regex'

// Regex tier is immediately ready
self.postMessage({ type: 'READY' } satisfies NlpWorkerLifecycle)

self.addEventListener('message', (e: MessageEvent) => {
  const req = e.data as NlpWorkerRequest
  try {
    switch (req.type) {
      case 'INIT': {
        currentTier = req.payload.tier
        if (currentTier === 'regex') {
          self.postMessage({
            id: req.id,
            ok: true,
            data: { status: 'ready', tier: 'regex' },
          } satisfies NlpWorkerResponse)
        } else {
          // Future: load embeddings/LLM model
          // For now, fall back to regex
          self.postMessage({
            type: 'MODEL_ERROR',
            error: `${currentTier} model not yet available`,
          } satisfies NlpWorkerLifecycle)
          currentTier = 'regex'
          self.postMessage({
            id: req.id,
            ok: true,
            data: { status: 'ready', tier: 'regex' },
          } satisfies NlpWorkerResponse)
        }
        break
      }

      case 'PARSE': {
        const result = parseUtterance(req.payload.input, req.payload.context)
        self.postMessage({
          id: req.id,
          ok: true,
          data: result,
        } satisfies NlpWorkerResponse)
        break
      }

      case 'GET_STATUS': {
        self.postMessage({
          id: req.id,
          ok: true,
          data: { status: 'ready', tier: currentTier },
        } satisfies NlpWorkerResponse)
        break
      }
    }
  } catch (err) {
    self.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies NlpWorkerResponse)
  }
})
