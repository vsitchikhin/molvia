<template>
  <component
    :is="link ? 'a' : 'button'"
    class="nav-row"
    :class="{ 'nav-field': field, 'nav-invalid': invalid }"
    :type="link ? undefined : 'button'"
    :href="link?.href.value"
    :aria-haspopup="link ? undefined : 'dialog'"
    :aria-invalid="invalid ? 'true' : undefined"
    @click="click"
  >
    <component :is="icon" v-if="icon" class="icon" aria-hidden="true" />
    <span class="words">
      <span class="label">{{ label }}</span>
      <span v-if="value" class="value">{{ value }}</span>
    </span>
    <IconChevronRight class="chevron" aria-hidden="true" />
  </component>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { Component, PropType } from 'vue'
import { useLink } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import IconChevronRight from '~icons/mdi/chevron-right'

/**
 * The entry into something nested (Ф-12, MOL-175): «icon · label · value · ›», 52 high. With `to` it
 * is a link to a screen; without, a button that opens a sheet with fields — `aria-haspopup="dialog"`
 * says so before the press. The chevron is always there: an entry always goes on (В-14 «а»), and a
 * row that acts at once or asks to confirm is a `ListRow` with no chevron.
 *
 * `field` is the same entry standing in a form among its fields — «Сегодня · без заметки ›» under the
 * chips (MOL-199, Ф-3): the well of a field, as «Счёт ›» above it, not a row of a list card, which in a
 * form read as plain text. `invalid` marks a field behind it that holds an error. Their classes are the
 * kit's own words: a root carries the scope of the screen it stands in, and the spending sheet's own
 * `.field` — its column of a label and a field — stood the row in a column (adversarial А1 of MOL-199).
 *
 * Nothing of it is cut on a phone of 320 (MOL-304): the label takes up to two lines, then «…», and the value
 * stands beside it while both fit on one line, else on a line of its own under it, at the right.
 */
export default defineComponent({
  name: 'NavRow',
  components: { IconChevronRight },
  props: {
    to: { type: [String, Object] as PropType<RouteLocationRaw>, default: undefined },
    label: { type: String, required: true },
    value: { type: String, default: '' },
    icon: { type: [Object, Function] as PropType<Component>, default: undefined },
    field: { type: Boolean, default: false },
    invalid: { type: Boolean, default: false },
  },
  emits: { click: (event: MouseEvent) => event instanceof MouseEvent },
  setup(props, { emit }) {
    // A link or a button for the row's life, as the screen first gave it.
    const target = props.to
    const link = target === undefined ? null : useLink({ to: computed(() => props.to ?? target) })
    function click(event: MouseEvent): void {
      emit('click', event)
      if (link && !event.defaultPrevented) void link.navigate(event)
    }
    return { link, click }
  },
})
</script>

<style scoped lang="scss">
.nav-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  box-sizing: border-box;
  width: 100%;
  min-height: var(--touch-target-lg);
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  color: var(--text);
  font-family: var(--font);
  font-size: var(--text-body);
  line-height: var(--leading-snug);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out);
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

/* As ListRow: the button's look off below any class, so the list card's hairline stays. */
:where(.nav-row) {
  margin: 0;
  border: 0;
  background: none;
}

@media (hover: hover) {
  .nav-row:hover {
    background: var(--surface-2);
  }
}

/* A field's well, as `AccountRow`: under the pointer the tint, where muted text is under 4.5:1 (MOL-172). */
.nav-field {
  padding-inline: var(--space-3) var(--space-2);
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-2);

  @media (hover: hover) {
    &:hover {
      background: var(--accent-tint);

      .value {
        color: var(--text);
      }
    }
  }

  &:focus-visible {
    @include focus-ring(2px);
  }

  &.nav-invalid {
    border-color: var(--bad);
    box-shadow: inset 0 0 0 var(--hairline) var(--bad);
  }
}

.icon {
  @include icon;

  font-size: var(--icon-md);
  color: var(--text-muted);
}

/* The words have no width of their own (`width: 0` beside `flex: 1`), as `AccountRow`'s value: `min-width: 0`
   lets them shrink, but the label's whole line still counted in the sheet's least width, and a note of 32 letters made
   the spending sheet wider than the phone (adversarial А3 of MOL-199).

   The label and the value share its lines (MOL-304, owner's В-2 «а»): beside each other while both fit,
   else the value goes to a line of its own, at the right where the values end. Held on one line, on a
   phone of 320 «Перевод между счетами» was cut, and the value's half of the row cut «Бюджет» to «Бю…» and
   «сверх плана 1 250 300 ֏» with it. */
.words {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--space-3);
  width: 0;
  min-width: 0;
}

/* Two lines, then «…» (owner's В-1 «а»): the label is the one word of the entry, and two lines hold every
   one of the app at 320; a note in the spending sheet's field may be long, and the sheet opens it whole. */
.label {
  display: -webkit-box;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-weight: var(--weight-medium);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* Never cut: on its own line it breaks between its words, never inside a figure, whose groups the
   formats keep together. */
.value {
  flex: 0 1 auto;
  min-width: 0;
  margin-inline-start: auto;
  color: var(--text-muted);
  font-size: var(--text-callout);
  font-variant-numeric: tabular-nums;
  text-align: end;
}

.chevron {
  @include icon;

  font-size: var(--icon);
  color: var(--text-muted);
}
</style>
