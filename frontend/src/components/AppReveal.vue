<template>
  <TransitionGroup v-if="group" :css="false" @enter="grow" @leave="shrink">
    <slot />
  </TransitionGroup>
  <Transition v-else :css="false" @enter="grow" @leave="shrink">
    <slot />
  </Transition>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

/**
 * More rows than this coming or going at once are an answer read — a month, a page — not a row
 * added or removed: they are just there, and the old ones just gone.
 */
const BULK = 3

/**
 * What pushes its neighbours grows from nothing and shrinks back (MOL-151): a row of a list, an
 * error under a field, a notice over a list, a block of a sheet. Its height, its padding and its
 * margins go to zero and back with its opacity, so whatever stands under it slides instead of
 * jumping — in the flow, with no row taken out of it, which is why it is the height and not a
 * slide of the rest. `group` for the rows of a `v-for` (a `<TransitionGroup>` with no element of its
 * own), a single block otherwise.
 *
 * Still where nothing should move: under «reduce motion», while a screen moves (the view transition
 * brings the new screen in already), and for an answer read — more than `BULK` rows at once, the
 * first page of a list, a month read — which only appears. The first render is never played.
 */
export default defineComponent({
  name: 'AppReveal',
  props: {
    /** The rows of a `v-for`, each with its key, rather than one block. */
    group: { type: Boolean, default: false },
  },
  setup() {
    // What comes and goes in one render is decided together, once the render is over: Vue hands
    // the rows over one by one, and only the count tells a row added from an answer read.
    let pending: Move[] = []

    function settle(): void {
      const moves = pending
      pending = []
      const entering = moves.filter((move) => !move.leaving).length
      const bulk = still() || entering > BULK || moves.length - entering > BULK
      for (const move of moves) {
        if (bulk) move.done()
        else play(move.element, move.leaving, move.done)
      }
    }

    function hand(element: Element, leaving: boolean, done: () => void): void {
      if (!(element instanceof HTMLElement)) {
        done()
        return
      }
      if (pending.length === 0) queueMicrotask(settle)
      pending.push({ element, leaving, done })
    }

    return {
      grow: (element: Element, done: () => void) => {
        hand(element, false, done)
      },
      shrink: (element: Element, done: () => void) => {
        hand(element, true, done)
      },
    }
  },
})

interface Move {
  element: HTMLElement
  leaving: boolean
  done: () => void
}

function still(): boolean {
  return (
    typeof Element.prototype.animate !== 'function' ||
    document.documentElement.dataset.nav !== undefined ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function play(element: HTMLElement, leaving: boolean, done: () => void): void {
  const style = getComputedStyle(element)
  const whole = {
    height: `${String(element.getBoundingClientRect().height)}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
    opacity: '1',
  }
  const none = {
    height: '0px',
    paddingTop: '0px',
    paddingBottom: '0px',
    marginTop: '0px',
    marginBottom: '0px',
    opacity: '0',
  }
  const root = getComputedStyle(document.documentElement)
  const overflow = element.style.overflow
  element.style.overflow = 'hidden'
  const animation = element.animate(leaving ? [whole, none] : [none, whole], {
    duration: Number.parseFloat(root.getPropertyValue('--dur')) || 0,
    easing: root.getPropertyValue('--ease').trim() || 'ease',
    // Kept at the end until Vue takes the row away, or it shows whole for a frame first.
    fill: leaving ? 'forwards' : 'none',
  })
  const finish = (): void => {
    element.style.overflow = overflow
    done()
  }
  animation.finished.then(finish, finish)
}
</script>
