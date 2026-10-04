<template>
  <component
    :is="link ? 'a' : 'button'"
    class="nav-row"
    :type="link ? undefined : 'button'"
    :href="link?.href.value"
    :aria-haspopup="link ? undefined : 'dialog'"
    @click="click"
  >
    <component :is="icon" v-if="icon" class="icon" aria-hidden="true" />
    <span class="label">{{ label }}</span>
    <span v-if="value" class="value">{{ value }}</span>
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
 */
export default defineComponent({
  name: 'NavRow',
  components: { IconChevronRight },
  props: {
    to: { type: [String, Object] as PropType<RouteLocationRaw>, default: undefined },
    label: { type: String, required: true },
    value: { type: String, default: '' },
    icon: { type: [Object, Function] as PropType<Component>, default: undefined },
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
  padding: 0 var(--space-3) 0 var(--space-4);
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

.icon {
  @include icon;

  font-size: var(--icon-md);
  color: var(--text-muted);
}

.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value {
  flex: none;
  max-width: 50%;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-callout);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  @include icon;

  font-size: var(--icon);
  color: var(--text-muted);
}
</style>
