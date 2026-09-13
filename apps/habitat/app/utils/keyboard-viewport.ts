/**
 * Returns the part of the layout viewport covered by the virtual keyboard.
 *
 * On iOS, `window.innerHeight` continues to represent the layout viewport
 * while `visualViewport.height` shrinks when the keyboard opens.
 */
export function getKeyboardInset(
  layoutViewportHeight: number,
  visualViewport: Pick<VisualViewport, 'height' | 'offsetTop'>,
): number {
  return Math.max(0, layoutViewportHeight - visualViewport.height - visualViewport.offsetTop)
}
