<template>
  <AppCard class="card">
    <div class="head">
      <h2 class="caption">{{ t('accounts.title') }}</h2>
      <RouterLink v-if="live.length > 0" class="all" :to="{ name: 'money-accounts' }">
        {{ t('accounts.all') }}<IconChevron class="all-chevron" aria-hidden="true" />
      </RouterLink>
    </div>

    <ScreenSkeleton v-if="phase === 'loading'" :groups="[62, 48, 56, 44]" class="skeleton" />

    <div v-else-if="phase === 'error' || phase === 'offline'" class="failed">
      <span class="circle" aria-hidden="true"><IconAlert class="circle-icon" /></span>
      <p class="failed-text" :role="phase === 'error' ? 'alert' : undefined">
        {{ phase === 'error' ? t('accounts.load_failed') : t('spending.offline.title') }}
      </p>
      <AppButton v-if="phase === 'error'" variant="secondary" @click="store.refresh">
        <template #icon><IconRefresh /></template>
        {{ t('state.retry') }}
      </AppButton>
    </div>

    <template v-else-if="overview">
      <div v-if="live.length === 0" class="offer">
        <p class="offer-title">{{ t('accounts.offer.title') }}</p>
        <p class="footnote">{{ t('accounts.offer.body') }}</p>
        <AppButton variant="secondary" class="offer-action" @click="sheetOpen = true">
          <template #icon><IconPlus /></template>
          {{ t('accounts.offer.action') }}
        </AppButton>
      </div>

      <template v-else>
        <ul class="lines">
          <AccountLine v-for="account in shown" :key="account.id" :account="account" dense />
        </ul>
        <RouterLink v-if="hidden > 0" class="more" :to="{ name: 'money-accounts' }">
          <span>{{ t('accounts.more', { n: hidden }, hidden) }}</span>
          <IconChevron class="more-chevron" aria-hidden="true" />
        </RouterLink>
        <div class="total">
          <p class="total-line">
            <span class="total-label">{{ t('accounts.total') }}</span>
            <span class="total-figure" :class="{ negative: overview.totals.total.minor < 0n }">
              ≈ {{ estimate(overview.totals.total) }}
            </span>
          </p>
          <p class="footnote" :class="{ negative: overview.totals.spendable.minor < 0n }">
            {{
              t('accounts.total_foot', {
                spendable: `≈ ${estimate(overview.totals.spendable)}`,
                savings: `≈ ${estimate(overview.totals.savings)}`,
              })
            }}
          </p>
          <p v-if="stale === 'offline' || !online" class="footnote stale">
            {{ t('accounts.stale', { time: when(overview.countedAt) }) }}
          </p>
        </div>
      </template>

      <button
        v-if="overview.unassigned > 0"
        type="button"
        class="unassigned"
        @click="openUnassigned"
      >
        <IconInfo class="unassigned-icon" aria-hidden="true" />
        <span class="unassigned-text">
          {{ t('accounts.unassigned', { n: overview.unassigned }, overview.unassigned) }}
        </span>
        <IconChevron class="unassigned-icon" aria-hidden="true" />
      </button>
    </template>
  </AppCard>

  <AccountSheet
    v-model:open="sheetOpen"
    :spend-currency="overview?.spendCurrency ?? spendCurrency"
    :online="online"
    @done="added"
  />
  <UnassignedSheet v-model:open="unassignedOpen" :online="online" />
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconChevron from '~icons/mdi/chevron-right'
import IconInfo from '~icons/mdi/information-outline'
import IconPlus from '~icons/mdi/plus'
import IconRefresh from '~icons/mdi/refresh'
import type { Currency, Money } from '@molvia/model'
import AccountLine from '@/components/AccountLine.vue'
import AccountSheet from '@/components/AccountSheet.vue'
import type { AccountOutcome } from '@/components/AccountSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import UnassignedSheet from '@/components/UnassignedSheet.vue'
import { countedWhen, pageOrder, signedAmount } from '@/components/accounts'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useReconnect } from '@/composables/useReconnect'
import { useAccountsStore } from '@/stores/accounts'

/** Up to five rows on the card; from six, four and «Ещё N счетов ›» (handoff 01, question 1). */
const ALL_UP_TO = 5
const ROWS_WHEN_MORE = 4

/**
 * «Счета» on top of «Деньги» (MOL-123, handoff 01): balances are «now», not the month's, so the card
 * stays whatever month is below it. Its own loading and error — the month does not wait for it —
 * and offline the last balances with the moment they were counted, never red. With no account, an
 * offer instead of a state: the month under it works as before.
 */
export default defineComponent({
  name: 'AccountsCard',
  components: {
    AccountLine,
    AccountSheet,
    AppButton,
    AppCard,
    IconAlert,
    IconChevron,
    IconInfo,
    IconPlus,
    IconRefresh,
    ScreenSkeleton,
    UnassignedSheet,
  },
  props: {
    online: { type: Boolean, default: true },
    spendCurrency: { type: String as PropType<Currency>, required: true },
  },
  setup() {
    const { t, locale } = useI18n()
    const store = useAccountsStore()
    const announce = useAnnouncer()
    onMounted(() => void store.refresh())
    useReconnect(() => void store.refresh())

    const live = computed(() => pageOrder(store.accounts))
    const shown = computed(() =>
      live.value.length <= ALL_UP_TO ? live.value : live.value.slice(0, ROWS_WHEN_MORE),
    )
    const hidden = computed(() => live.value.length - shown.value.length)
    const estimate = (value: Money) => signedAmount(value, locale.value, { estimate: true })
    const when = (at: Date) => countedWhen(at, locale.value)

    const sheetOpen = ref(false)
    const unassignedOpen = ref(false)
    function openUnassigned(): void {
      unassignedOpen.value = true
    }
    function added(outcome: AccountOutcome): void {
      if (outcome.kind === 'added') announce?.(t('accounts.sheet.added', { name: outcome.name }))
    }

    return {
      t,
      store,
      phase: computed(() => store.phase),
      stale: computed(() => store.stale),
      overview: computed(() => store.overview),
      live,
      shown,
      hidden,
      estimate,
      when,
      sheetOpen,
      unassignedOpen,
      openUnassigned,
      added,
    }
  },
})
</script>

<style scoped lang="scss">
.card {
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--touch-target);
  padding: var(--space-1) var(--space-2) 0 var(--space-4);
}

.caption {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.all,
.more {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch-target);
  color: var(--accent-ink);
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  text-decoration: none;
}

.all {
  padding: 0 var(--space-2);
}

.all-chevron,
.more-chevron {
  width: 1.25rem;
  height: 1.25rem;
}

.skeleton {
  padding: 0 var(--space-4) var(--space-4);
}

.failed {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-4);
}

.circle {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-pill);
  background: var(--bad-tint);
  color: var(--bad-ink);
}

.circle-icon {
  width: 1.25rem;
  height: 1.25rem;
}

.failed-text {
  flex: 1;
  margin: 0;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.offer {
  display: grid;
  justify-items: start;
  gap: var(--space-1);
  padding: 0 var(--space-4) var(--space-4);
}

.offer-title {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.offer-action {
  margin-top: var(--space-2);
}

.lines {
  margin: 0;
  padding: 0;
  list-style: none;
}

.more {
  justify-content: space-between;
  width: 100%;
  padding: 0 var(--space-2) 0 var(--space-4);
  border-top: var(--hairline) solid var(--border);
  color: var(--text-muted);
  font-weight: var(--weight-regular);
}

.total {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border-top: var(--hairline) solid var(--border);
  background: var(--surface-2);
}

.total-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
}

.total-label {
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.total-figure {
  font-size: var(--text-headline);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.stale {
  color: var(--warn-ink);
}

.negative {
  color: var(--bad-ink);
}

.unassigned {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--touch-target);
  padding: 0 var(--space-3) 0 var(--space-4);
  border: 0;
  border-top: var(--hairline) solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--text-footnote);
  text-align: left;
  cursor: pointer;
}

.unassigned-text {
  flex: 1;
}

.unassigned-icon {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
}
</style>
