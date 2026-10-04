<template>
  <section class="group" :class="GROUPS[level].tone">
    <SectionCaption class="caption">
      <!-- The circle repeats what the word beside it says: the caption hides it from a screen reader. -->
      <template v-if="level !== 'unrated'" #mark
        ><VerdictBadge :level="level" compact large
      /></template>
      {{ t(GROUPS[level].title) }}
    </SectionCaption>
    <slot />
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { VerdictLevel } from '@molvia/model'
import SectionCaption from '@/components/SectionCaption.vue'
import VerdictBadge from '@/components/VerdictBadge.vue'

/**
 * The word of each group and the class that tones it. Written out rather than assembled from
 * the level: a key built out of a string is invisible to the linter and to `vue-tsc` alike,
 * and a missing translation then shows on the screen instead of in the build (MOL-16, О-12).
 */
const GROUPS: Record<GroupLevel, { title: string; tone: string }> = {
  take: { title: 'advice.group_take', tone: 'take' },
  if_cheap: { title: 'advice.group_if_cheap', tone: 'if-cheap' },
  never: { title: 'advice.group_never', tone: 'never' },
  unrated: { title: 'advice.search.group_unrated', tone: 'unrated' },
}

/**
 * The three verdicts, and «Ещё не оценивали» — the search's alone (MOL-128): found in the
 * catalogue with no verdict in sight. No badge: there is no verdict to show one for.
 */
type GroupLevel = VerdictLevel | 'unrated'

/**
 * One of the three groups of «Что брать»: a circle with its icon, the word in caps, and
 * whatever rows the screen puts inside (MOL-32).
 *
 * The group draws no row itself, because the three groups do not draw the same thing: a card,
 * a row, a line of text. That difference is the product's rule — cheapness cannot pull a bad
 * item into a recommendation, because a bad item has nothing to be cheap with — and it is
 * carried by the shapes, not by a colour that a dim shop or a colour-blind eye would lose.
 *
 * «Не брать нигде» is cut off from what stands above it by a hairline: the group is not hidden
 * — sometimes what not to buy is exactly what one came to remember — but it is not in the
 * flow of the recommendations either.
 */
export default defineComponent({
  name: 'AdviceGroup',
  components: { SectionCaption, VerdictBadge },
  props: {
    level: { type: String as PropType<GroupLevel>, required: true },
  },
  setup() {
    return { t: useI18n().t, GROUPS }
  },
})
</script>

<style scoped lang="scss">
.group + .group {
  margin-top: var(--space-6);
}

.never,
.unrated {
  padding-top: var(--space-3);
  border-top: var(--hairline) solid var(--border);
}

/* The tone of the group's word is the screen's (124 v2): the kit's caption has none. */
.take .caption {
  color: var(--good-ink);
}

.if-cheap .caption {
  color: var(--warn-ink);
}

.never .caption {
  color: var(--bad-ink);
}

.unrated .caption {
  color: var(--text-muted);
}
</style>
