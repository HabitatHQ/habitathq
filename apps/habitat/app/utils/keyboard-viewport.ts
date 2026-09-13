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
  visualViewport: Pick<VisualViewport, 'height' | 'scale'>,
): number {
  const scale = visualViewport.scale > 0 ? visualViewport.scale : 1
  return Math.max(0, layoutViewportHeight - visualViewport.height * scale)
}
