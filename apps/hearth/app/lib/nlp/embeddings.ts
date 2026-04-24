import { CATEGORY_DESCRIPTIONS } from './category-descriptions'
import type { CategoryEmbedding } from './cosine'

/**
 * Embeddings tier manager.
 * Handles model loading, category index building, and inference.
 *
 * Uses @huggingface/transformers for browser-compatible sentence embeddings.
 * The model (~15MB) is lazy-loaded and cached in browser storage.
 */

// biome-ignore lint/suspicious/noExplicitAny: dynamic model types
let pipeline: any = null
let categoryIndex: CategoryEmbedding[] = []
let isLoaded = false

export function isEmbeddingsLoaded(): boolean {
  return isLoaded
}

/**
 * Load the sentence embedding model.
 * @param onProgress callback for download progress (0-100)
 */
export async function loadEmbeddingsModel(onProgress?: (progress: number) => void): Promise<void> {
  if (isLoaded) return

  try {
    // Dynamic import — only loaded when embeddings tier is activated
    const { pipeline: createPipeline } = await import('@huggingface/transformers')

    onProgress?.(10)

    pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      // biome-ignore lint/suspicious/noExplicitAny: @huggingface/transformers progress callback type varies by version
      progress_callback: (info: any) => {
        if (info?.progress != null) {
          onProgress?.(Math.round(10 + info.progress * 0.8))
        }
      },
    })

    onProgress?.(90)

    // Build category index
    categoryIndex = await buildCategoryIndex()

    onProgress?.(100)
    isLoaded = true
  } catch (e) {
    isLoaded = false
    throw e
  }
}

/** Pre-compute embeddings for all category descriptions */
async function buildCategoryIndex(): Promise<CategoryEmbedding[]> {
  const entries = Object.entries(CATEGORY_DESCRIPTIONS)
  const index: CategoryEmbedding[] = []

  for (const [categoryId, description] of entries) {
    const embedding = await embed(description)
    if (embedding) {
      index.push({
        categoryId,
        categoryName: description.split(' - ')[0] ?? categoryId,
        embedding,
      })
    }
  }

  return index
}

/** Embed a text string into a vector */
export async function embed(text: string): Promise<Float32Array | null> {
  if (!pipeline) return null
  try {
    const output = await pipeline(text, { pooling: 'mean', normalize: true })
    return new Float32Array(output.data)
  } catch {
    return null
  }
}

/** Get the pre-computed category index */
export function getCategoryIndex(): CategoryEmbedding[] {
  return categoryIndex
}
