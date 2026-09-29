/** A rectangle in pixels. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

// Around the frame drawn on the screen, as a share of its size: a code held a little off the frame
// is still read, and a neighbour on the shelf is still left out (MOL-98, Р-5).
const MARGIN = 0.15

/**
 * Which pixels of the camera's picture lie under the frame drawn on the screen. The video fills
 * the viewfinder by `object-fit: cover`, so the picture is scaled until it covers the box and
 * centred, and what sticks out is cut; the frame is measured on the screen, relative to the
 * video element. Grown by a margin and kept inside the picture.
 */
export function cropOf(picture: { width: number; height: number }, element: Box, frame: Box): Box {
  const scale = Math.max(element.width / picture.width, element.height / picture.height)
  const offsetX = (element.width - picture.width * scale) / 2
  const offsetY = (element.height - picture.height * scale) / 2
  const marginX = frame.width * MARGIN
  const marginY = frame.height * MARGIN
  const left = Math.max(0, (frame.x - marginX - offsetX) / scale)
  const top = Math.max(0, (frame.y - marginY - offsetY) / scale)
  const right = Math.min(picture.width, (frame.x + frame.width + marginX - offsetX) / scale)
  const bottom = Math.min(picture.height, (frame.y + frame.height + marginY - offsetY) / scale)
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(0, Math.round(right - left)),
    height: Math.max(0, Math.round(bottom - top)),
  }
}

/**
 * Two frames in a row must read the same code before it is taken (MOL-98, Р-1). zxing checks the
 * digit and wants two scan lines of a frame to agree, and still a partial read with a check digit
 * that holds happens; taken, it would bind a stranger's code to an item for good (MOL-100). A frame
 * that reads nothing or something else starts the count over.
 */
export function createReadStreak(): (code: string | null) => string | null {
  let previous: string | null = null
  return (code) => {
    const agreed = code !== null && code === previous
    previous = agreed ? null : code
    return agreed ? code : null
  }
}
