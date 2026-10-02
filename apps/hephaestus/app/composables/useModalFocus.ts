import { watch } from 'vue'

/** Restore keyboard focus for a programmatically opened Nuxt UI modal. */
export function useModalFocus(open: () => boolean) {
  let opener: HTMLElement | null = null
  watch(open, (isOpen) => {
    if (isOpen && document.activeElement instanceof HTMLElement) {
      opener = document.activeElement
    }
  })
  return {
    onCloseAutoFocus(event: Event) {
      if (!opener?.isConnected) return
      event.preventDefault()
      opener.focus()
    },
  }
}
