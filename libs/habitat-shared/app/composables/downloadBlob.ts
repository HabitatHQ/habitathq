/** Download a Blob in a browser and release its temporary object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Blob downloads are only available in a browser')
  }

  const objectUrl = URL.createObjectURL(blob)
  let anchor: HTMLAnchorElement | null = null
  try {
    anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    anchor.hidden = true
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor?.remove()
    URL.revokeObjectURL(objectUrl)
  }
}
