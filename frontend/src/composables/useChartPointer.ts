import type { Ref } from 'vue'

/** How far a finger goes before it has said which way — sideways chooses, down scrolls. */
const INTENT_PX = 8

/**
 * How high on the area the pointer is, in pixels from its top, and the area's size: a chart whose marks differ
 * by height too — two exchanges of one day on the line of the rate (MOL-161, adversarial Б) — tells
 * them apart by it. `y` is null where the area has no height to measure by.
 */
export interface ChartPoint {
  readonly y: number | null
  readonly width: number
  readonly height: number
  /**
   * One deliberate choice — a finger lifted where it touched, a mouse pressed — never a step of a
   * drag: a chart that turns a second tap into the next of marks drawn one over another (MOL-161,
   * adversarial И) must not turn them over while the finger slides.
   */
  readonly tap: boolean
}

export interface ChartPointer {
  readonly down: (event: PointerEvent) => void
  readonly move: (event: PointerEvent) => void
  readonly up: (event: PointerEvent) => void
  readonly cancel: () => void
}

/**
 * A choice made on a chart by the whole area (MOL-74, handoff 03): `pick` turns where the pointer is
 * into an index. A mouse or a pen chooses on press and while pressed. **A finger chooses on lifting,
 * or once it goes sideways** (review of PR #77): chosen on touching, the first move of every scroll
 * that started on a chart changed the reading under the thumb. A scroll takes the finger — the
 * browser cancels the pointer for `touch-action: pan-y` — and nothing is chosen.
 */
export function useChartPointer(
  area: Ref<HTMLElement | null>,
  pick: (fraction: number, point: ChartPoint) => void,
): ChartPointer {
  let touch: { x: number; y: number; sideways: boolean } | null = null

  function at(event: PointerEvent, tap: boolean): void {
    const box = area.value?.getBoundingClientRect()
    if (!box || box.width <= 0) return
    const x = event.clientX - box.left
    const height = box.height > 0 ? box.height : 0
    pick(Math.min(1, Math.max(0, x / box.width)), {
      y: height > 0 ? event.clientY - box.top : null,
      width: box.width,
      height,
      tap,
    })
  }

  return {
    down(event) {
      if (event.pointerType === 'touch')
        touch = { x: event.clientX, y: event.clientY, sideways: false }
      else at(event, true)
    },
    move(event) {
      if (event.pointerType !== 'touch') {
        // A mouse passing over chooses nothing; a pressed button does.
        if (event.buttons !== 0) at(event, false)
        return
      }
      if (!touch) return
      const dx = Math.abs(event.clientX - touch.x)
      const dy = Math.abs(event.clientY - touch.y)
      if (!touch.sideways && dx > INTENT_PX && dx > dy) touch.sideways = true
      if (touch.sideways) at(event, false)
    },
    up(event) {
      if (event.pointerType === 'touch' && touch) at(event, !touch.sideways)
      touch = null
    },
    cancel() {
      touch = null
    },
  }
}
