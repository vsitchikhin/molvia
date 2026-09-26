<template>
  <div class="home">
    <ScreenState
      v-if="isOffline"
      class="notice"
      kind="offline"
      tone="good"
      inline
      :title="t('trip.home.offline.title')"
      :body="rows.length > 0 ? t('trip.home.offline.body') : t('trip.home.offline.body_no_memory')"
    />

    <template v-if="shown === 'new'">
      <div class="intro">
        <h2 class="intro-title">{{ t('trip.home.intro.title') }}</h2>
        <p class="intro-body">{{ t('trip.home.intro.body') }}</p>
      </div>

      <p class="caption">{{ t('trip.home.how.caption') }}</p>
      <!-- The cycle explains the tab bar too: steps 1, 3 and 4 wear the tabs' own icons. Only the
           steps that lead somewhere are buttons; the first one's action is the button below. -->
      <AppCard as="ol" list>
        <li class="line">
          <IconCart class="icon" aria-hidden="true" />
          <span class="text">
            <span class="title">{{ t('trip.home.how.start_title') }}</span>
            <span class="sub">{{ t('trip.home.how.start_body') }}</span>
          </span>
        </li>
        <li class="line">
          <IconBasketPlus class="icon" aria-hidden="true" />
          <span class="text">
            <span class="title">{{ t('trip.home.how.shelf_title') }}</span>
            <span class="sub">{{ t('trip.home.how.shelf_body') }}</span>
          </span>
        </li>
        <li>
          <button class="line link" type="button" @click="goTab('verdicts')">
            <IconStar class="icon" aria-hidden="true" />
            <span class="text">
              <span class="title">{{ t('trip.home.how.rate_title') }}</span>
              <span class="sub">{{ t('trip.home.how.rate_body') }}</span>
            </span>
            <IconChevronRight class="chevron" aria-hidden="true" />
          </button>
        </li>
        <li>
          <button class="line link" type="button" @click="goTab('advice')">
            <IconLightbulb class="icon" aria-hidden="true" />
            <span class="text">
              <span class="title">{{ t('trip.home.how.advice_title') }}</span>
              <span class="sub">{{ t('trip.home.how.advice_body') }}</span>
            </span>
            <IconChevronRight class="chevron" aria-hidden="true" />
          </button>
        </li>
      </AppCard>
    </template>

    <template v-else>
      <AppCard v-if="pending > 0" class="pending" list>
        <button class="line link" type="button" @click="goTab('verdicts')">
          <IconStar class="icon accent" aria-hidden="true" />
          <span class="text">
            <span class="title">{{ t('verdict.pending_count', { n: pending }, pending) }}</span>
            <span v-if="pendingFrom" class="sub">{{ pendingFrom }}</span>
          </span>
          <IconChevronRight class="chevron" aria-hidden="true" />
        </button>
      </AppCard>

      <p class="caption">{{ t('trip.home.recent.caption') }}</p>

      <ScreenSkeleton v-if="shown === 'loading'" :groups="[30, 62, 48, 70]" />

      <AppCard v-else-if="shown === 'recent'" list>
        <TripHistoryRow v-for="row in recent" :key="row.id" :row="row" @open="open" />
        <button class="line link all" type="button" @click="all">
          <IconHistory class="icon" aria-hidden="true" />
          <span class="text">
            <span class="all-label">{{ t('trip.home.recent.all') }}</span>
          </span>
          <IconChevronRight class="chevron" aria-hidden="true" />
        </button>
      </AppCard>

      <AppCard v-else-if="shown === 'no-memory'" list>
        <div class="line">
          <IconHistory class="icon" aria-hidden="true" />
          <span class="text">
            <span class="title">{{ t('trip.home.no_memory.title') }}</span>
            <span class="sub">{{ t('trip.home.no_memory.body') }}</span>
          </span>
        </div>
      </AppCard>

      <!-- Quiet on purpose: a red block's «Повторить» is a main button, and a second one beside
           «Начать поход» would compete for the thumb. The trip starts without the history. -->
      <AppCard v-else list>
        <div class="line">
          <IconAlert class="icon bad" aria-hidden="true" />
          <span class="text">
            <span class="title">{{ t('trip.home.error.title') }}</span>
            <span class="sub">{{ t('trip.home.error.body') }}</span>
          </span>
        </div>
        <button class="line link retry" type="button" @click="load">
          <IconRefresh class="icon" aria-hidden="true" />
          <span class="text">{{ t('state.retry') }}</span>
        </button>
      </AppCard>
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconBasketPlus from '~icons/mdi/basket-plus-outline'
import IconCart from '~icons/mdi/cart-outline'
import IconChevronRight from '~icons/mdi/chevron-right'
import IconHistory from '~icons/mdi/history'
import IconLightbulb from '~icons/mdi/lightbulb-on-outline'
import IconRefresh from '~icons/mdi/refresh'
import IconStar from '~icons/mdi/star-outline'
import AppCard from '@/components/AppCard.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import TripHistoryRow from '@/components/TripHistoryRow.vue'
import { useTripHistory } from '@/composables/useTripHistory'
import { useVerdictQueue } from '@/composables/useVerdictQueue'
import { purchaseDay } from '@/days'
import { useNavigation } from '@/navigation'

/** How many finished trips the home screen lists: three fit above «Начать поход» on 390×844. */
const RECENT = 3

/**
 * «Поход» with no trip going on — the first screen a new person meets (MOL-77). A newcomer is
 * told what the product is and how its cycle goes; a person with a history gets their last trips
 * and the purchases waiting for a verdict. «Начать поход» is not here: it stands in the strip
 * above the tab bar, in every state, and belongs to the trip screen.
 *
 * **The introduction is only for a history known to be empty** — the server answered, now or on
 * an earlier launch (`answered`), and the phone holds no finish of its own. No answer and no
 * memory is not «nobody»: greeting a person with twenty trips as a newcomer, because the network
 * dropped, is the one thing this screen must not do (MOL-56's rule, applied here).
 *
 * Only the person's own data: their trips and their purchases. Nothing of «Что брать» is on it —
 * other people's figures are behind access there (MOL-31).
 */
export default defineComponent({
  name: 'TripHome',
  components: {
    AppCard,
    IconAlert,
    IconBasketPlus,
    IconCart,
    IconChevronRight,
    IconHistory,
    IconLightbulb,
    IconRefresh,
    IconStar,
    ScreenSkeleton,
    ScreenState,
    TripHistoryRow,
  },
  props: {
    /** The trip itself could not be asked for, and there was no connection. */
    offline: { type: Boolean, default: false },
  },
  setup(props) {
    const router = useRouter()
    const { goTab } = useNavigation()
    const screen = useTripHistory()
    const { t, history, rows, trouble } = screen
    const queue = useVerdictQueue()
    const { locale } = useI18n()

    const isOffline = computed(() => props.offline || trouble.value === 'offline')

    const shown = computed<'new' | 'recent' | 'loading' | 'no-memory' | 'error'>(() => {
      if (rows.value.length > 0) return 'recent'
      if (history.answered) return 'new'
      if (trouble.value === null) return 'loading'
      return trouble.value === 'offline' ? 'no-memory' : 'error'
    })

    const recent = computed(() => rows.value.slice(0, RECENT))

    const pending = computed(() => queue.count.value)

    /**
     * «Из похода в «Ереван Сити» вчера», or «Из 3 походов». A card carries the place and the day
     * of its latest purchase, not the trip (MOL-28), so a trip is told by that pair — the best the
     * phone knows. Counted over the page the queue holds: past fifty items the count is of them.
     */
    const pendingFrom = computed(() => {
      const trips = new Map<string, { place: string; when: string }>()
      for (const card of queue.cards.value) {
        const when = purchaseDay(card.boughtAt, locale.value)
        trips.set(`${card.placeName}\u0000${when}`, { place: card.placeName, when })
      }
      const [only] = trips.values()
      if (trips.size === 1 && only) return t('trip.home.pending.one_trip', only)
      if (trips.size > 1) return t('trip.home.pending.many_trips', { n: trips.size }, trips.size)
      return null
    })

    return {
      t,
      goTab: (tab: 'verdicts' | 'advice') => void goTab(tab),
      isOffline,
      shown,
      rows,
      recent,
      pending,
      pendingFrom,
      load: () => {
        screen.load()
      },
      open: (id: string) => {
        screen.open(id)
      },
      all: () => void router.push({ name: 'trip-history' }),
    }
  },
})
</script>

<style scoped lang="scss">
.home {
  display: flex;
  flex-direction: column;
}

.notice {
  margin-bottom: var(--space-3);
}

.intro {
  padding: 0 var(--space-1);
}

.intro-title {
  margin: 0 0 var(--space-2);
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
  text-wrap: balance;
}

.intro-body {
  margin: 0;
  color: var(--text);
  font-size: var(--text-body);
  line-height: var(--leading-body);
}

.caption {
  margin: var(--space-6) var(--space-1) var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.pending + .caption,
.notice + .caption {
  margin-top: var(--space-4);
}

.home > .caption:first-child {
  margin-top: var(--space-1);
}

.line {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-height: calc(var(--touch-target-lg) + var(--space-3));
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  color: var(--text);
  background: var(--surface);
  text-align: left;
  font: inherit;
}

/* At no weight, so the rule between rows stays `AppCard list`'s (see `TripHistoryRow`). */
:where(.line) {
  border: 0;
}

.link {
  cursor: pointer;

  &:hover {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.all,
.retry {
  min-height: var(--touch-target-lg);
}

.retry {
  color: var(--accent-ink);
  font-weight: var(--weight-medium);
}

.icon {
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  color: var(--text-muted);
}

.retry .icon,
.icon.accent {
  color: var(--accent-ink);
}

.icon.bad {
  color: var(--bad-ink);
}

.text {
  flex: 1;
  min-width: 0;
}

.title {
  display: block;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.sub {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.all-label {
  font-size: var(--text-body);
}

.chevron {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  color: var(--text-muted);
}
</style>
