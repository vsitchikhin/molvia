<template>
  <span v-if="kind === 'caption'" class="skeleton-caption">
    <span class="bar" :style="{ width: `${width}%` }"></span>
  </span>

  <span v-else-if="kind === 'field'" class="skeleton-field"></span>

  <AppCard
    v-else-if="kind === 'rows'"
    as="ul"
    list
    class="skeleton-rows"
    :class="{ 'skeleton-narrow': narrow }"
  >
    <li v-for="n in count" :key="n" class="item">
      <span class="row">
        <span v-if="lead === 'circle'" class="circle"></span>
        <span v-else-if="lead === 'icon'" class="mark"></span>
        <span class="words">
          <span class="line"><span class="bar title"></span></span>
          <span v-if="meta" class="line small"><span class="bar meta"></span></span>
        </span>
        <span v-if="tail || under" class="tail">
          <span class="line"><span class="bar amount"></span></span>
          <span v-if="under" class="line small"><span class="bar under"></span></span>
        </span>
        <span v-if="next" class="chevron"></span>
      </span>
    </li>
  </AppCard>

  <AppCard v-else-if="kind === 'figure'" class="skeleton-figure">
    <span class="line caption-line"><span class="bar label"></span></span>
    <span class="line figure-line"><span class="bar sum"></span></span>
    <span class="line small"><span class="bar note"></span></span>
    <span v-if="plate" class="plate"></span>
  </AppCard>

  <AppCard v-else-if="card" class="skeleton-lines">
    <span v-for="(share, index) in widths" :key="index" class="group">
      <span class="bar text" :style="{ width: `${share}%` }"></span>
      <span class="bar sub"></span>
    </span>
  </AppCard>
  <span v-else class="skeleton-lines">
    <span v-for="(share, index) in widths" :key="index" class="group">
      <span class="bar text" :style="{ width: `${share}%` }"></span>
      <span class="bar sub"></span>
    </span>
  </span>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import AppCard from '@/components/AppCard.vue'

const KINDS = ['caption', 'field', 'rows', 'figure', 'lines'] as const
export type SkeletonKind = (typeof KINDS)[number]

const LEADS = ['none', 'icon', 'circle'] as const
export type SkeletonLead = (typeof LEADS)[number]

function isShare(value: unknown): boolean {
  return typeof value === 'number' && value > 0 && value <= 100
}

export function isWidths(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(isShare)
}

/**
 * A part of the answer that is coming, drawn in bars inside `ScreenSkeleton` (Ф-13, MOL-178): the
 * screen puts its parts in the frame's slot in the order its answer will stand, and what is its own —
 * the ring of «Графики», the scale of «Оценки» — between them, in bars of `skeleton-bar`.
 *
 *   caption — the bar of a `SectionCaption`, on the ground: `width` in percent;
 *   field   — the empty pill of a `SearchField`;
 *   rows    — a list card of `count` rows of 64, the geometry of `ListRow` and `OperationRow`: `lead`
 *             an icon of 24, a circle of 40 or nothing; `meta`, a line under the title; `tail`, an
 *             amount; `under`, a line under the amount, which brings the amount with it; `next`, the
 *             place of the chevron. Each bar in a line of the size and leading of the words it stands
 *             for, so a row is as tall as the answer's. `narrow` is the answer's own: below
 *             `$row-narrow` the tail goes under the words, as in a row of `OperationRow`, whose `li` is
 *             the container `row` — a `ListRow` in a plain `li` stays wide at any width, and bars that
 *             went narrow under it stood 9 px taller at 320 (adversarial А1). The typical row is the
 *             short one (owner's В-3 «б»): a title and a meta of a line each; the line under the amount
 *             is the screen's to ask for, where it is the rule — an account in another currency;
 *   figure  — the card of a sum (handoff 77 v2 2a): a caption, the figure, a line, and a `plate`;
 *   lines   — pairs of bars by `widths`, the line and the shorter one under it: what `groups` drew
 *             before there were parts — in a card, or bare (`card: false`) where a card is not the
 *             answer's shape, over the camera.
 *
 * The widths of the rows' bars are the part's, not the screen's: deliberately uneven, by the handoff's
 * cycle, since an even skeleton reads as a broken layout. The bars breathe by their colour
 * (`skeleton-bar`).
 *
 * The roots are named `skeleton-*`, never `caption`, `field` or `figure`: the part is rendered by the
 * screen that puts it in the frame's slot, so its root carries the screen's scope too, and a scoped
 * `.caption` of «Бюджет» set its size on the bar's line (adversarial А3, review № 1).
 */
export default defineComponent({
  name: 'SkeletonPart',
  components: { AppCard },
  props: {
    kind: {
      type: String as PropType<SkeletonKind>,
      required: true,
      validator: (kind: string) => (KINDS as readonly string[]).includes(kind),
    },
    width: { type: Number, default: 30, validator: isShare },
    count: {
      type: Number,
      default: 3,
      validator: (count: number) => Number.isInteger(count) && count > 0,
    },
    lead: {
      type: String as PropType<SkeletonLead>,
      default: 'none',
      validator: (lead: string) => (LEADS as readonly string[]).includes(lead),
    },
    meta: { type: Boolean, default: true },
    tail: { type: Boolean, default: false },
    under: { type: Boolean, default: false },
    next: { type: Boolean, default: false },
    narrow: { type: Boolean, default: false },
    plate: { type: Boolean, default: false },
    widths: {
      type: Array as PropType<number[]>,
      default: () => [62],
      validator: isWidths,
    },
    card: { type: Boolean, default: true },
  },
})
</script>

<style scoped lang="scss">
.bar,
.circle,
.mark {
  @include skeleton-bar;
}

/* A bar stands in the middle of a line of the words it stands for — the title's and the amount's 17,
   the meta's 13, a caption's 11, a figure's 28 — as tall as their leading makes it: where the text's
   own box is centred. */
.line {
  display: flex;
  align-items: center;
  height: calc(1em * var(--leading-snug));
  font-size: var(--text-body);
}

.small {
  font-size: var(--text-footnote);
}

/* A caption's place is the screen's (`SectionCaption`): 4 from the left, 8 to its card — the frame's
   gap — and 24 from what is above it, the frame's too. Its line is the caption's, 11 at the body's
   leading. */
.skeleton-caption {
  display: flex;
  align-items: center;
  height: calc(1em * var(--leading-body));
  margin: 0;
  padding: 0 var(--space-1);
  font-size: var(--text-caption);

  .bar {
    height: var(--skeleton-caption);
  }
}

/* The well of `SearchField`, empty: 44 inside its edge, 46 outside, as every field of the kit — the
   field's 44 is its input's, inside the edge. */
.skeleton-field {
  display: block;
  min-height: calc(var(--touch-target) + 2 * var(--hairline));
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

/* The geometry of `ListRow`: 64, 12 / 16, the gaps of 12 — and, `narrow`, its container `row`, which
   `OperationRow` sets on its `li`. */
.skeleton-narrow .item {
  container: row / inline-size;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  box-sizing: border-box;
  min-height: calc(var(--touch-target-lg) + var(--space-3));
  padding: var(--space-3) var(--space-4);
}

.circle {
  flex: none;
  width: var(--row-circle);
  height: var(--row-circle);
}

.mark {
  flex: none;
  width: var(--icon-md);
  height: var(--icon-md);
}

.words {
  flex: 1;
  min-width: 0;
}

.title {
  width: 52%;
  height: var(--skeleton-line);
}

.meta {
  width: 34%;
  height: var(--skeleton-sub);
}

/* The handoff's cycle (77 v2 2a): 52 / 38 / 60 for the title, 34 / 26 / 30 for the meta. */
.item:nth-child(3n + 2) {
  .title {
    width: 38%;
  }

  .meta {
    width: 26%;
  }

  .amount {
    width: 74%;
  }

  .under {
    width: 90%;
  }
}

.item:nth-child(3n) {
  .title {
    width: 60%;
  }

  .meta {
    width: 30%;
  }

  .amount {
    width: 86%;
  }

  .under {
    width: 60%;
  }
}

/* A block, so each of its lines takes its width and a bar of a share of it is seen: as a column
   aligned to the end, a line shrank to its content — nothing — and the bars with it. */
.tail {
  flex: none;
  width: 22%;

  .line {
    justify-content: flex-end;
  }
}

.amount {
  width: 100%;
  height: var(--skeleton-line);
}

/* Never the amount's own width: two equal bars one under the other read as one block (review № 4). */
.under {
  width: 70%;
  height: var(--skeleton-sub);
}

/* The chevron's place, empty: the amounts end where the rows' will. */
.chevron {
  flex: none;
  width: var(--icon);
}

/* Narrow, as `ListRow` in its container: the amount on a line of its own under the words, at the
   right. */
@container row (width < #{$row-narrow}) {
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0 var(--space-3);
  }

  .circle,
  .mark {
    grid-row: 1 / span 2;
  }

  .words {
    grid-column: 2;
    grid-row: 1;
  }

  .tail {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
    width: 40%;
    margin-top: var(--space-1);
  }

  .chevron {
    grid-column: 3;
    grid-row: 1 / span 2;
  }
}

.skeleton-figure {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.caption-line {
  height: calc(1em * var(--leading-body));
  font-size: var(--text-caption);
}

.figure-line {
  height: calc(1em * var(--leading-tight));
  font-size: var(--text-figure);
}

.label {
  width: 22%;
  height: var(--skeleton-caption);
}

.sum {
  width: 44%;
  height: var(--skeleton-figure);
}

.note {
  width: 62%;
  height: var(--skeleton-caption);
}

.plate {
  @include skeleton-bar;

  height: var(--touch-target);
  border-radius: var(--radius);
  margin-top: var(--space-3);
}

/* What `groups` drew: a line and the shorter one under it, 16 between the pairs. */
.skeleton-lines {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.text {
  height: var(--skeleton-line);
}

.sub {
  width: 38%;
  height: var(--skeleton-sub);
}
</style>
