<template>
  <div class="strip" :class="kind" :role="role">
    <component :is="glyph" class="icon" aria-hidden="true" />
    <p class="words">{{ text }}</p>
    <div v-if="kind === 'unanswered' && $slots.action" class="action">
      <slot name="action" />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, onMounted, watch } from 'vue'
import type { PropType } from 'vue'
import IconUnanswered from '~icons/mdi/alert-circle-outline'
import IconOffline from '~icons/mdi/cloud-off-outline'
import { useAnnouncer } from '@/composables/useAnnouncer'

/** `offline` — no connection; `unanswered` — the server did not answer, and the last answer is shown. */
export type StripKind = 'offline' | 'unanswered'

/**
 * The connection in one line (MOL-181, Ф-14): what the screen shows while the server cannot give
 * it anything newer — once a screen, in that screen's words, under its header, under what chooses
 * the answer, or first in a sheet. When there is no answer at all, it is `ScreenState` instead.
 *
 * The words come whole from the screen, the time in them: where it stands in the sentence is the
 * screen's and the language's. Never red — what is on the screen is still worth reading.
 *
 * «Повторить» (`#action`) only for `unanswered` (К-5): without a connection there is nothing to
 * try, so an offline strip draws no slot whatever is given.
 *
 * The words go to the live region of the app or the sheet (К-14), never a `role` of its own: a
 * region born with its words is often not read.
 */
export default defineComponent({
  name: 'StatusStrip',
  props: {
    kind: { type: String as PropType<StripKind>, required: true },
    text: { type: String, required: true },
  },
  setup(props) {
    const announce = useAnnouncer()
    const glyph = computed(() => (props.kind === 'offline' ? IconOffline : IconUnanswered))

    // Outside the app — the kit's page, a component on its own — the strip speaks for itself.
    const role = computed(() => (announce ? undefined : 'status'))

    // The words are taken back when they change or the strip goes: the region must not keep saying
    // what is no longer on the screen. The same words again are not news.
    let withdraw: (() => void) | undefined
    function speak(): void {
      withdraw?.()
      withdraw = announce?.(props.text)
    }
    onMounted(speak)
    watch(() => props.text, speak)
    onBeforeUnmount(() => withdraw?.())

    return { glyph, role }
  },
})
</script>

<style scoped lang="scss">
.strip {
  @include appear;

  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 2.25rem; /* 36 */
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
  line-height: var(--leading-snug);
}

.icon {
  @include icon;

  font-size: var(--icon-sm);
}

.words {
  flex: 1;
  min-width: 0;
  margin: 0;
}

// The button is 44 and the strip around one line of words 36: it takes the strip's padding above
// and below, so the strip grows to 44 and not to 60 — and part of it on the right, where the
// ghost's own padding already stands its word off the edge (frame 6h).
.action {
  margin-block: calc(var(--space-2) * -1);
  margin-inline-end: calc(var(--space-2) * -1);
}
</style>
