<script setup lang="ts">
interface VoiceNote {
  id: string
  blob: Blob
  mimeType: string
  duration: number   // seconds at stop time
  created_at: string
  url?: string       // revocable object URL, created on load
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const IDB_NAME = 'habitat'
const IDB_STORE = 'voice_notes'
let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => { _db = req.result; resolve(req.result) }
    req.onerror = () => reject(req.error)
  })
}

async function idbGetAll(): Promise<Omit<VoiceNote, 'url'>[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(note: Omit<VoiceNote, 'url'>): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(note)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ─── State ────────────────────────────────────────────────────────────────────

const notes = ref<VoiceNote[]>([])
const recording = ref(false)
const recordingSeconds = ref(0)
const errorMsg = ref<string | null>(null)
const currentlyPlaying = ref<string | null>(null)

let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []
let recordingTimer: ReturnType<typeof setInterval> | null = null
const audioMap = new Map<string, HTMLAudioElement>()

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  const stored = await idbGetAll()
  stored.sort((a, b) => b.created_at.localeCompare(a.created_at))
  notes.value = stored.map(n => ({ ...n, url: URL.createObjectURL(n.blob) }))
})

onUnmounted(() => {
  stopRecording()
  notes.value.forEach(n => { if (n.url) URL.revokeObjectURL(n.url) })
  audioMap.forEach(a => a.pause())
})

// ─── Format helpers ───────────────────────────────────────────────────────────

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameDay(d, today)) return `Today, ${time}`
  if (sameDay(d, yesterday)) return `Yesterday, ${time}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + `, ${time}`
}

// ─── Recording ────────────────────────────────────────────────────────────────

async function startRecording() {
  errorMsg.value = null
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    errorMsg.value = 'Microphone access denied. Please allow access in your browser settings.'
    return
  }

  chunks = []
  const mimeType = pickMimeType()
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop())
    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
    const note: Omit<VoiceNote, 'url'> = {
      id: crypto.randomUUID(),
      blob,
      mimeType: mimeType || 'audio/webm',
      duration: recordingSeconds.value,
      created_at: new Date().toISOString(),
    }
    await idbPut(note)
    notes.value.unshift({ ...note, url: URL.createObjectURL(blob) })
    recordingSeconds.value = 0
  }
  mediaRecorder.start(100)
  recording.value = true
  recordingTimer = setInterval(() => { recordingSeconds.value++ }, 1000)
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
  recording.value = false
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null }
}

function toggleRecording() {
  recording.value ? stopRecording() : startRecording()
}

// ─── Playback ─────────────────────────────────────────────────────────────────

function togglePlay(note: VoiceNote) {
  if (!note.url) return
  if (currentlyPlaying.value && currentlyPlaying.value !== note.id) {
    audioMap.get(currentlyPlaying.value)?.pause()
    currentlyPlaying.value = null
  }
  let audio = audioMap.get(note.id)
  if (!audio) {
    audio = new Audio(note.url)
    audio.onended = () => { currentlyPlaying.value = null }
    audioMap.set(note.id, audio)
  }
  if (currentlyPlaying.value === note.id) {
    audio.pause()
    currentlyPlaying.value = null
  } else {
    audio.play()
    currentlyPlaying.value = note.id
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteNote(note: VoiceNote) {
  const audio = audioMap.get(note.id)
  if (audio) { audio.pause(); audioMap.delete(note.id) }
  if (currentlyPlaying.value === note.id) currentlyPlaying.value = null
  if (note.url) URL.revokeObjectURL(note.url)
  await idbDelete(note.id)
  notes.value = notes.value.filter(n => n.id !== note.id)
}
</script>

<template>
  <div class="space-y-5">
    <header>
      <p class="text-sm text-slate-500">Voice Notes</p>
      <h2 class="text-2xl font-bold">Record</h2>
    </header>

    <!-- Error -->
    <UAlert
      v-if="errorMsg"
      :title="errorMsg"
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-circle"
      :close-button="{ icon: 'i-heroicons-x-mark', color: 'error', variant: 'ghost', size: 'sm' }"
      @close="errorMsg = null"
    />

    <!-- Record button -->
    <div class="flex flex-col items-center gap-3 py-8">
      <button
        class="w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        :class="recording
          ? 'bg-red-500 shadow-xl shadow-red-500/30 scale-105'
          : 'bg-slate-800 hover:bg-slate-700'"
        :aria-label="recording ? 'Stop recording' : 'Start recording'"
        @click="toggleRecording"
      >
        <UIcon
          :name="recording ? 'i-heroicons-stop' : 'i-heroicons-microphone'"
          class="w-10 h-10"
          :class="recording ? 'text-white' : 'text-slate-300'"
        />
      </button>

      <p v-if="recording" class="text-red-400 text-sm font-mono tabular-nums animate-pulse">
        ● {{ fmtDuration(recordingSeconds) }}
      </p>
      <p v-else class="text-xs text-slate-500">Tap to record</p>
    </div>

    <!-- Empty state -->
    <section v-if="notes.length === 0 && !recording" class="flex flex-col items-center gap-2 py-6 text-center">
      <UIcon name="i-heroicons-microphone" class="w-8 h-8 text-slate-700" />
      <p class="text-sm text-slate-500">No recordings yet. Tap the button above to start.</p>
    </section>

    <!-- Notes list -->
    <div v-else-if="notes.length > 0" class="space-y-2">
      <UCard
        v-for="note in notes"
        :key="note.id"
        :ui="{ root: 'rounded-2xl', body: 'px-4 py-3 sm:px-4 sm:py-3' }"
      >
        <div class="flex items-center gap-3">
          <!-- Play / pause -->
          <UButton
            :icon="currentlyPlaying === note.id ? 'i-heroicons-pause' : 'i-heroicons-play'"
            :color="currentlyPlaying === note.id ? 'primary' : 'neutral'"
            :variant="currentlyPlaying === note.id ? 'soft' : 'outline'"
            size="sm"
            :ui="{ base: 'rounded-full' }"
            @click="togglePlay(note)"
          />

          <!-- Meta -->
          <div class="flex-1 min-w-0">
            <p class="text-sm text-slate-300 truncate">{{ fmtDate(note.created_at) }}</p>
            <p class="text-xs text-slate-500 tabular-nums">{{ fmtDuration(note.duration) }}</p>
          </div>

          <!-- Delete -->
          <UButton
            icon="i-heroicons-trash"
            color="neutral"
            variant="ghost"
            size="sm"
            class="text-slate-600 hover:text-red-400"
            @click="deleteNote(note)"
          />
        </div>
      </UCard>
    </div>
  </div>
</template>
