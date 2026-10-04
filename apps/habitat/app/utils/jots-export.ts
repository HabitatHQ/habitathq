import { zipSync } from 'fflate'
import type { ImageNoteRow, Scribble, VoiceNoteRow } from '~/types/database'

interface JotsExportZipInput {
  textJots?: readonly Scribble[]
  voiceNotes?: readonly VoiceNoteRow[]
  imageNotes?: readonly ImageNoteRow[]
  getBlob: (id: string) => Promise<Uint8Array | null | undefined>
  exportedAt?: Date
}

function readableTimestamp(value: string): string {
  return value.slice(0, 19).replace(/[:.]/g, '-')
}

function mediaExtension(mimeType: string, fallback: string): string {
  return mimeType.split('/')[1]?.split(';')[0]?.trim() || fallback
}

function mediaPath(
  directory: 'voice' | 'images',
  createdAt: string,
  id: string,
  extension: string,
): string {
  return `${directory}/${readableTimestamp(createdAt)}--${encodeURIComponent(id)}.${extension}`
}

export async function buildJotsExportZip({
  textJots,
  voiceNotes,
  imageNotes,
  getBlob,
  exportedAt = new Date(),
}: JotsExportZipInput): Promise<Uint8Array | null> {
  const files: Record<string, Uint8Array> = {}

  if (textJots) {
    const json = JSON.stringify(
      { version: 1, exported_at: exportedAt.toISOString(), text: textJots },
      null,
      2,
    )
    files['jots.json'] = new TextEncoder().encode(json)
    for (const jot of textJots) {
      const body = jot.title ? `${jot.title}\n\n${jot.content}` : jot.content
      files[`text/${readableTimestamp(jot.updated_at)}.txt`] = new TextEncoder().encode(body)
    }
  }

  for (const row of voiceNotes ?? []) {
    const bytes = await getBlob(row.id)
    if (!bytes) continue
    const extension = mediaExtension(row.mime_type, 'audio')
    files[mediaPath('voice', row.created_at, row.id, extension)] = bytes
  }

  for (const row of imageNotes ?? []) {
    const bytes = await getBlob(row.id)
    if (!bytes) continue
    const extension = mediaExtension(row.mime_type, 'jpg')
    files[mediaPath('images', row.created_at, row.id, extension)] = bytes
  }

  return Object.keys(files).length > 0 ? zipSync(files) : null
}
