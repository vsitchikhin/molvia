/**
 * The mark the script in `index.html` puts on the root when the browser is below the floor of the
 * build (MOL-231): it has drawn its line in place of the app by then, before any module ran.
 */
export const OUTDATED_MARK = 'data-outdated'

/**
 * Whether this browser is below the floor: the app is not started and nothing is reported — a
 * failure there is the browser's, not a defect the owner can fix. Read from the mark, never probed
 * again here: the script is the one place the markers live.
 */
export function belowFloor(): boolean {
  return document.documentElement.hasAttribute(OUTDATED_MARK)
}
