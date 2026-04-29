<script setup lang="ts">
// Voice recorder bottom sheet
const emit = defineEmits<{ close: [] }>()
const store = useJotsStore()
const { impact, notification } = useHaptics()

// ─── Speech Recognition types ─────────────────────────────────────────────────
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly 0: { transcript: string }
}
interface SpeechRecognitionResultList {
  readonly length: number
  [i: number]: SpeechRecognitionResult | undefined
}
interface SpeechRecognitionResultEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEvt extends Event {
  readonly error: string
}
interface SpeechRecognizer extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: SpeechRecognitionErrorEvt) => void) | null
  start(): void
  stop(): void
}
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognizer
    webkitSpeechRecognition: new () => SpeechRecognizer
  }
}

// ─── Recording state ──────────────────────────────────────────────────────────

const isRecording = ref(false)
const recordDuration = ref(0)
const liveTranscript = ref('')
const partialTranscript = ref('')
const errorMsg = ref<string | null>(null)

let mediaRecorder: MediaRecorder | null = null
const chunks: Blob[] = []
let sr: SpeechRecognizer | null = null
let timerIv: ReturnType<typeof setInterval> | null = null

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    const mimeType = preferred.find((m) => MediaRecorder.isTypeSupported(m)) || ''
    mediaRecorder = new MediaRecorder(stream, { mimeType })
    chunks.length = 0
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    mediaRecorder.onstop = () => {
      for (const t of stream.getTracks()) t.stop()
    }
    mediaRecorder.start(200)
    isRecording.value = true
    void impact('medium')
    recordDuration.value = 0
    timerIv = setInterval(() => {
      recordDuration.value++
    }, 1000)

    const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SRClass) {
      sr = new SRClass()
      sr.continuous = true
      sr.interimResults = true
      sr.lang = 'en-US'
      sr.onresult = (e: SpeechRecognitionResultEvent) => {
        let finalText = ''
        let interimText = ''
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i]
          if (!r) continue
          if (r.isFinal) finalText += r[0].transcript
          else interimText += r[0].transcript
        }
        if (finalText) liveTranscript.value += `${finalText} `
        partialTranscript.value = interimText
      }
      sr.onerror = () => {}
      sr.onend = () => {
        if (isRecording.value && sr) {
          try {
            sr.start()
          } catch {}
        }
      }
      sr.start()
    }
  } catch (err: unknown) {
    errorMsg.value = `Microphone access denied: ${err instanceof Error ? err.message : String(err)}`
  }
}

function stopRecording() {
  if (timerIv) {
    clearInterval(timerIv)
    timerIv = null
  }
  if (sr) {
    try {
      sr.stop()
    } catch {}
    sr = null
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
  isRecording.value = false
  void impact('medium')
}

// ─── Save ─────────────────────────────────────────────────────────────────────

const saving = ref(false)

async function saveRecording() {
  if (chunks.length === 0 || saving.value) return
  saving.value = true
  try {
    const mimeType = mediaRecorder?.mimeType || 'audio/webm'
    const blob = new Blob(chunks, { type: mimeType })
    const id = crypto.randomUUID()
    await store.addVoiceNote({
      id,
      blob,
      mimeType,
      duration: recordDuration.value,
      created_at: new Date().toISOString(),
    })
    void notification('success')

    const fullTranscript = (liveTranscript.value + partialTranscript.value).trim()
    if (fullTranscript) {
      showTranscript.value = true
      transcriptText.value = fullTranscript
      transcriptNoteId.value = id
      return
    }
    emit('close')
  } finally {
    saving.value = false
  }
}

// ─── Transcript modal ─────────────────────────────────────────────────────────

const showTranscript = ref(false)
const transcriptText = ref('')
const transcriptNoteId = ref('')
const savingTranscript = ref(false)

async function saveTranscript() {
  if (savingTranscript.value || !transcriptText.value.trim()) return
  savingTranscript.value = true
  try {
    await store.db.createScribble({
      title: `Voice transcript — ${new Date().toLocaleDateString()}`,
      content: transcriptText.value.trim(),
      tags: ['habitat-voice-transcript'],
      annotations: { source_voice_id: transcriptNoteId.value },
    })
    await store.refreshScribbles()
    emit('close')
  } finally {
    savingTranscript.value = false
  }
}

function discardTranscript() {
  showTranscript.value = false
  emit('close')
}

function handleClose() {
  if (!isRecording.value) emit('close')
}

onUnmounted(() => {
  if (timerIv) clearInterval(timerIv)
  if (sr)
    try {
      sr.stop()
    } catch {}
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
})
</script>

<template>
  <!-- Sheet content -->
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-base font-semibold">Voice Recording</h3>
      <UButton :icon="resolveIcon('x-mark')" variant="ghost" color="neutral" size="sm" :disabled="isRecording" @click="handleClose" />
    </div>

    <UAlert
      v-if="errorMsg"
      :title="errorMsg"
      color="error"
      variant="soft"
      :icon="resolveIcon('exclamation-circle')"
      :close-button="{ icon: resolveIcon('x-mark'), color: 'error', variant: 'ghost', size: 'sm' }"
      @close="errorMsg = null"
    />

    <div class="flex flex-col items-center gap-5 py-4">
      <div class="text-4xl type-timer text-(--ui-text)">
        {{ fmtDuration(recordDuration) }}
      </div>

      <button
        class="w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300"
        :class="isRecording
          ? 'bg-red-500/20 border-2 border-red-500 animate-pulse'
          : 'bg-(--ui-bg-elevated) border-2 border-(--ui-border-accented) hover:border-primary-500'"
        @click="isRecording ? stopRecording() : startRecording()"
      >
        <AppIcon
          :name="isRecording ? 'stop' : 'microphone'"
          class="w-8 h-8"
          :class="isRecording ? 'text-red-400' : 'text-rose-400'"
        />
      </button>

      <p class="text-xs text-(--ui-text-dimmed)">
        {{ isRecording ? 'Tap to stop recording' : 'Tap to start recording' }}
      </p>

      <div
        v-if="isRecording && (liveTranscript || partialTranscript)"
        class="w-full p-3 rounded-xl bg-(--ui-bg-elevated) border border-(--ui-border)"
      >
        <p class="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Live Transcript</p>
        <p class="text-sm text-(--ui-text-toned) leading-relaxed">
          {{ liveTranscript }}
          <span class="text-(--ui-text-dimmed) italic">{{ partialTranscript }}</span>
        </p>
      </div>

      <div v-if="!isRecording && recordDuration > 0" class="flex gap-3 pt-2">
        <UButton variant="soft" color="neutral" @click="handleClose">Discard</UButton>
        <UButton :loading="saving" @click="saveRecording">Save Recording</UButton>
      </div>
    </div>

    <!-- Transcript save modal (nested) -->
    <Teleport to="body">
      <div v-if="showTranscript" class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="discardTranscript" />
        <div class="relative w-full sm:max-w-md bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[70dvh] overflow-y-auto overscroll-contain">
          <h3 class="text-base font-semibold">Save Transcript?</h3>
          <p class="text-xs text-(--ui-text-dimmed)">Voice note saved. Save the transcript as a text jot?</p>
          <AppTextArea v-model="transcriptText" autoresize :rows="4" class="w-full" />
          <div class="flex gap-2 pt-1">
            <UButton variant="soft" color="neutral" class="flex-1" @click="discardTranscript">Skip</UButton>
            <UButton class="flex-1" :loading="savingTranscript" :disabled="!transcriptText.trim()" @click="saveTranscript">Save as Jot</UButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
