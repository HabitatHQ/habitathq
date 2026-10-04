import { Capacitor } from '@capacitor/core'
import { onUnmounted, type Ref, ref } from 'vue'

interface SpeechRecognitionAlternative {
  transcript: string
  confidence?: number
}

interface SpeechRecognitionResult {
  isFinal: boolean
  readonly 0: SpeechRecognitionAlternative
}

interface SpeechRecognitionResultList {
  length: number
  readonly [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResultEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
}

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

interface SpeechInputReturn {
  isSupported: Ref<boolean>
  isListening: Ref<boolean>
  transcript: Ref<string>
  confidence: Ref<number>
  error: Ref<string | null>
  start: () => Promise<void>
  stop: () => void
}

let recognition: SpeechRecognitionInstance | null = null

function getSpeechRecognitionClass(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function useSpeechInput(): SpeechInputReturn {
  const isSupported = ref(false)
  const isListening = ref(false)
  const transcript = ref('')
  const confidence = ref(1)
  const error = ref<string | null>(null)

  if (import.meta.client) {
    if (Capacitor.isNativePlatform()) {
      isSupported.value = true
    } else {
      isSupported.value = !!getSpeechRecognitionClass()
    }
  }

  async function start() {
    error.value = null
    transcript.value = ''
    confidence.value = 1

    if (Capacitor.isNativePlatform()) {
      await startNative()
    } else {
      startWeb()
    }
  }

  function startWeb() {
    const SR = getSpeechRecognitionClass()
    if (!SR) {
      error.value = 'Speech recognition not supported in this browser'
      return
    }

    recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      isListening.value = true
    }
    recognition.onresult = (e) => {
      let finalTranscript = ''
      let interimTranscript = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (!result) continue
        if (result.isFinal) {
          finalTranscript += result[0].transcript
          confidence.value = result[0].confidence ?? 1
        } else {
          interimTranscript += result[0].transcript
        }
      }
      transcript.value = finalTranscript || interimTranscript
    }
    recognition.onerror = (e) => {
      error.value =
        e.error === 'not-allowed'
          ? 'Microphone permission denied'
          : e.error === 'no-speech'
            ? 'No speech detected'
            : `Speech error: ${e.error}`
      isListening.value = false
    }
    recognition.onend = () => {
      isListening.value = false
    }
    recognition.start()
  }

  async function startNative() {
    try {
      // Dynamic import — only loaded on native platforms
      const mod = await import('@capacitor-community/speech-recognition')
      const SR = mod.SpeechRecognition
      const { available } = await SR.available()
      if (!available) {
        error.value = 'Speech recognition not available'
        isSupported.value = false
        return
      }

      const perm = await SR.requestPermissions()
      if (perm.speechRecognition !== 'granted') {
        error.value = 'Microphone permission denied'
        return
      }

      isListening.value = true
      SR.addListener('partialResults', (data: { matches: string[] }) => {
        const match = data.matches[0]
        if (match !== undefined) transcript.value = match
      })

      await SR.start({
        language: 'en-US',
        partialResults: true,
        popup: false,
      })
    } catch (e) {
      error.value = `Speech error: ${e instanceof Error ? e.message : String(e)}`
      isListening.value = false
    }
  }

  function stop() {
    if (Capacitor.isNativePlatform()) {
      import('@capacitor-community/speech-recognition').then((mod) => {
        mod.SpeechRecognition.stop()
      })
    } else {
      recognition?.stop()
    }
    isListening.value = false
  }

  onUnmounted(() => {
    stop()
  })

  return { isSupported, isListening, transcript, confidence, error, start, stop }
}
