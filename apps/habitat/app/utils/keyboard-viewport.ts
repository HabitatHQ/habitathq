/**
 * Returns the part of the layout viewport covered by the virtual keyboard.
 *
 * On iOS, `window.innerHeight` continues to represent the layout viewport.
 * Normalize visual viewport height by pinch-zoom scale so zoom alone is not
 * mistaken for keyboard occlusion, while a keyboard remains detectable at any
 * zoom level.
 */
export function getKeyboardInset(
  layoutViewportHeight: number,
  visualViewport: Pick<VisualViewport, 'height' | 'scale'> &
    Partial<Pick<VisualViewport, 'offsetTop'>>,
): number {
  const scale = visualViewport.scale > 0 ? visualViewport.scale : 1
  // The visible viewport can be panned down while an input is focused. Its
  // bottom edge, not its height alone, defines where a fixed sheet can end.
  return Math.max(
    0,
    layoutViewportHeight - ((visualViewport.offsetTop ?? 0) + visualViewport.height * scale),
  )
}
