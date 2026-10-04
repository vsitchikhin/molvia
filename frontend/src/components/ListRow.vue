<template>
  <component
    :is="tag"
    class="list-row"
    :class="{ live: tag !== 'div', wrap, danger, inactive, selected, active }"
    :type="tag === 'button' ? 'button' : undefined"
    :href="link?.href.value"
    :aria-disabled="inactive && tag !== 'div' ? 'true' : undefined"
    :aria-checked="state === 'checked' ? String(selected) : undefined"
    :aria-selected="state === 'selected' ? String(selected) : undefined"
    @click="click"
  >
    <component :is="icon" v-if="icon" class="icon" aria-hidden="true" />
    <span class="words">
      <span class="title"
        ><slot name="title">{{ title }}</slot></span
      >
      <span v-if="meta || $slots.meta" class="meta"
        ><slot name="meta">{{ meta }}</slot></span
      >
    </span>
    <span v-if="$slots.tail" class="tail"><slot name="tail" /></span>
    <IconCheck v-if="selected" class="check" aria-hidden="true" />
    <IconChevronRight v-else-if="next" class="chevron" aria-hidden="true" />
  </component>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { Component, PropType } from 'vue'
import { useLink } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import IconCheck from '~icons/mdi/check'
import IconChevronRight from '~icons/mdi/chevron-right'

const TAGS = ['button', 'router-link', 'div'] as const
export type RowTag = (typeof TAGS)[number]

/** Roles whose choice is read out as checked, and those read out as selected. */
const CHECKED = new Set(['radio', 'menuitemradio', 'checkbox'])
const SELECTED = new Set(['option', 'gridcell', 'row', 'tab'])

/**
 * A row of a list (Ф-12, MOL-175): an icon of 24, a title 17/600, a meta of 13 in up to two lines, a
 * tail and a 20 chevron — 64 high, the hairline between rows drawn by the `AppCard list` around it.
 *
 *   as       — `button`, `router-link` (with `to`) or `div`. Only a `div` may hold a button in its
 *              tail: a button inside a button is no HTML, and a screen reader hears one of them;
 *   icon     — a component, drawn here at its step, so no screen can draw it at another;
 *   wrap     — the title breaks onto lines instead of ending in «…»;
 *   next     — the chevron (the owner's В-14 «а»): the row opens something to go on with — a screen, a
 *              sheet with fields. A row that acts at once or asks to confirm has none, and one card
 *              never mixes the two (DESIGN.md; held by review, the card is the screen's);
 *   danger   — the title and the icon in `bad-ink`: the row destroys;
 *   inactive — not now (Ф-6, MOL-174): focusable, `aria-disabled`, a press reaching nobody, the link
 *              followed nowhere; the meta says why;
 *   selected — the fill, the ring and a ✓ (Ф-5), the weight unchanged; read out by the role the row
 *              was given — `aria-checked` for a radio, `aria-selected` for an option — never only seen;
 *   active   — the row the keyboard stands on in a list a field owns (`aria-activedescendant`, К-4):
 *              the fill without the ring, since the focus is in the field.
 */
export default defineComponent({
  name: 'ListRow',
  components: { IconCheck, IconChevronRight },
  props: {
    as: {
      type: String as PropType<RowTag>,
      default: 'button',
      validator: (tag: string) => (TAGS as readonly string[]).includes(tag),
    },
    to: { type: [String, Object] as PropType<RouteLocationRaw>, default: undefined },
    title: { type: String, default: '' },
    meta: { type: String, default: '' },
    icon: { type: [Object, Function] as PropType<Component>, default: undefined },
    wrap: { type: Boolean, default: false },
    next: { type: Boolean, default: false },
    danger: { type: Boolean, default: false },
    inactive: { type: Boolean, default: false },
    selected: { type: Boolean, default: false },
    active: { type: Boolean, default: false },
  },
  emits: { click: (event: MouseEvent) => event instanceof MouseEvent },
  setup(props, { attrs, emit }) {
    // The tag is the row's for its life: a link is a link from the first render on.
    const link = props.as === 'router-link' ? useLink({ to: computed(() => props.to ?? '') }) : null
    const tag = props.as === 'router-link' ? 'a' : props.as
    const state = computed(() => {
      const role = typeof attrs.role === 'string' ? attrs.role : ''
      if (CHECKED.has(role)) return 'checked'
      if (SELECTED.has(role)) return 'selected'
      return null
    })
    function click(event: MouseEvent): void {
      if (props.inactive) {
        // Stopped as well as prevented, as the kit's button: nothing above hears a row that is not now.
        event.preventDefault()
        event.stopPropagation()
        return
      }
      emit('click', event)
      if (link && !event.defaultPrevented) void link.navigate(event)
    }
    return { link, tag, state, click }
  },
})
</script>

<style scoped lang="scss">
.list-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  box-sizing: border-box;
  width: 100%;
  min-height: calc(var(--touch-target-lg) + var(--space-3));
  padding: var(--space-3) var(--space-4);
  color: var(--text);
  font-family: var(--font);
  font-size: var(--text-body);
  line-height: var(--leading-snug);
  text-align: left;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

/* The button's own look taken off, weaker than any class: the hairline the list card draws between its
   rows is a border too, and an equal selector here would take it off by the order sheets load in. */
:where(.list-row) {
  margin: 0;
  border: 0;
  background: none;
}

.live {
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out);
}

@media (hover: hover) {
  .live:not(.inactive, .selected, .active):hover {
    background: var(--surface-2);
  }
}

.icon {
  @include icon;

  font-size: var(--icon-md);
  color: var(--text-muted);
}

.words {
  display: grid;
  flex: 1;
  min-width: 0;
}

.title {
  overflow: hidden;
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wrap .title {
  overflow-wrap: anywhere;
  white-space: normal;
}

.meta {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.tail {
  display: inline-flex;
  flex: none;
  align-items: center;
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}

.chevron {
  @include icon;

  font-size: var(--icon);
  color: var(--text-muted);
}

.check {
  @include icon;

  font-size: var(--icon-md);
  color: var(--accent-ink);
}

.danger {
  .title,
  .icon {
    color: var(--bad-ink);
  }
}

.inactive {
  cursor: default;

  .title,
  .icon {
    color: var(--text-muted);
  }
}

.selected {
  background: var(--accent-tint);
  box-shadow: inset 0 0 0 2px var(--accent);
}

.active {
  background: var(--accent-tint);
}
</style>
