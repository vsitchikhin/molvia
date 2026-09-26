<template>
  <dialog
    ref="dialog"
    class="sheet"
    :aria-labelledby="titleId"
    @cancel.prevent="close()"
    @close="closedNatively"
    @pointerdown="pressed"
    @click.capture="holdWhileRising"
    @click="closeOnScrim"
  >
    <div class="panel">
      <header class="head">
        <div class="heading">
          <h2 :id="titleId" class="title"><slot name="title" /></h2>
          <p v-if="$slots.meta" class="meta"><slot name="meta" /></p>
        </div>
        <AppButton variant="icon" :label="t('sheet.close')" @click="close()">
          <IconClose />
        </AppButton>
      </header>

      <slot />

      <div v-if="$slots.footer" class="footer">
        <slot name="footer" />
      </div>
    </div>
  </dialog>
</template>

<script lang="ts">
import { defineComponent, nextTick, onMounted, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/mdi/close'
import AppButton from '@/components/AppButton.vue'
import { useKeyboardInset } from '@/composables/useKeyboardInset'
import { pageAnchor, useSheetHistory } from '@/composables/useSheetHistory'

/** A double tap lands within this — a platform convention, not a design token. */
const DOUBLE_TAP = 300

/**
 * The sheet of 0.1: it rises from the bottom over the screen, which stays visible behind the
 * scrim. A native modal `<dialog>` — the focus trap, the inert page, the backdrop and Esc come
 * from the platform, and focus goes back to whatever opened it when it closes.
 *
 * No grab handle on top: there is no drag gesture, and an element must not promise one.
 *
 * Five ways to close it, one way it closes. The ×, a tap on the scrim, Esc, Android's «back»
 * (which Chrome delivers to a modal dialog as `cancel`) and the browser's «back» or the iOS edge
 * swipe (a pop) — the first four step back off the sheet's entry in the history, and the pop that
 * follows is what closes it (`useSheetHistory`). A screen that must close the sheet and itself
 * at once — «Add to trip» over the search — calls `close(2)`.
 *
 * The page under an open sheet does not scroll (main.scss). The sheet is the one place where a
 * container scrolls rather than the page: a panel over the screen has no window of its own.
 */
export default defineComponent({
  name: 'BottomSheet',
  components: { AppButton, IconClose },
  props: {
    open: { type: Boolean, required: true },
    /**
     * `@closed`: the sheet is put away. A prop, not an event, and that is the point. It is called
     * a tick after `update:open(false)`, once the prop has gone false, so a screen that opens the
     * next sheet from it changes the prop false → true and the watcher hears it (adversarial
     * А-6). By then the sheet may be gone — under `v-if="open"`, or with a screen a push took
     * away — and Vue drops what an unmounted component emits; a handler held as a prop is still
     * called (adversarial Б-7, В-2, Д-1). Called now, the event broke А-6; deferred, it broke
     * Д-1 — each fix undid the other until the delivery stopped depending on the component.
     */
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup(props, { emit, expose }) {
    const { t } = useI18n()
    const dialog = ref<HTMLDialogElement | null>(null)
    const titleId = useId()

    // Whether the sheet is open as far as the screen is concerned. Not `dialog.open`: the browser
    // may close the dialog on its own (a second Esc), and the sheet is still to be put away —
    // its entry taken, the screen told — exactly once.
    const shown = ref(false)
    // A step back is on its way and the pop has not come yet.
    let closing = false
    // The screen asked for the sheet again while it was closing — «save and next». Honoured once
    // the pop lands, instead of lost to it (adversarial Б-6).
    let reopen = false
    // A tap on the scrim counts only if it began there, and no tap counts until the sheet is up.
    let downOnScrim = false
    let settledAt = 0
    // When the finger of the tap now under way touched the glass — its click carries the moment
    // it lifted (MOL-69, adversarial А1).
    let touchedAt: number | null = null
    // Which showing the sheet is on: the rise of one that was closed must not settle the next.
    let showing = 0

    const history = useSheetHistory(() => {
      if (!shown.value) return
      shown.value = false
      closing = false
      const again = reopen
      reopen = false
      if (dialog.value?.open) dialog.value.close()
      if (!again && props.open) emit('update:open', false)
      // Read now: the props of a sheet gone by the next tick are still there, but read once.
      const closed = props.onClosed
      void nextTick(() => {
        closed?.()
      })
      // Asked for again while it was closing — «save and next» before the pop landed (Б-6). Not
      // guessed from the prop still being true a tick later: that reopened the sheet under a screen
      // that only wrote its false late, after an `await` (adversarial Г-1).
      if (again) void nextTick(show)
    })

    function show(): void {
      const element = dialog.value
      if (!element || shown.value) return
      // Chrome skips on «back» an entry laid without a gesture, and «back» would then leave the
      // screen along with the sheet (adversarial П-6). A sheet opens from a tap.
      // Not every browser has it (Safari before 16.4), whatever the DOM types say.
      const activation = (navigator as { userActivation?: UserActivation }).userActivation
      if (import.meta.env.DEV && activation && !activation.isActive) {
        console.warn('[BottomSheet] opened without a tap: «back» may skip its entry')
      }
      // Measured before the sheet is up, with the page as the person left it.
      const anchor = pageAnchor()
      shown.value = true
      element.showModal()
      settle(element)
      history.lay(anchor)
    }

    // «Up» is the end of the sheet's own rise, not a clock started at `showModal`: a rise starts
    // with the first frame that draws it, and on a busy phone that frame comes late — the clock
    // ran out while the sheet was still sliding, and the second tap of a double tap closed it
    // (MOL-69). Never sooner than a double tap, for a sheet with no rise (reduced motion). No
    // ceiling: a transition either finishes or is cancelled, and both settle it — an endless
    // animation never would, so one is not waited for, or the sheet would take no tap for good.
    function settle(element: HTMLDialogElement): void {
      const current = ++showing
      const floor = performance.now() + DOUBLE_TAP
      settledAt = Number.POSITIVE_INFINITY
      const rising = element
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
      void Promise.allSettled(rising.map((animation) => animation.finished)).then(() => {
        if (current === showing) settledAt = Math.max(performance.now(), floor)
      })
    }

    /** Closes the sheet — and `steps - 1` screens under it — by stepping back through history. */
    function close(steps = 1): void {
      closing = history.laid()
      history.leave(steps)
    }

    function pressed(event: PointerEvent): void {
      downOnScrim = event.target === dialog.value
      touchedAt = event.timeStamp
    }

    // The second tap of a double tap on the opener lands wherever the sheet is while it rises —
    // the scrim, the ×, the main action sliding under the finger — and closed the sheet before it
    // was seen, or added an empty item to the trip (adversarial Б-5). Until the sheet is up it
    // takes no click at all: stopped here, on the way down, before any button hears it.
    //
    // Judged by when the finger touched, not by when a busy main thread got round to the tap
    // (MOL-69) — and not by the click's own time either: a click is born when the finger lifts,
    // so one put down on the scrim while the sheet rose and lifted once it was up closed the
    // sheet, or pressed the main action that had slid under it (adversarial А1, А2). A click
    // from the keyboard has no finger (`detail` 0) and is judged by its own time.
    function holdWhileRising(event: MouseEvent): void {
      const touched = event.detail > 0 && touchedAt !== null ? touchedAt : event.timeStamp
      touchedAt = null
      if (touched >= settledAt) return
      event.stopPropagation()
      event.preventDefault()
    }

    // A tap on the scrim lands on the dialog itself: the panel fills the dialog's box, so any
    // tap inside the sheet lands on the panel or something in it. A press that began in a field
    // and was let go over the scrim — a text selection that overshot — is clicked on the dialog
    // too, their common ancestor, and threw away what was typed (adversarial Б-4).
    function closeOnScrim(event: MouseEvent): void {
      const fromScrim = downOnScrim
      downOnScrim = false
      if (event.target === dialog.value && fromScrim) close()
    }

    // Chrome lets a page refuse Esc only once per user activation; a second Esc closes the dialog
    // regardless. The entry must still go, or «back» would land on a sheet that is gone.
    //
    // Not when it is open again: the `close` event of the last sheet arrives a task later, and a
    // sheet reopened in between would be taken for the one the browser shut (adversarial А-5).
    function closedNatively(): void {
      if (dialog.value?.open) return
      if (history.laid()) close()
    }

    useKeyboardInset(dialog, shown)

    watch(
      () => props.open,
      (open) => {
        if (!open) {
          reopen = false
          if (shown.value && !closing) close()
        } else if (shown.value && closing) {
          reopen = true
        } else {
          show()
        }
      },
    )
    onMounted(() => {
      if (props.open) show()
    })

    expose({ close })
    return { t, dialog, titleId, close, pressed, holdWhileRising, closeOnScrim, closedNatively }
  },
})
</script>

<style scoped lang="scss">
.sheet {
  /* The dialog is the sheet's box and nothing else, pinned to the bottom edge. */
  width: 100%;
  max-width: 100%;

  /* A share of what is visible above the keyboard, not of the window less the keyboard: on iOS
     `dvh` ignores the keyboard, and 82% of the window minus it left the sheet 208px of the 328
     that were there to use (review Р-2). `dvh`, not `vh`: with the address bar showing, `vh` is
     taller than the screen and the header would sit under the top edge. */
  max-height: calc((100dvh - var(--keyboard-inset)) * var(--sheet-height-share));

  /* Lifted over the on-screen keyboard where the browser leaves it covering the page (iOS). */
  margin: auto 0 var(--keyboard-inset);
  padding: 0;
  overflow: auto;
  overscroll-behavior: contain;
  border: none;
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  color: var(--text);

  /* Out from under the bottom edge and back — the exit too, where the browser can animate
     `display` and the top layer. Where it cannot, the sheet just disappears. */
  transform: translateY(100%);
  transition:
    transform var(--dur) var(--ease),
    overlay var(--dur) allow-discrete,
    display var(--dur) allow-discrete;

  &[open] {
    transform: none;

    @starting-style {
      transform: translateY(100%);
    }
  }

  &::backdrop {
    background: var(--scrim);
    opacity: 0;
    transition:
      opacity var(--dur) var(--ease),
      overlay var(--dur) allow-discrete,
      display var(--dur) allow-discrete;
  }

  &[open]::backdrop {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }
}

.panel {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-8) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}

.head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);

  > :last-child {
    flex: none;
    margin-left: auto;
  }
}

.heading {
  min-width: 0;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: var(--weight-bold);
  line-height: var(--leading-snug);
}

.meta {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

@media (prefers-reduced-motion: reduce) {
  .sheet,
  .sheet::backdrop {
    transition: none;
  }
}
</style>
