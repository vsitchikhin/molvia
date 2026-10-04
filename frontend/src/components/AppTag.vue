<template>
  <span class="tag" :class="tone">
    <component :is="icon" v-if="icon" class="icon" aria-hidden="true" />
    <slot />
  </span>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { Component, PropType } from 'vue'

/**
 * A tag in a row (MOL-175, beyond FIXES): a pill of 13/600 — «сбережения», «Отправляем…», «Не
 * принята», «изменено». Rows drew it at 11/700, 11/600 and 13/600; now one. The tone is the state's:
 * `plain` on `surface-2`, `warn` for what waits, `bad` for what was refused. An icon is 14, the step
 * for a pill of 13.
 */
export default defineComponent({
  name: 'AppTag',
  props: {
    tone: { type: String as PropType<'plain' | 'warn' | 'bad'>, default: 'plain' },
    icon: { type: [Object, Function] as PropType<Component>, default: undefined },
  },
})
</script>

<style scoped lang="scss">
.tag {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  white-space: nowrap;
}

.icon {
  @include icon;

  font-size: var(--icon-xs);
}

.warn {
  background: var(--warn-tint);
  color: var(--warn-ink);
}

.bad {
  background: var(--bad-tint);
  color: var(--bad-ink);
}
</style>
