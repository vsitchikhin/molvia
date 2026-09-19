<template>
  <div class="screen" :class="{ collapsed, docked, tabbed }">
    <header ref="bar" class="bar">
      <div class="leading">
        <button v-if="parentTitleKey" class="back" type="button" @click="goBack">
          <IconChevronLeft class="chevron" aria-hidden="true" />
          <span class="hidden">{{ t('nav.back_label') }}</span> {{ t(parentTitleKey) }}
        </button>
        <div v-else-if="$slots.meta" class="meta" :aria-hidden="collapsed ? 'true' : undefined">
          <slot name="meta" />
        </div>
      </div>

      <!-- The large title below stays in the page, scrolled away or not, so a screen reader
           reads it there; this copy is only for the eye. -->
      <p class="small" aria-hidden="true">{{ title }}</p>

      <div class="trailing">
        <slot name="trailing" />
      </div>
    </header>

    <div class="head">
      <h1 class="title" tabindex="-1">{{ title }}</h1>
      <div v-if="$slots.subtitle" class="subtitle">
        <slot name="subtitle" />
      </div>
      <div ref="sentinel" class="sentinel" aria-hidden="true"></div>
    </div>

    <div class="notice-slot">
      <IdentityNotice />
    </div>

    <div class="content">
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUpdate, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import IconChevronLeft from '~icons/mdi/chevron-left'
import IdentityNotice from '@/components/IdentityNotice.vue'
import { useCollapsed, useHeight } from '@/composables/useCollapsed'
import { useNavigation } from '@/navigation'

/**
 * The frame every screen of 0.1 sits in: a pinned row, the large title, the room under the tab
 * bar. Four screens drawing their own would drift apart on the first change, and `App.vue`
 * cannot draw it for them — the trip puts its own buttons into the row.
 *
 * The row is pinned only when it has something in it: a back chevron, the trip's place and
 * «Finish». «What to buy» and «Ratings» have neither, and the mockup puts their title right
 * under the status bar — so there the row takes no room at rest and appears over the content,
 * holding the small title, once the large one has scrolled away.
 *
 * The chevron is labelled with the parent's title, never the word «Back»: the label says where
 * it leads. «Back» is still read out — as hidden text in front of the label, not an
 * `aria-label`, which would replace the visible word and leave a person saying «tap Trip» to
 * voice control with nothing to tap.
 */
export default defineComponent({
  name: 'AppScreen',
  components: { IconChevronLeft, IdentityNotice },
  props: {
    title: { type: String, required: true },
  },
  setup(_props, { slots }) {
    const { t } = useI18n()
    const route = useRoute()
    const router = useRouter()

    const bar = ref<HTMLElement | null>(null)
    const sentinel = ref<HTMLElement | null>(null)

    const parentTitleKey = computed(() => {
      const parent = route.meta.parent
      return parent ? router.resolve({ name: parent }).meta.titleKey : undefined
    })
    // Slots are not reactive, so a computed would keep whatever it saw on mount — and the trip's
    // place and «Finish» arrive with the trip, from the API, after it. Read again before every
    // render instead: a row filled late is pinned and alive, not drawn inside an invisible one.
    const hasRow = (): boolean => Boolean(parentTitleKey.value ?? slots.meta ?? slots.trailing)
    const docked = ref(hasRow())
    onBeforeUpdate(() => {
      docked.value = hasRow()
    })
    const tabbed = computed(() => Boolean(route.meta.tab))

    // Under a pinned row the title is gone once it passes the row's bottom edge; with the row
    // out of the page, once it passes the top of the window.
    const barHeight = useHeight(bar)
    const line = computed(() => (docked.value ? barHeight.value : 0))
    const collapsed = useCollapsed(sentinel, line)

    const { goBack } = useNavigation()

    return { t, bar, sentinel, collapsed, parentTitleKey, docked, tabbed, goBack }
  },
})
</script>

<style scoped lang="scss">
.bar {
  @include pinned-bar;

  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr);
  align-items: center;
  gap: var(--space-2);
  height: calc(var(--bar-height) + var(--safe-top));
  padding: var(--safe-top) calc(var(--space-4) + var(--safe-right)) 0
    calc(var(--space-4) + var(--safe-left));
  border-bottom: var(--hairline) solid transparent;

  /* With nothing in it the row waits out of sight and takes no room. */
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

/* Something is in the row: it holds its place in the page and never moves. */
.docked .bar {
  position: sticky;
  opacity: 1;
  pointer-events: auto;
}

.collapsed .bar {
  opacity: 1;
  pointer-events: auto;
  border-bottom-color: var(--border);
}

.leading {
  min-width: 0;
}

.trailing {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
}

.meta {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: opacity var(--dur) var(--ease);
}

.collapsed .meta {
  opacity: 0;
}

.small {
  margin: 0;
  overflow: hidden;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0;
  transform: translateY(var(--space-2));
  transition:
    opacity var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}

.collapsed .small {
  opacity: 1;
  transform: none;
}

.back {
  @include touch-target;

  gap: var(--space-1);
  max-width: 100%;
  margin-left: calc(var(--space-1) * -1);
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-ink);
  font: inherit;
  font-weight: var(--weight-medium);
  white-space: nowrap;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
}

.chevron {
  /* 26 — the handoff's chevron */
  flex: none;
  width: 1.625rem;
  height: 1.625rem;
}

.hidden {
  @include visually-hidden;
}

.head {
  position: relative;
  padding: calc(var(--safe-top) + var(--space-4)) calc(var(--space-4) + var(--safe-right))
    var(--space-3) calc(var(--space-4) + var(--safe-left));
  border-bottom: var(--hairline) solid var(--border);
  background: var(--chrome);
}

.docked .head {
  padding-top: 0;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-display);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: -0.01em;

  /* Focused by the router after a move, for screen readers; nothing for the eye to see. */
  &:focus {
    outline: none;
  }
}

.subtitle {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

/* Its bottom edge 24px below the top of the header: scrolled past it, the title counts as
   gone. Lifted by its own height because an observer still reports a box that only touches
   the line as intersecting — at the top edge the collapse would come a pixel late. */
.sentinel {
  position: absolute;
  top: var(--space-6);
  width: 1px;
  height: 1px;
  pointer-events: none;
  transform: translateY(-100%);
}

/* The home indicator is below every screen, not only under the tab bar: a nested screen has
   no bar to carry it, and its last row would sit under the indicator. */
.content {
  padding: var(--space-4) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-4) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}

/* The notice keeps its own margins; this only keeps it out from under a notch held sideways. */
.notice-slot {
  padding: 0 var(--safe-right) 0 var(--safe-left);
}

.tabbed .content {
  padding-bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--space-8));
}

@media (prefers-reduced-motion: reduce) {
  .bar,
  .meta,
  .small {
    transition: none;
  }
}
</style>
