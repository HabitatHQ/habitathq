import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { ImageNoteRow, Scribble, VoiceNoteRow } from '~/types/database'
import { buildJotsExportZip } from '~/utils/jots-export'

const createdAt = '2026-04-03T02:01:00.000Z'

const voiceNotes: VoiceNoteRow[] = [
  { id: 'voice-one', title: '', mime_type: 'audio/webm', duration: 1, created_at: createdAt },
  { id: 'voice-two', title: '', mime_type: 'audio/webm', duration: 1, created_at: createdAt },
]

const imageNotes: ImageNoteRow[] = [
  { id: 'image-one', mime_type: 'image/png', filename: 'first.png', title: '', created_at: createdAt },
  { id: 'image-two', mime_type: 'image/png', filename: 'second.png', title: '', created_at: createdAt },
]

const blobs = new Map<string, Uint8Array>([
  ['voice-one', new Uint8Array([0, 255, 1, 128])],
  ['voice-two', new Uint8Array([4, 0, 222, 173])],
  ['image-one', new Uint8Array([137, 80, 78, 71, 0, 255])],
  ['image-two', new Uint8Array([255, 216, 0, 17, 128])],
])

describe('buildJotsExportZip', () => {
  it('keeps both text notes when their update timestamps collide', async () => {
    const textJots: Scribble[] = ['first', 'second'].map((id) => ({
      id,
      title: id,
      content: `${id} body`,
      tags: [],
      annotations: {},
      entry_date: '2026-04-03',
      created_at: createdAt,
      updated_at: createdAt,
    }))
    const zipped = await buildJotsExportZip({ textJots, getBlob: async () => null })

    expect(zipped).not.toBeNull()
    const archive = unzipSync(zipped!)
    expect(Object.keys(archive).sort()).toEqual([
      'jots.json',
      'text/2026-04-03T02-01-00--first.txt',
      'text/2026-04-03T02-01-00--second.txt',
    ])
    expect(new TextDecoder().decode(archive['text/2026-04-03T02-01-00--first.txt'])).toBe(
      'first\n\nfirst body',
    )
    expect(new TextDecoder().decode(archive['text/2026-04-03T02-01-00--second.txt'])).toBe(
      'second\n\nsecond body',
    )
  })

  it('preserves every colliding voice and image record with its exact bytes', async () => {
    const zipped = await buildJotsExportZip({
      voiceNotes,
      imageNotes,
      getBlob: async (id) => blobs.get(id),
    })

    expect(zipped).not.toBeNull()
    const archive = unzipSync(zipped!)
    const paths = Object.keys(archive).sort()
    expect(paths).toEqual([
      'images/2026-04-03T02-01-00--image-one.png',
      'images/2026-04-03T02-01-00--image-two.png',
      'voice/2026-04-03T02-01-00--voice-one.webm',
      'voice/2026-04-03T02-01-00--voice-two.webm',
    ])

    expect(archive['voice/2026-04-03T02-01-00--voice-one.webm']).toEqual(blobs.get('voice-one'))
    expect(archive['voice/2026-04-03T02-01-00--voice-two.webm']).toEqual(blobs.get('voice-two'))
    expect(archive['images/2026-04-03T02-01-00--image-one.png']).toEqual(blobs.get('image-one'))
    expect(archive['images/2026-04-03T02-01-00--image-two.png']).toEqual(blobs.get('image-two'))
  })
})
