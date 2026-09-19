<template>
  <nav class="tabbar" :aria-label="t('nav.label')">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.name"
      v-slot="{ href, isExactActive }"
      :to="{ name: tab.name }"
      custom
    >
      <a
        class="tab"
        :href="href"
        :aria-current="isExactActive ? 'page' : undefined"
        @click="open($event, tab.name)"
      >
        <component :is="tab.icon" class="icon" aria-hidden="true" />
        <span class="label">{{ t(`nav.${tab.name}`) }}</span>
      </a>
    </RouterLink>
  </nav>
</template>

<script lang="ts">
import { defineComponent, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCart from '~icons/mdi/cart-outline'
import IconLightbulb from '~icons/mdi/lightbulb-on-outline'
import IconStar from '~icons/mdi/star-outline'
import { useNavigation } from '@/navigation'
import type { Tab } from '@/router'

const tabs: { name: Tab; icon: object }[] = [
  { name: 'trip', icon: markRaw(IconCart) },
  { name: 'advice', icon: markRaw(IconLightbulb) },
  { name: 'verdicts', icon: markRaw(IconStar) },
]

/**
 * The three sections of 0.1. Which one is active is the router's to say — its exact match sets
 * `aria-current="page"`, and the style hangs on that attribute rather than on a class of its
 * own, so what a screen reader hears and what the eye sees cannot disagree.
 *
 * The link keeps its `href`, so a long press or a modified click still does what a link does;
 * a plain tap goes through `goTab`, which decides how the move is written into the history.
 */
export default defineComponent({
  name: 'TabBar',
  setup() {
    const { t } = useI18n()
    const { goTab } = useNavigation()

    function open(event: MouseEvent, tab: Tab): void {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }
      event.preventDefault()
      void goTab(tab)
    }

    return { t, tabs, open }
  },
})
</script>

<style scoped lang="scss">
.tabbar {
  @include pinned-bar;

  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);

  /* 74 + the home indicator, not the handoff's fixed 74 + 22: 22 is one iPhone's indicator,
     and a phone with buttons would get an empty strip. */
  height: calc(var(--tabbar-height) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  border-top: var(--hairline) solid var(--border);

  /* Stays put while the screen above it slides: see the view transitions in main.scss. */
  view-transition-name: tabbar;
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding-top: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
  text-decoration: none;
  transition: color var(--dur-fast) var(--ease-out);
  -webkit-tap-highlight-color: transparent;

  &[aria-current='page'] {
    color: var(--accent-ink);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
}

.icon {
  /* 27 — the handoff's tab icon */
  width: 1.6875rem;
  height: 1.6875rem;
}

@media (prefers-reduced-motion: reduce) {
  .tab {
    transition: none;
  }
}
</style>
