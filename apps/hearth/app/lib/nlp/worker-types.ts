import type { ParseResult, ParserContext } from './types'

export type NlpWorkerRequest =
  | { id: string; type: 'INIT'; payload: { tier: NlpTier } }
  | { id: string; type: 'PARSE'; payload: { input: string; context: ParserContext } }
  | { id: string; type: 'GET_STATUS' }

export type NlpTier = 'regex' | 'embeddings' | 'llm'

export type NlpWorkerResponse =
  | { id: string; ok: true; data: ParseResult | NlpStatusData }
  | { id: string; ok: false; error: string }

export interface NlpStatusData {
  status: 'ready' | 'loading' | 'error'
  tier: NlpTier
}

export type NlpWorkerLifecycle =
  | { type: 'READY' }
  | { type: 'MODEL_PROGRESS'; progress: number }
  | { type: 'MODEL_LOADED'; tier: NlpTier }
  | { type: 'MODEL_ERROR'; error: string }
