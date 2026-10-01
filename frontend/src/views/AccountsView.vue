<template>
  <AppScreen :title="t('accounts.title')">
    <template #subtitle>{{ t('spending.subtitle') }}</template>

    <div class="content" :class="{ roomy: phase === 'ready' }">
      <p v-if="phase === 'ready' && !online && overview" class="strip">
        <IconCloudOff class="strip-icon" aria-hidden="true" />
        {{ t('accounts.screen.offline', { time: when(overview.countedAt) }) }}
      </p>
      <ScreenState
        v-else-if="phase === 'ready' && stale === 'error'"
        kind="error"
        inline
        :title="t('accounts.screen.error.title')"
        :body="t('accounts.error_body')"
        @retry="store.refresh"
      />

      <ScreenSkeleton v-if="phase === 'loading'" :groups="[40, 70, 60, 24, 80, 64, 72]" />

      <ScreenState
        v-else-if="phase === 'error'"
        kind="error"
        :title="t('accounts.screen.error.title')"
        :body="t('accounts.error_body')"
        @retry="store.refresh"
      />

      <ScreenState
        v-else-if="phase === 'offline'"
        kind="offline"
        tone="warn"
        :title="t('spending.offline.title')"
        :body="t('accounts.screen.offline_empty')"
      />

      <template v-else-if="overview">
        <ScreenState
          v-if="live.length === 0"
          kind="empty"
          tone="accent"
          :icon="IconWallet"
          :title="t('accounts.offer.title')"
          :body="t('accounts.screen.empty.body')"
        >
          <template #action>
            <AppButton size="large" block @click="compose">
              {{ t('accounts.offer.action') }}
            </AppButton>
          </template>
        </ScreenState>

        <template v-else>
          <AppCard class="total">
            <p class="caption">{{ t('accounts.total') }}</p>
            <p class="figure" :class="{ negative: overview.totals.total.minor < 0n }">
              ≈ {{ estimate(overview.totals.total) }}
            </p>
            <div class="tiles">
              <div class="tile">
                <span class="tile-label">{{ t('accounts.screen.spendable') }}</span>
                <span
                  class="tile-figure"
                  :class="{ negative: overview.totals.spendable.minor < 0n }"
                >
                  ≈ {{ estimate(overview.totals.spendable) }}
                </span>
              </div>
              <div class="tile">
                <span class="tile-label">{{ t('accounts.savings') }}</span>
                <span class="tile-figure">≈ {{ estimate(overview.totals.savings) }}</span>
              </div>
            </div>
            <p v-if="rateLine" class="footnote">{{ rateLine }}</p>
            <p v-if="overview.totals.uncounted > 0" class="footnote">
              {{
                t(
                  'accounts.screen.uncounted',
                  { n: overview.totals.uncounted },
                  overview.totals.uncounted,
                )
              }}
            </p>
          </AppCard>

          <AppReveal group>
            <section v-for="group in groups" :key="group.key" class="group">
              <h2 class="group-caption">{{ group.title }}</h2>
              <AppCard as="ul" list>
                <AppReveal group>
                  <AccountLine
                    v-for="account in group.accounts"
                    :key="account.id"
                    :account="account"
                  />
                </AppReveal>
              </AppCard>
            </section>
          </AppReveal>
        </template>

        <AppCard v-if="removedAccounts.length > 0" class="removed">
          <button
            type="button"
            class="removed-head"
            :aria-expanded="showRemoved ? 'true' : 'false'"
            @click="showRemoved = !showRemoved"
          >
            <IconArchive class="removed-icon" aria-hidden="true" />
            <span class="removed-title">
              {{ t('accounts.screen.archived', { n: removedAccounts.length }) }}
            </span>
            <IconDown class="removed-icon turn" :class="{ up: showRemoved }" aria-hidden="true" />
          </button>
          <AppReveal>
            <div v-if="showRemoved">
              <ul class="removed-list">
                <AppReveal group>
                  <li v-for="account in removedAccounts" :key="account.id" class="removed-row">
                    <RouterLink
                      class="removed-open"
                      :to="{ name: 'money-account', params: { accountId: account.id } }"
                    >
                      <span class="removed-name">{{ account.name }}</span>
                      <span class="removed-sub">{{ removedLine(account) }}</span>
                    </RouterLink>
                    <AppButton
                      variant="secondary"
                      :disabled="!online || restoring === account.id"
                      :busy="restoring === account.id"
                      @click="bringBack(account)"
                    >
                      <template #icon><IconUndo /></template>
                      {{ t('accounts.screen.restore') }}
                    </AppButton>
                  </li>
                </AppReveal>
              </ul>
              <p class="footnote removed-note">{{ t('accounts.screen.archived_note') }}</p>
            </div>
          </AppReveal>
        </AppCard>
      </template>
    </div>

    <FloatingDock v-if="store.removed || showsAdd" class="float">
      <UndoStrip
        v-if="store.removed"
        :key="store.removed.stamp"
        :text="t('accounts.screen.removed', { name: store.removed.name })"
        :announcement="t('accounts.screen.removed_announced', { name: store.removed.name })"
        :action="t('accounts.screen.restore')"
        @restore="undoRemoval"
        @expire="store.removed = null"
      />
      <AppButton v-else ref="addButton" size="large" class="add" @click="compose">
        <template #icon><IconPlus /></template>
        {{ t('accounts.screen.add') }}
      </AppButton>
    </FloatingDock>

    <AccountSheet
      v-model:open="sheetOpen"
      :spend-currency="spendCurrency"
      :online="online"
      @done="done"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import IconArchive from '~icons/mdi/archive-outline'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconDown from '~icons/mdi/chevron-down'
import IconPlus from '~icons/mdi/plus'
import IconUndo from '~icons/mdi/undo-variant'
import IconWallet from '~icons/mdi/wallet-outline'
import type { Currency, ExchangeRate, Money, MoneyAccountView } from '@molvia/model'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import { api } from '@/api'
import AccountLine from '@/components/AccountLine.vue'
import AccountSheet from '@/components/AccountSheet.vue'
import type { AccountOutcome } from '@/components/AccountSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import FloatingDock from '@/components/FloatingDock.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { countedWhen, pageOrder, removedOf, shortDay, signedAmount } from '@/components/accounts'
import { rateWords } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useReconnect } from '@/composables/useReconnect'
import { useAccountsOnScreen, useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'

/** The order the rate line names the currencies in (handoff 02). */
const RATE_ORDER: readonly Currency[] = ['RUB', 'USD', 'EUR', 'AMD']

/**
 * «Счета» (MOL-123, handoff 02): where the money lies — the totals in the spending currency, the
 * accounts for spending and the savings, and the ones taken out of the choice. Every figure is the
 * server's, always «≈» in the totals: a sum by rates is not money in hand. Offline it is the last
 * answer with its age; an account is written with a connection only.
 */
export default defineComponent({
  name: 'AccountsView',
  components: {
    AccountLine,
    AccountSheet,
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    FloatingDock,
    IconArchive,
    IconCloudOff,
    IconDown,
    IconPlus,
    IconUndo,
    ScreenSkeleton,
    ScreenState,
    UndoStrip,
  },
  setup() {
    const { t, locale } = useI18n()
    const store = useAccountsStore()
    useAccountsOnScreen()
    const actor = useActorStore()
    const announce = useAnnouncer()

    const online = ref(navigator.onLine)
    const onLine = () => (online.value = true)
    const offLine = () => (online.value = false)
    onMounted(() => {
      window.addEventListener('online', onLine)
      window.addEventListener('offline', offLine)
      void store.refresh()
    })
    onUnmounted(() => {
      window.removeEventListener('online', onLine)
      window.removeEventListener('offline', offLine)
      // The strip is this screen's offer: left, it is not made again on a later visit (review 18).
      store.removed = null
    })
    useReconnect(() => void store.refresh())

    const phase = computed(() => store.phase)
    const overview = computed(() => store.overview)
    const live = computed(() => pageOrder(store.accounts))
    const removedAccounts = computed(() => removedOf(store.accounts))
    const spendCurrency = computed<Currency>(
      () => overview.value?.spendCurrency ?? actor.settings?.spendCurrency ?? 'AMD',
    )

    const groups = computed(() =>
      [
        {
          key: 'spending',
          title: t('accounts.for_spending'),
          accounts: live.value.filter((account) => !account.savings),
        },
        {
          key: 'savings',
          title: t('accounts.savings'),
          accounts: live.value.filter((account) => account.savings),
        },
      ].filter((group) => group.accounts.length > 0),
    )

    const estimate = (value: Money) => signedAmount(value, locale.value, { estimate: true })
    const when = (at: Date) => countedWhen(at, locale.value)

    /**
     * «По моему курсу: 4,62 ֏ за 1 ₽ · 390,00 ֏ за 1 $» — the currencies the accounts hold, each once,
     * by the rate the server counted them with; the words say whose rate it was.
     */
    const rateLine = computed(() => {
      const rates = new Map<Currency, ExchangeRate>()
      for (const account of live.value)
        if (account.rate && !rates.has(account.currency)) rates.set(account.currency, account.rate)
      const ordered = RATE_ORDER.flatMap((currency) => {
        const rate = rates.get(currency)
        return rate ? [rate] : []
      })
      if (ordered.length === 0) return null
      const words = ordered.map((rate) => rateWords(rate, locale.value, t)).join(' · ')
      const sources = new Set(ordered.map((rate) => rate.source === 'personal'))
      if (sources.size > 1) return t('accounts.screen.rate_mixed', { rates: words })
      return sources.has(true)
        ? t('accounts.screen.rate', { rates: words })
        : t('accounts.screen.rate_official', { rates: words })
    })

    const showRemoved = ref(false)
    function removedLine(account: MoneyAccountView): string {
      return t('accounts.screen.archived_row', {
        currency: account.currency,
        amount: signedAmount(account.balance, locale.value),
        date: account.archivedAt
          ? new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short' }).format(
              account.archivedAt,
            )
          : shortDay(account.startOn, locale.value),
      })
    }

    const restoring = ref<string | null>(null)
    async function bringBack(account: MoneyAccountView): Promise<void> {
      restoring.value = account.id
      try {
        store.accept(await api.restoreMoneyAccount(account.id))
        announce?.(t('accounts.screen.restored', { name: account.name }))
      } catch {
        announce?.(t('accounts.sheet.failed'))
      } finally {
        restoring.value = null
      }
    }

    const sheetOpen = ref(false)
    function compose(): void {
      sheetOpen.value = true
    }

    const addButton = ref<ComponentPublicInstance | null>(null)
    function done(outcome: AccountOutcome): void {
      if (outcome.kind === 'added') announce?.(t('accounts.sheet.added', { name: outcome.name }))
      else if (outcome.kind === 'saved') announce?.(t('accounts.sheet.saved'))
      else if (outcome.kind === 'archived')
        announce?.(t('accounts.screen.archived_done', { name: outcome.name }))
      else store.removed = { id: outcome.id, name: outcome.name, stamp: Date.now() }
    }

    /**
     * The offer goes with the answer, never with the tap (the rule of an exchange, an income and a
     * spending): a write lost on the way leaves the removal undoable, and «Вернуть» stays — a deleted
     * account is in no list it could be brought back from (adversarial Г).
     */
    async function undoRemoval(): Promise<void> {
      const removal = store.removed
      if (!removal) return
      try {
        store.accept(await api.restoreMoneyAccount(removal.id))
        store.removed = null
        announce?.(t('accounts.screen.restored', { name: removal.name }))
      } catch (caught) {
        const late =
          caught instanceof ApiError && caught.answered && caught.code === ERROR.NOT_FOUND
        if (late) {
          store.removed = null
          announce?.(t('accounts.screen.restore_late', { name: removal.name }))
        } else {
          // The strip anew, for another ten seconds: the server keeps the mark ten minutes.
          store.removed = { ...removal, stamp: Date.now() }
          announce?.(t('accounts.screen.restore_failed'))
        }
        return
      }
      await nextTick()
      ;(addButton.value?.$el as HTMLElement | undefined)?.focus()
    }

    const showsAdd = computed(() => phase.value === 'ready' && live.value.length > 0)

    return {
      t,
      IconWallet,
      store,
      online,
      phase,
      stale: computed(() => store.stale),
      overview,
      live,
      removedAccounts,
      spendCurrency,
      groups,
      estimate,
      when,
      rateLine,
      showRemoved,
      removedLine,
      restoring,
      bringBack,
      sheetOpen,
      compose,
      addButton,
      done,
      undoRemoval,
      showsAdd,
    }
  },
})
</script>

<style scoped lang="scss">
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-3);
  padding: var(--space-4);

  &.roomy {
    padding-bottom: calc(var(--space-8) + var(--space-8) + var(--space-6));
  }
}

.strip {
  @include appear;

  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-footnote);
}

.strip-icon {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
}

.total {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
}

.caption,
.group-caption {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.group-caption {
  padding: var(--space-2) var(--space-1) var(--space-2);
}

.figure {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-figure);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.negative {
  color: var(--bad-ink);
}

.tiles {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.tile {
  display: grid;
  align-content: center;
  min-height: 4rem;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.tile-label {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.tile-figure {
  font-size: var(--text-headline);
  white-space: nowrap;
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
}

.footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.group {
  display: grid;
}

.removed {
  margin-top: var(--space-2);
  box-shadow: none;
}

.removed-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--touch-target-lg);
  padding: 0 var(--space-4);
  border: none;
  background: none;
  color: var(--text-muted);
  font: inherit;
  cursor: pointer;
}

.removed-title {
  flex: 1;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  text-align: left;
}

.removed-icon {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
}

/* One chevron turned rather than two swapped: it is seen to open the list (MOL-151). */
.turn {
  transition: rotate var(--dur) var(--ease);

  &.up {
    rotate: 180deg;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}

.removed-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.removed-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border-top: var(--hairline) solid var(--border);
}

.removed-open {
  display: grid;
  flex: 1;
  min-width: 0;
  color: var(--text-muted);
  text-decoration: none;
}

.removed-name {
  overflow: hidden;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.removed-sub {
  font-size: var(--text-footnote);
}

.removed-note {
  padding: 0 var(--space-4) var(--space-3);
}
</style>
