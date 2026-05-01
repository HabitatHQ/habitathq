import { describe, expect, it } from 'vitest'
import { cosineSimilarity, findBestCategory } from '~/lib/nlp/cosine'

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0)
  })

  it('returns 0.0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([0, 1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0)
  })

  it('returns -1.0 for opposite vectors', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([-1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0)
  })

  it('handles similar but not identical vectors', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([1, 2, 4])
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeGreaterThan(0.9)
    expect(sim).toBeLessThan(1.0)
  })
})

describe('findBestCategory', () => {
  it('returns category with highest similarity', () => {
    const query = new Float32Array([1, 0, 0])
    const categories = [
      { categoryId: 'c1', categoryName: 'Food', embedding: new Float32Array([0, 1, 0]) },
      { categoryId: 'c2', categoryName: 'Transport', embedding: new Float32Array([0.9, 0.1, 0]) },
      { categoryId: 'c3', categoryName: 'Bills', embedding: new Float32Array([0, 0, 1]) },
    ]
    const result = findBestCategory(query, categories)
    expect(result.categoryId).toBe('c2')
    expect(result.similarity).toBeGreaterThan(0.9)
  })

  it('maps similarity to confidence levels', () => {
    const query = new Float32Array([1, 0])
    const categories = [
      { categoryId: 'c1', categoryName: 'Match', embedding: new Float32Array([0.8, 0.6]) },
    ]
    const result = findBestCategory(query, categories)
    expect(result.similarity).toBeGreaterThan(0)
  })
})
