<template>
  <dialog
    ref="dialog"
    class="sheet"
    :class="{ over: back, dragging }"
    :style="{ '--sheet-footer-height': `${String(footerHeight)}px` }"
    :aria-labelledby="titleId"
    @cancel.prevent="close()"
    @close="closedNatively"
    @click.capture="holdWhileRising"
    @click="closeOnScrim"
  >
    <div class="panel" :class="{ footed: $slots.footer }">
      <header class="head" :class="{ over: back }">
        <AppButton v-if="back" variant="icon" :label="t('nav.back_label')" @click="close()">
          <IconBack />
        </AppButton>
        <div class="heading">
          <h2 :id="titleId" class="title"><slot name="title" /></h2>
          <p v-if="$slots.meta" class="meta"><slot name="meta" /></p>
        </div>
        <AppButton v-if="!back" variant="icon" :label="t('sheet.close')" @click="close()">
          <IconClose />
        </AppButton>
      </header>

      <slot />
    </div>

    <div v-if="$slots.footer" ref="footer" class="footer">
      <slot name="footer" />
    </div>

    <div class="region" role="status">
      <p v-for="announcement in announcements" :key="announcement.id">
        {{ announcement.text }}
      </p>
    </div>
  </dialog>
</template>

<script lang="ts">
import { defineComponent, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconBack from '~icons/mdi/chevron-left'
import IconClose from '~icons/mdi/close'
import AppButton from '@/components/AppButton.vue'
import { provideSheetAnnouncer } from '@/composables/useAnnouncer'
import { useHeight } from '@/composables/useCollapsed'
import { useKeyboardInset } from '@/composables/useKeyboardInset'
import { useSheetDrag } from '@/composables/useSheetDrag'
import { closeStateStrip } from '@/composables/useStateStrip'
import { pageAnchor, sheetOpener, useSheetHistory } from '@/composables/useSheetHistory'

/** A double tap lands within this — a platform convention, not a design token. */
export const DOUBLE_TAP = 300

/**
 * The sheet of 0.1: it rises from the bottom over the screen, which stays visible behind the
 * scrim. A native modal `<dialog>` — the focus trap, the inert page, the backdrop and Esc come
 * from the platform, and focus goes back to whatever opened it when it closes.
 *
 * Six ways to close it, one way it closes. The ×, a tap on the scrim, a pull down (`useSheetDrag`,
 * MOL-80), Esc, Android's «back» (which Chrome delivers to a modal dialog as `cancel`) and the
 * browser's «back» or the iOS edge swipe (a pop) — the first five step back off the sheet's entry
 * in the history, and the pop that follows is what closes it (`useSheetHistory`). A screen that
 * must close the sheet and itself at once — «Add to trip» over the search — calls `close(2)`.
 *
 * No grab handle on top, though the sheet can be pulled down: the owner's decision (MOL-80, В-5).
 *
 * The page under an open sheet does not scroll (main.scss). The sheet is the one place where a
 * container scrolls rather than the page: a panel over the screen has no window of its own.
 *
 * Its footer — the main action — is pinned to its bottom edge, and the content scrolls under it
 * (MOL-182, Ф-17): under fifteen chips «Сохранить» had gone below the edge. Sticky in the sheet's
 * own scroll, not a middle of its own between the header and the footer: the pull down, the lift
 * over the keys and `reveal` all go by the dialog's scroll, and stay as they were. What the sheet
 * brings into sight stops at the footer's top (`--sheet-footer-height` as its `scroll-padding`).
 */
export default defineComponent({
  name: 'BottomSheet',
  components: { AppButton, IconBack, IconClose },
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
    /**
     * A sheet over another sheet (MOL-123, owner's decision В-4): «‹» on the left takes this one
     * away and nothing else, and there is no × — under a picker lies a spending with its amount
     * typed, and a × that closed the stack threw it away at the till. One scrim: the sheet under
     * it already dims the screen.
     */
    back: { type: Boolean, default: false },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup(props, { emit, expose }) {
    const { t } = useI18n()
    // An error in the sheet keeps its buttons here: the strip under it is the screen's.
    closeStateStrip()
    const dialog = ref<HTMLDialogElement | null>(null)
    const footer = ref<HTMLElement | null>(null)
    const footerHeight = useHeight(footer)
    const titleId = useId()

    // Whether the sheet is open as far as the screen is concerned. Not `dialog.open`: the browser
    // may close the dialog on its own (a second Esc), and the sheet is still to be put away —
    // its entry taken, the screen told — exactly once.
    const shown = ref(false)
    // While the sheet is up, words are said in its own region: the app's is outside the modal
    // dialog, inert, and nothing in it is read (MOL-181, feedback С-10).
    const announcements = provideSheetAnnouncer(shown)
    // A step back is on its way and the pop has not come yet.
    let closing = false
    // The screen asked for the sheet again while it was closing — «save and next». Honoured once
    // the pop lands, instead of lost to it (adversarial Б-6).
    let reopen = false
    // A tap on the scrim counts only if it began there, and no tap counts until the sheet is up.
    let downOnScrim = false
    let settledAt = 0
    // When the finger of the last touch on the sheet came down — its click carries the moment it
    // lifted (MOL-69, adversarial А1). Kept for every click of that touch — a label and the radio
    // it clicks for it — until the next touch, a touch the platform took back, or the next showing
    // (adversarial Б1, review Р-3).
    let touchedAt: number | null = null
    // Which showing the sheet is on: the rise of one that was closed must not settle the next.
    let showing = 0
    // Which slide down the sheet is on: one cut short by the sheet opened again must not close it.
    let leaving = 0

    // Up, as a tap is (MOL-69): a finger that came down while it rose is the opener's second tap.
    const drag = useSheetDrag(dialog, shown, {
      canStart: (event) => shown.value && !closing && event.timeStamp >= settledAt,
      close: () => {
        close()
      },
    })

    const history = useSheetHistory(() => {
      if (!shown.value) return
      shown.value = false
      closing = false
      const again = reopen
      reopen = false
      // Before the slide down: it starts from where a pull left the sheet.
      drag.reset()
      if (dialog.value?.open) leave(dialog.value)
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

    // The dialog is closed at once — the page, the focus and every reader of `dialog[open]` have it
    // shut, as ever — and `data-leaving` keeps it drawn while it slides down, taken off at the end.
    // Left to the stylesheet, a closed dialog is held in the top layer by a transition of
    // `overlay`: Safari has not got it, and there the × and the scrim made the sheet vanish on the
    // spot — only the pull down, which slides it itself, went down (hotfix-bottom-menu). Played
    // open instead, the sheet was still `[open]` for the length of the slide, and «Закончить» did
    // not go up to «Покупки»: a sheet was up.
    function leave(element: HTMLDialogElement): void {
      const current = ++leaving
      element.dataset.leaving = ''
      element.close()
      // Read now, so the slide starts this frame and is there to be waited for.
      getComputedStyle(element).getPropertyValue('transform')
      const sliding = element
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
      if (sliding.length === 0) {
        delete element.dataset.leaving
        return
      }
      void Promise.allSettled(sliding.map((animation) => animation.finished)).then(() => {
        if (current === leaving) delete element.dataset.leaving
      })
    }

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
      const from = sheetOpener()
      drag.reset()
      // Opened again while the last showing still slid down («save and next»): the slide stops
      // where it is and the sheet comes back up from there.
      leaving += 1
      delete element.dataset.leaving
      shown.value = true
      element.showModal()
      settle(element)
      history.lay(anchor, from)
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
      touchedAt = null
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

    // A touch the platform took back — a scroll, a long press — makes no click.
    function takenBack(): void {
      touchedAt = null
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
    // from the keyboard has no finger (`detail` 0): it is judged by its own time and leaves the
    // touch alone — spending it let the finger still resting be judged by its lift (Б1).
    function holdWhileRising(event: MouseEvent): void {
      const finger = event.detail > 0 ? touchedAt : null
      if ((finger ?? event.timeStamp) >= settledAt) return
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

    // A footer grown over the field being typed in — an error, «Вернуть» — is the sheet's edge
    // moving up, and the field is brought back into sight above it.
    useKeyboardInset(dialog, shown, footerHeight)

    // Heard on the document, not on the dialog (MOL-80). iOS hands a touch to the page only where
    // a listener of touches or of the pointer stands, and on the dialog that is the panel's box:
    // the scrim lies outside it, its `pointerdown` never came, and on an iPhone a tap on the scrim
    // did nothing at all — measured on the owner's phone, and invisible to Chromium and to
    // Playwright's WebKit, which have no such layer. A tap on the scrim still lands on the dialog
    // itself, so what counts as the scrim is unchanged.
    function listen(on: boolean): void {
      const options = { capture: true, passive: true }
      if (on) {
        document.addEventListener('pointerdown', pressed, options)
        document.addEventListener('pointercancel', takenBack, options)
      } else {
        document.removeEventListener('pointerdown', pressed, options)
        document.removeEventListener('pointercancel', takenBack, options)
      }
    }
    watch(shown, listen)
    onBeforeUnmount(() => {
      listen(false)
    })

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
    return {
      t,
      announcements,
      dialog,
      footer,
      footerHeight,
      titleId,
      dragging: drag.dragging,
      close,
      holdWhileRising,
      closeOnScrim,
      closedNatively,
    }
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
     that were there to use (review Р-2). What is visible is the visual viewport's height, set by
     `useKeyboardInset` while the sheet is open: Safari shrinks the window under the keyboard and
     not `dvh`, and a share of `dvh` put the sheet's top — and the sum being typed — off the screen
     (MOL-135). `dvh`, not `vh`, where nothing is set: with the address bar showing, `vh` is taller
     than the screen and the header would sit under the top edge. */
  max-height: calc(var(--viewport-height) * var(--sheet-height-share));

  /* Lifted over the on-screen keyboard where the browser leaves it covering the page (iOS). */
  margin: auto 0 var(--keyboard-inset);
  padding: 0;
  overflow: auto;
  overscroll-behavior: contain;

  /* What the browser and `reveal` bring into sight stops at the pinned footer's top, not under it. */
  scroll-padding-bottom: var(--sheet-footer-height);
  border: none;
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  background: var(--surface);

  /* The sheet goes on below its bottom edge, in its own colour: under it lies the keyboard, and on
     iOS 26 and later the keys and the bar of «∧ ∨ ✓» over them are glass, with clear room between
     them — the page under the sheet showed through there, the spendings of the month in a band
     between the sheet and the keys (the owner's screenshot, the installed app). A shadow, not a
     taller box: the box is what the lift, the height and the field kept in sight are measured by
     (MOL-135). Spread and offset alike, so it starts under the rounded corners, never beside them;
     first, so the sheet's own shadow does not darken it. */
  box-shadow:
    0 calc(50dvh + var(--radius-sheet)) 0 50dvh var(--surface),
    var(--shadow-lg);
  color: var(--text);

  /* Out from under the bottom edge and back. The way down is `data-leaving` (see `leave`); these
     discrete transitions only cover a close the browser makes itself, a second Esc, where the
     browser can animate `display` and the top layer. */
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
    /* Fades as the sheet is pulled down (`useSheetDrag`); the backdrop inherits from the dialog. */
    opacity: calc(1 - var(--sheet-drag, 0));

    @starting-style {
      opacity: 0;
    }
  }

  &.over::backdrop {
    background: transparent;
  }

  /* Sliding down, closed: out of the top layer, so drawn by hand where the modal sheet stood, over
     the tab bar, taking no tap. No discrete transition is left to hold it there. */
  &[data-leaving] {
    position: fixed;
    inset: auto 0 0;
    z-index: 2;
    display: block;
    margin: 0;
    transform: translateY(100%);
    pointer-events: none;
    transition-property: transform;
  }

  /* Under the finger: no transition, or the sheet would trail behind it. */
  &.dragging,
  &.dragging::backdrop {
    transition: none;
  }
}

.panel {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-8) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}

.panel.footed {
  padding-bottom: var(--space-6);
}

/* Pinned to the sheet's bottom edge, as wide as the sheet, the content scrolling under it (Ф-17); the
   margins of the screen's docked strip (К-9). Over the keys the home indicator is under them, and the
   footer stands 12 over the keys (147). */
.footer {
  position: sticky;
  bottom: 0;
  z-index: 1;
  border-top: var(--hairline) solid var(--border);
  padding: var(--space-3) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-3) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
  background: var(--surface);
  box-shadow: var(--shadow-lg);

  html[data-under-keys] & {
    padding-bottom: var(--space-3);
  }
}

.region {
  @include visually-hidden;

  /* At the top, not where it stands after the footer: a pixel of it below the footer was a pixel
     more to scroll, and at the end the pinned footer stopped a pixel over the edge. */
  top: 0;
}

.head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);

  > :last-child {
    flex: none;
    margin-left: auto;
  }

  &.over > :first-child {
    flex: none;
  }

  &.over > :last-child {
    flex: 1;
    margin-left: 0;
  }
}

.heading {
  min-width: 0;
}

.title {
  @include display-type;

  margin: 0;
  font-size: var(--text-title);
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
