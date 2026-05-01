export interface CategoryEmbedding {
  categoryId: string
  categoryName: string
  embedding: Float32Array
}

/** Compute cosine similarity between two vectors */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0
  return dot / denom
}

/** Find the best matching category by cosine similarity */
export function findBestCategory(
  queryEmbedding: Float32Array,
  categoryEmbeddings: CategoryEmbedding[],
): { categoryId: string; similarity: number } {
  let best = { categoryId: '', similarity: -1 }
  for (const cat of categoryEmbeddings) {
    const sim = cosineSimilarity(queryEmbedding, cat.embedding)
    if (sim > best.similarity) {
      best = { categoryId: cat.categoryId, similarity: sim }
    }
  }
  return best
}

/** Map similarity to confidence level */
export function similarityToConfidence(similarity: number): 'high' | 'medium' | 'low' {
  if (similarity > 0.75) return 'high'
  if (similarity > 0.55) return 'medium'
  return 'low'
}
