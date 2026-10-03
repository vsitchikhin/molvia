<template>
  <div class="screen" :class="{ collapsed, docked, tabbed }" :style="dockStyle">
    <header ref="bar" class="bar">
      <div ref="column" class="leading">
        <template v-if="parentTitleKey">
          <button ref="button" class="back" type="button" @click="goBack">
            <IconChevronLeft ref="chevron" class="chevron" aria-hidden="true" />
            <!-- «Back» shown, where it leads still read after it: the name is «Back Trip» on every
                 step of the ladder, and the word shown starts it (review Р-2, owner's decision). -->
            <template v-if="fit === 'short'">
              <span class="label">{{ backWord }}</span>
              <span class="hidden">{{ ` ${parent}` }}</span>
            </template>
            <template v-else>
              <!-- The space is the hidden word's, so that it is read «Back Trip», not «BackTrip». -->
              <span class="hidden">{{ `${backWord} ` }}</span>
              <span :class="parentClass">{{ parent }}</span>
            </template>
          </button>
          <span class="samples" aria-hidden="true">
            <span ref="full">{{ parent }}</span>
            <span ref="short">{{ backWord }}</span>
          </span>
        </template>
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
      <!-- The room the strip below takes, kept inside the scroll: the last row of a list has to
           be reachable, and the strip is over the page, not in it. -->
      <div
        v-if="$slots.docked || updating"
        class="dock-room"
        :style="{ height: room }"
        aria-hidden="true"
      ></div>
    </div>

    <!-- Pinned above the tab bar, and the room for it is the frame's to keep: a screen that
         drew its own would part ways with the padding on the first change of its height. A new
         version waiting is its top row, over the screen's own main action (MOL-132, В-1). -->
    <div v-if="$slots.docked || updating" ref="dock" class="dock">
      <UpdateBand v-if="updating" :class="{ over: $slots.docked }" />
      <slot name="docked" />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUpdate, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import IconChevronLeft from '~icons/mdi/chevron-left'
import IdentityNotice from '@/components/IdentityNotice.vue'
import UpdateBand from '@/components/UpdateBand.vue'
import { useBackLabel } from '@/composables/useBackLabel'
import { useCollapsed, useHeight } from '@/composables/useCollapsed'
import { backTarget, useNavigation } from '@/navigation'
import { usePwaUpdate } from '@/pwaUpdate'

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
 *
 * At rest the row keeps no room for the small title it does not show, so the label has the
 * row. Once the title comes in, the label gives way first and by the iOS ladder — whole,
 * «Back», the chevron alone — and the title last, only when it alone does not fit between two
 * chevrons (MOL-75). The name does not follow the ladder: whatever is shown, the button is read
 * «Back Trip», the hidden part after the shown one — never «Back Back», and never a name that
 * loses where it leads as the page scrolls.
 */
export default defineComponent({
  name: 'AppScreen',
  components: { IconChevronLeft, IdentityNotice, UpdateBand },
  props: {
    title: { type: String, required: true },
  },
  setup(_props, { slots }) {
    const { t } = useI18n()
    const route = useRoute()
    const router = useRouter()

    const bar = ref<HTMLElement | null>(null)
    const dock = ref<HTMLElement | null>(null)
    const sentinel = ref<HTMLElement | null>(null)

    // Named by where it leads (`backTarget`): a screen opened from further up than its parent goes
    // back there, and says so (MOL-77) — the search of a record over «Покупки» says «Покупки».
    const parentTitleKey = computed(() => backTarget(router, route)?.location.meta.titleKey)

    const column = ref<HTMLElement | null>(null)
    const button = ref<HTMLElement | null>(null)
    const chevron = ref<ComponentPublicInstance | null>(null)
    const full = ref<HTMLElement | null>(null)
    const short = ref<HTMLElement | null>(null)
    const parent = computed(() => (parentTitleKey.value ? t(parentTitleKey.value) : ''))
    const backWord = computed(() => t('nav.back_label'))
    const fit = useBackLabel({
      column,
      button,
      chevron: computed(() => (chevron.value?.$el as Element | undefined) ?? null),
      full,
      short,
    })
    // Out of sight, the parent's title is still read after «Back».
    const parentClass = computed(() => (fit.value === 'none' ? 'hidden' : 'label'))
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

    // Measured rather than guessed: the strip holds a total that grows a line when the queue is
    // not empty or the rate jumped, and the last row of a list must never end up under it.
    const dockHeight = useHeight(dock)
    const room = computed(() =>
      dockHeight.value > 0 ? `calc(${String(dockHeight.value)}px + var(--space-4))` : undefined,
    )
    // What floats over the list (`FloatingDock`) rises above the strip by its height.
    const dockStyle = computed(() =>
      dockHeight.value > 0 ? { '--dock-height': `${String(dockHeight.value)}px` } : undefined,
    )
    const update = usePwaUpdate()
    const updating = computed(() => update.phase.value !== 'none')

    const { goBack } = useNavigation()

    return {
      t,
      bar,
      dock,
      sentinel,
      collapsed,
      parentTitleKey,
      column,
      button,
      chevron,
      full,
      short,
      fit,
      parent,
      backWord,
      parentClass,
      docked,
      tabbed,
      room,
      dockStyle,
      updating,
      goBack,
    }
  },
})
</script>

<style scoped lang="scss">
/* A column as tall as the viewport, so that what fills the content — an empty or an offline
   state — can take the free height and put its action at the bottom, under the thumb. */
.screen {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.bar {
  @include pinned-bar;

  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 1;
  display: grid;

  /* At rest the small title is not shown, and its column is nothing: the back label has the row. */
  grid-template-columns: minmax(0, 1fr) 0 minmax(0, auto);
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

/* The title in the middle of the row, and the sides equal so that it is: never narrower than
   the chevron alone, whose button stands a --space-1 out of its column — 40 here is 44 to tap. */
.collapsed .bar {
  grid-template-columns:
    minmax(calc(var(--touch-target) - var(--space-1)), 1fr) minmax(0, auto)
    minmax(calc(var(--touch-target) - var(--space-1)), 1fr);
  opacity: 1;
  pointer-events: auto;
  border-bottom-color: var(--border);
}

.leading {
  position: relative;
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

  justify-content: flex-start;
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
    @include focus-ring;

    border-radius: var(--radius-sm);
  }
}

.chevron {
  @include icon;

  font-size: var(--icon-back);
}

/* The ladder keeps a label from being cut; this keeps one inside its column where nothing
   measures — a platform without ResizeObserver. */
.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hidden {
  @include visually-hidden;
}

/* In the button's type, out of sight and out of the page's width. */
.samples {
  position: absolute;
  inset: 0;
  overflow: hidden;
  font-weight: var(--weight-medium);
  white-space: nowrap;
  visibility: hidden;
  pointer-events: none;

  > span {
    display: inline-block;
  }
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
  @include display-type;

  margin: 0;
  font-size: var(--text-display);
  line-height: var(--leading-tight);
  letter-spacing: -0.01em;

  /* Focused by the router after a move, for screen readers; nothing for the eye to see. */
  &:focus {
    outline: none;
  }
}

.subtitle {
  @include appear(0);

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
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: var(--space-4) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-4) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));

  /* What the screen puts in comes in — its answer in place of the skeleton above all (MOL-151);
     not on the screen's own arrival, which the view transition already plays. */
  > :slotted(*) {
    @include appear;
  }
}

.dock-room {
  flex: none;
}

/* Over the page, above the tab bar where there is one, and below the safe area where there is
   not: the same chrome as the pinned row at the top. */
.dock {
  @include pinned-bar;
  @include appear(100%);

  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  border-top: var(--hairline) solid var(--border);
  padding: 0 calc(var(--space-4) + var(--safe-right)) var(--safe-bottom)
    calc(var(--space-4) + var(--safe-left));
}

.tabbed .dock {
  bottom: calc(var(--tabbar-height) + var(--safe-bottom));
  padding-bottom: 0;
}

/* Parted from the screen's own row under it by the strip's own hairline. */
.over {
  border-bottom: var(--hairline) solid var(--border);
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
