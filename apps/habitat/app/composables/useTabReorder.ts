/**
 * iOS-style drag-and-drop reorder composable.
 *
 * Creates a floating clone of the dragged element that follows the pointer,
 * while other items smoothly shift to make room — like rearranging app icons
 * on the iOS home screen.
 *
 * Works with both mouse and touch via Pointer Events API.
 * Zero external dependencies.
 */

export interface DragReorderOptions {
  /** 'vertical' for settings list, 'horizontal' for bottom nav */
  orientation: 'vertical' | 'horizontal'
}

export interface DragReorderState {
  /** Whether a drag is currently in progress */
  dragging: boolean
  /** Index of the item being dragged (-1 when idle) */
  dragIndex: number
  /** Index the dragged item is currently hovering over (-1 when idle) */
  overIndex: number
}

export function useDragReorder<T>(
  items: Ref<T[]> | ComputedRef<T[]>,
  onReorder: (newOrder: T[]) => void,
  options: DragReorderOptions,
) {
  const state = reactive<DragReorderState>({
    dragging: false,
    dragIndex: -1,
    overIndex: -1,
  })

  let containerEl: HTMLElement | null = null
  let itemEls: HTMLElement[] = []
  let floatingEl: HTMLElement | null = null
  let pointerId: number | null = null

  // Offset from pointer to the element's top-left corner
  let offsetX = 0
  let offsetY = 0

  // Original rects captured at drag start (before any transforms)
  let itemRects: DOMRect[] = []

  const isHorizontal = () => options.orientation === 'horizontal'

  function getPos(e: PointerEvent): number {
    return isHorizontal() ? e.clientX : e.clientY
  }

  /** Find the index the dragged item should be inserted at, based on pointer position */
  function findOverIndex(pos: number): number {
    for (let i = 0; i < itemRects.length; i++) {
      const rect = itemRects[i]!
      const center = isHorizontal()
        ? rect.left + rect.width / 2
        : rect.top + rect.height / 2
      if (pos < center) return i
    }
    return itemRects.length - 1
  }

  /** Apply CSS transforms to shift items around the dragged item */
  function applyShifts() {
    const from = state.dragIndex
    const to = state.overIndex
    if (from < 0 || to < 0) return

    for (let i = 0; i < itemEls.length; i++) {
      const el = itemEls[i]!
      if (i === from) {
        // The dragged item is invisible (the floating clone is shown instead)
        continue
      }

      let shift = 0
      if (from < to) {
        // Dragged item moved forward: items between (from, to] shift backward
        if (i > from && i <= to) {
          const prevRect = itemRects[i - 1]!
          const thisRect = itemRects[i]!
          shift = isHorizontal()
            ? prevRect.left - thisRect.left
            : prevRect.top - thisRect.top
        }
      } else if (from > to) {
        // Dragged item moved backward: items between [to, from) shift forward
        if (i >= to && i < from) {
          const nextRect = itemRects[i + 1]!
          const thisRect = itemRects[i]!
          shift = isHorizontal()
            ? nextRect.left - thisRect.left
            : nextRect.top - thisRect.top
        }
      }

      el.style.transition = 'translate 200ms cubic-bezier(0.2, 0, 0, 1)'
      el.style.translate = shift ? (isHorizontal() ? `${shift}px 0` : `0 ${shift}px`) : ''
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!state.dragging || !floatingEl) return
    e.preventDefault()

    // Move the floating clone to follow the pointer
    const x = e.clientX - offsetX
    const y = e.clientY - offsetY
    floatingEl.style.left = `${x}px`
    floatingEl.style.top = `${y}px`

    // Determine which slot the pointer is over
    const pos = getPos(e)
    const newOver = findOverIndex(pos)
    if (newOver !== state.overIndex) {
      state.overIndex = newOver
      applyShifts()
    }
  }

  function onPointerUp(_e: PointerEvent) {
    if (!state.dragging) return

    const from = state.dragIndex
    const to = state.overIndex
    if (from !== to && from >= 0 && to >= 0) {
      const arr = [...toValue(items)]
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved!)
      onReorder(arr)
    }

    cleanup()
  }

  function cleanup() {
    // Remove the floating clone
    if (floatingEl) {
      floatingEl.remove()
      floatingEl = null
    }

    // Reset transforms and visibility on all items
    for (const el of itemEls) {
      el.style.transform = ''
      el.style.translate = ''
      el.style.transition = ''
      el.style.opacity = ''
      el.style.pointerEvents = ''
    }

    if (pointerId !== null && containerEl) {
      try { containerEl.releasePointerCapture(pointerId) } catch {}
    }

    state.dragging = false
    state.dragIndex = -1
    state.overIndex = -1
    pointerId = null

    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)
  }

  /**
   * Call from @pointerdown on each draggable item (or its handle).
   */
  function onPointerDown(index: number, event: PointerEvent, container: HTMLElement) {
    if (event.button !== 0) return
    event.preventDefault()

    containerEl = container
    itemEls = Array.from(container.children) as HTMLElement[]
    pointerId = event.pointerId

    // Capture rects before any transforms
    itemRects = itemEls.map((el) => el.getBoundingClientRect())

    const sourceEl = itemEls[index]!
    const sourceRect = itemRects[index]!

    // Create a floating clone
    floatingEl = sourceEl.cloneNode(true) as HTMLElement
    floatingEl.style.position = 'fixed'
    floatingEl.style.zIndex = '9999'
    floatingEl.style.left = `${sourceRect.left}px`
    floatingEl.style.top = `${sourceRect.top}px`
    floatingEl.style.width = `${sourceRect.width}px`
    floatingEl.style.height = `${sourceRect.height}px`
    floatingEl.style.margin = '0'
    floatingEl.style.pointerEvents = 'none'
    floatingEl.style.boxSizing = 'border-box'
    floatingEl.style.willChange = 'transform'
    // iOS-style lift: scale up, add shadow, slight opacity
    floatingEl.style.transform = 'scale(1.05)'
    floatingEl.style.boxShadow = '0 12px 28px rgba(0,0,0,0.35), 0 4px 10px rgba(0,0,0,0.25)'
    floatingEl.style.borderRadius = '12px'
    floatingEl.style.opacity = '0.95'
    floatingEl.style.transition = 'transform 150ms ease, box-shadow 150ms ease'

    // Match the background of the original card so it's not transparent
    const computedBg = getComputedStyle(sourceEl).backgroundColor
    if (!computedBg || computedBg === 'rgba(0, 0, 0, 0)' || computedBg === 'transparent') {
      // Inherit from container or use a fallback
      const containerBg = getComputedStyle(container).backgroundColor
      floatingEl.style.backgroundColor = containerBg && containerBg !== 'rgba(0, 0, 0, 0)'
        ? containerBg
        : getComputedStyle(document.documentElement).getPropertyValue('--ui-bg-muted') || '#1e293b'
    }

    document.body.appendChild(floatingEl)

    // Calculate offset from pointer to element origin so it doesn't jump
    offsetX = event.clientX - sourceRect.left
    offsetY = event.clientY - sourceRect.top

    // Make the original invisible (but keep its space)
    sourceEl.style.opacity = '0'
    sourceEl.style.pointerEvents = 'none'

    state.dragging = true
    state.dragIndex = index
    state.overIndex = index

    try { containerEl.setPointerCapture(pointerId) } catch {}

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
  }

  onUnmounted(cleanup)

  return { state: readonly(state), onPointerDown }
}
