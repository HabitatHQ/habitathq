import { findBestCategory, similarityToConfidence } from '~/lib/nlp/cosine'
import {
  embed,
  getCategoryIndex,
  isEmbeddingsLoaded,
  loadEmbeddingsModel,
} from '~/lib/nlp/embeddings'
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

self.addEventListener('message', async (e: MessageEvent) => {
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
        } else if (currentTier === 'embeddings') {
          // Load embeddings model
          try {
            await loadEmbeddingsModel((progress) => {
              self.postMessage({
                type: 'MODEL_PROGRESS',
                progress,
              } satisfies NlpWorkerLifecycle)
            })
            self.postMessage({
              type: 'MODEL_LOADED',
              tier: 'embeddings',
            } satisfies NlpWorkerLifecycle)
            self.postMessage({
              id: req.id,
              ok: true,
              data: { status: 'ready', tier: 'embeddings' },
            } satisfies NlpWorkerResponse)
          } catch (err) {
            // Fall back to regex
            self.postMessage({
              type: 'MODEL_ERROR',
              error: err instanceof Error ? err.message : 'Failed to load embeddings model',
            } satisfies NlpWorkerLifecycle)
            currentTier = 'regex'
            self.postMessage({
              id: req.id,
              ok: true,
              data: { status: 'ready', tier: 'regex' },
            } satisfies NlpWorkerResponse)
          }
        } else {
          // LLM tier — not yet available
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
        // Reconstruct Map from plain object sent over postMessage
        const ctx = req.payload.context
        if (ctx.merchantMappings && !(ctx.merchantMappings instanceof Map)) {
          ctx.merchantMappings = new Map(Object.entries(ctx.merchantMappings))
        }

        // Step 1: Always run regex parser first
        const result = parseUtterance(req.payload.input, ctx)

        // Step 2: If embeddings tier is active and any field is low confidence,
        // run embeddings to enhance
        if (currentTier === 'embeddings' && isEmbeddingsLoaded()) {
          for (const tx of result.transactions) {
            if (tx.categoryConfidence === 'low' || tx.categoryConfidence === 'medium') {
              // Try to resolve category with embeddings
              const textToEmbed = tx.merchant || tx.rawText
              const queryEmbedding = await embed(textToEmbed)
              if (queryEmbedding) {
                const match = findBestCategory(queryEmbedding, getCategoryIndex())
                if (match.similarity > 0.55) {
                  const embeddingConfidence = similarityToConfidence(match.similarity)
                  // Only upgrade if embeddings gives better confidence
                  if (
                    embeddingConfidence === 'high' ||
                    (embeddingConfidence === 'medium' && tx.categoryConfidence === 'low')
                  ) {
                    tx.categoryId = match.categoryId
                    tx.categoryConfidence = embeddingConfidence
                  }
                }
              }
            }
          }
        }

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
