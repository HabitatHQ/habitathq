import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @capacitor/core to always report non-native
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}))

// Mock vue's onUnmounted since we're outside component context
vi.mock('vue', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, onUnmounted: vi.fn() }
})

describe('useSpeechInput — confidence', () => {
  // This object IS the recognition instance the composable will use.
  // The constructor returns it directly, so composable event handlers
  // are set on this exact reference.
  let mockInstance: Record<string, unknown>

  beforeEach(async () => {
    vi.resetModules()

    mockInstance = {
      continuous: false,
      interimResults: false,
      lang: '',
      onstart: null,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(() => {
        ;(mockInstance.onstart as (() => void) | null)?.()
      }),
      stop: vi.fn(() => {
        ;(mockInstance.onend as (() => void) | null)?.()
      }),
    }

    // Constructor must return `mockInstance` so the composable's
    // `recognition = new SR()` points to the same object we control.
    // Must be a regular function (not arrow) to support `new`.
    // biome-ignore lint/suspicious/noExplicitAny: test mock requires dynamic global assignment
    ;(globalThis as any).SpeechRecognition = function MockSR() {
      return mockInstance
    }
  })

  it('exposes a confidence ref defaulting to 1.0', async () => {
    const { useSpeechInput } = await import('~/composables/useSpeechInput')
    const result = useSpeechInput()
    expect(result).toHaveProperty('confidence')
    expect(result.confidence.value).toBe(1)
  })

  it('captures confidence from final speech result', async () => {
    const { useSpeechInput } = await import('~/composables/useSpeechInput')
    const { confidence, start } = useSpeechInput()

    await start()

    // Simulate a final result with 0.82 confidence
    ;(mockInstance.onresult as (e: unknown) => void)({
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          0: { transcript: 'six dollars coffee', confidence: 0.82 },
          length: 1,
        },
      ],
    })

    expect(confidence.value).toBeCloseTo(0.82)
  })

  it('does not update confidence for interim results', async () => {
    const { useSpeechInput } = await import('~/composables/useSpeechInput')
    const { confidence, start } = useSpeechInput()

    await start()

    ;(mockInstance.onresult as (e: unknown) => void)({
      resultIndex: 0,
      results: [
        {
          isFinal: false,
          0: { transcript: 'six', confidence: 0.4 },
          length: 1,
        },
      ],
    })

    expect(confidence.value).toBe(1) // unchanged from default
  })

  it('resets confidence to 1.0 on start()', async () => {
    const { useSpeechInput } = await import('~/composables/useSpeechInput')
    const { confidence, start } = useSpeechInput()

    await start()

    ;(mockInstance.onresult as (e: unknown) => void)({
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          0: { transcript: 'something', confidence: 0.3 },
          length: 1,
        },
      ],
    })
    expect(confidence.value).toBeCloseTo(0.3)

    // Start again — confidence should reset
    await start()
    expect(confidence.value).toBe(1)
  })
})
