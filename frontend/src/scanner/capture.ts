import { cropOf } from './frames'

export interface FrameSource {
  /** Resolves when the video has a new frame to read. */
  next: () => Promise<void>
  /** The pixels under the frame drawn on the screen, or null while there are none. */
  grab: () => ImageData | null
}

/**
 * Frames of the viewfinder's video, cut to what lies under the frame on the screen (MOL-98, Р-5):
 * fewer pixels read faster, and the neighbour on the shelf is left out. One canvas for all of
 * them, read back often — which is what `willReadFrequently` tells the browser.
 */
export function videoFrames(video: HTMLVideoElement, frame: HTMLElement): FrameSource {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })

  return {
    next: () =>
      new Promise((resolve) => {
        // A new video frame where the browser can tell; a painted one where it cannot.
        if ('requestVideoFrameCallback' in video)
          video.requestVideoFrameCallback(() => {
            resolve()
          })
        else
          requestAnimationFrame(() => {
            resolve()
          })
      }),
    grab: () => {
      if (!context || video.videoWidth === 0 || video.videoHeight === 0) return null
      const box = video.getBoundingClientRect()
      const drawn = frame.getBoundingClientRect()
      const crop = cropOf(
        { width: video.videoWidth, height: video.videoHeight },
        { x: 0, y: 0, width: box.width, height: box.height },
        { x: drawn.x - box.x, y: drawn.y - box.y, width: drawn.width, height: drawn.height },
      )
      if (crop.width === 0 || crop.height === 0) return null
      if (canvas.width !== crop.width) canvas.width = crop.width
      if (canvas.height !== crop.height) canvas.height = crop.height
      context.drawImage(
        video,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      )
      return context.getImageData(0, 0, crop.width, crop.height)
    },
  }
}
