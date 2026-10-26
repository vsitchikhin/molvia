<template>
  <AppScreen :title="t('accounts.title')">
    <template #subtitle>{{ t('spending.subtitle') }}</template>

    <div class="content">
      <!-- The connection in one line, the screen's words with the hour of the answer shown (MOL-181,
           Ф-14). The strip over the tab bar holds «Добавить счёт», so «Повторить» is here (К-5). -->
      <StatusStrip
        v-if="phase === 'ready' && !online && overview"
        kind="offline"
        :text="t('accounts.screen.offline', { time: when(overview.countedAt) })"
      />
      <!-- By the last read, not by whether this session had an answer before it: the page shown is
           older than the read that failed, as «Деньги» say of the same money (MOL-183, Б1). -->
      <StatusStrip
        v-else-if="phase === 'ready' && failed === 'error' && overview"
        kind="unanswered"
        :text="t('accounts.screen.unanswered', { time: when(overview.countedAt) })"
        :attempt="store.failures"
      >
        <template #action>
          <AppButton variant="ghost" @click="store.refresh">{{ t('state.retry') }}</AppButton>
        </template>
      </StatusStrip>

      <!-- The shape of the answer (Ф-13): the total with «≈» in the other currency where the person
           has two, a caption and three accounts with a line under a foreign balance. -->
      <ScreenSkeleton v-if="phase === 'loading'">
        <SkeletonPart kind="figure" plate :approx="twoCurrencies" />
        <SkeletonPart kind="caption" :width="24" />
        <SkeletonPart kind="rows" tail under next />
      </ScreenSkeleton>

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
        <!-- «Добавить счёт» is the strip's, as on a screen with accounts (Ф-16). -->
        <ScreenState
          v-if="live.length === 0"
          kind="empty"
          :icon="IconWallet"
          :title="t('accounts.offer.title')"
          :body="t('accounts.screen.empty.body')"
        />

        <template v-else>
          <!-- The same money in the two currencies of the settings (owner's В-19 «в»): the income one
               large, as «На счетах сейчас» of «Деньги» says it, the spending one under it — the tiles
               too (В-1 «б»). Every figure is the server's. -->
          <AppCard v-if="main" class="total">
            <SectionCaption as="p" inset>{{ t('accounts.total') }}</SectionCaption>
            <p class="figure" :class="{ negative: main.total.minor < 0n }">
              ≈ {{ estimate(main.total) }}
            </p>
            <p v-if="second" class="figure-second" :class="{ negative: second.total.minor < 0n }">
              ≈ {{ estimate(second.total) }}
            </p>
            <div class="tiles">
              <div class="tile">
                <span class="tile-label">{{ t('accounts.screen.spendable') }}</span>
                <span class="tile-figure" :class="{ negative: main.spendable.minor < 0n }">
                  ≈ {{ estimate(main.spendable) }}
                </span>
                <span
                  v-if="second"
                  class="tile-second"
                  :class="{ negative: second.spendable.minor < 0n }"
                >
                  ≈ {{ estimate(second.spendable) }}
                </span>
              </div>
              <div class="tile">
                <span class="tile-label">{{ t('accounts.savings') }}</span>
                <span class="tile-figure" :class="{ negative: main.savings.minor < 0n }">
                  ≈ {{ estimate(main.savings) }}
                </span>
                <span
                  v-if="second"
                  class="tile-second"
                  :class="{ negative: second.savings.minor < 0n }"
                >
                  ≈ {{ estimate(second.savings) }}
                </span>
              </div>
            </div>
            <p v-if="rateLine" class="footnote">{{ rateLine }}</p>
            <p v-if="main.uncounted > 0" class="footnote">
              {{ t('accounts.screen.uncounted', { n: main.uncounted }, main.uncounted) }}
            </p>
          </AppCard>

          <!-- A transfer between one's own accounts, while some currency has two (MOL-253). -->
          <AppCard v-if="transferable" as="ul" list>
            <li>
              <NavRow
                :icon="IconTransfer"
                :label="t('accounts.screen.transfer')"
                aria-haspopup="dialog"
                @click="transferOpen = true"
              />
            </li>
          </AppCard>

          <!-- What went into no balance, under the total it is missing from — moved here from the
               card «Деньги» had over the month (MOL-159, handoff MOL-157 07). -->
          <AppCard v-if="overview.unassigned > 0" list>
            <button type="button" class="unassigned" @click="unassignedOpen = true">
              <IconInfo class="unassigned-icon" aria-hidden="true" />
              <span class="unassigned-text">
                {{ t('accounts.unassigned', { n: overview.unassigned }, overview.unassigned) }}
              </span>
              <IconChevron class="unassigned-chevron" aria-hidden="true" />
            </button>
          </AppCard>

          <!-- An account is a row of the kit (Ф-12): its currency and the last thing that happened to
               it, the balance, and beside a foreign one the balance in the spending currency. No rate:
               the price of money is its currency's (MOL-43, Р-2). -->
          <AppReveal group>
            <section v-for="group in groups" :key="group.key" class="group">
              <SectionCaption>{{ group.title }}</SectionCaption>
              <AppCard as="ul" list>
                <AppReveal group>
                  <li v-for="account in group.accounts" :key="account.id">
                    <ListRow
                      as="router-link"
                      :to="{ name: 'money-account', params: { accountId: account.id } }"
                      :title="account.name"
                      :meta="liveLine(account)"
                      next
                    >
                      <template #tail>
                        <span class="money">
                          <span :class="{ negative: account.balance.minor < 0n }">
                            {{ signed(account.balance) }}
                          </span>
                          <span v-if="account.inSpend" class="approx">
                            ≈ {{ estimate(account.inSpend) }}
                          </span>
                        </span>
                      </template>
                    </ListRow>
                  </li>
                </AppReveal>
              </AppCard>
            </section>
          </AppReveal>
        </template>

        <AppCard v-if="removedAccounts.length > 0" class="removed" list>
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
            <IconDown class="removed-turn" :class="{ up: showRemoved }" aria-hidden="true" />
          </button>
          <AppReveal>
            <div v-if="showRemoved">
              <ul class="removed-list">
                <AppReveal group>
                  <!-- Two targets (handoff 01 п. 6): the account's screen, and «Вернуть». Without a
                       connection «Вернуть» is not now, and says why on itself (Ф-6, С-10); nor while
                       another «Вернуть» of the screen is in the air — each answers with the page whole,
                       and the later to land would take the other back (MOL-189). -->
                  <li v-for="account in removedAccounts" :key="account.id" class="removed-row">
                    <ListRow
                      as="router-link"
                      class="removed-open"
                      :to="{ name: 'money-account', params: { accountId: account.id } }"
                      :title="account.name"
                      :meta="removedLine(account)"
                      next
                    />
                    <AppButton
                      variant="tinted"
                      class="removed-restore"
                      :inactive="
                        (!online || undoing || restoring !== null) && restoring !== account.id
                      "
                      :busy="restoring === account.id"
                      :busy-label="t('accounts.screen.restoring')"
                      @click="bringBack(account)"
                    >
                      <template #icon><IconUndo /></template>
                      {{
                        online ? t('accounts.screen.restore') : t('accounts.screen.restore_wait')
                      }}
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

    <!-- «Вернуть» over the strip, which stays under it (Ф-29): one look for every removal of «Деньги»
         (MOL-189) — at work with its word, not now without a connection. -->
    <template v-if="store.removed" #undo>
      <UndoStrip
        :key="store.removed.stamp"
        :text="t('accounts.screen.removed', { name: store.removed.name })"
        :announcement="t('accounts.screen.removed_announced', { name: store.removed.name })"
        :action="t('accounts.screen.restore')"
        :busy="undoing"
        :busy-label="t('accounts.screen.restoring')"
        :inactive="restoring !== null"
        :waiting="!online && !undoing"
        :waiting-action="t('accounts.screen.restore_wait')"
        @restore="undoRemoval"
        @expire="store.removed = null"
      />
    </template>
    <!-- Over an answer only (Р-1, MOL-191 В-2): with no list the strip went from under a sheet it had
         opened. Offline it opens the sheet, which says it waits for the connection (handoff 04, 4f). -->
    <template v-if="phase === 'ready'" #docked>
      <AppButton ref="addButton" size="large" block @click="compose">
        <template #icon><IconPlus /></template>
        {{ t('accounts.screen.add') }}
      </AppButton>
    </template>

    <AccountSheet
      v-model:open="sheetOpen"
      :spend-currency="spendCurrency"
      :online="online"
      @done="done"
    />
    <UnassignedSheet v-model:open="unassignedOpen" :online="online" />
    <TransferSheet
      v-model:open="transferOpen"
      :online="online"
      :spend-currency="spendCurrency"
      @done="transferDone"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import IconArchive from '~icons/mdi/archive-outline'
import IconChevron from '~icons/mdi/chevron-right'
import IconDown from '~icons/mdi/chevron-down'
import IconInfo from '~icons/mdi/information-outline'
import IconPlus from '~icons/mdi/plus'
import IconTransfer from '~icons/mdi/bank-transfer'
import IconUndo from '~icons/mdi/undo-variant'
import IconWallet from '~icons/mdi/wallet-outline'
import type { Currency, ExchangeRate, Money, MoneyAccountView } from '@molvia/model'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import { api } from '@/api'
import AccountSheet from '@/components/AccountSheet.vue'
import type { AccountOutcome } from '@/components/AccountSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import ListRow from '@/components/ListRow.vue'
import NavRow from '@/components/NavRow.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import TransferSheet from '@/components/TransferSheet.vue'
import UnassignedSheet from '@/components/UnassignedSheet.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import {
  canTransfer,
  countedWhen,
  pageOrder,
  removedOf,
  shortDay,
  signedAmount,
} from '@/components/accounts'
import { bankWords, rateWords } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useOnline } from '@/composables/useOnline'
import { useReconnect } from '@/composables/useReconnect'
import { useTransferOutcome } from '@/composables/useTransferOutcome'
import { useAccountsOnScreen, useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'

/** The order the rate line names the currencies in (handoff 02). */
const RATE_ORDER: readonly Currency[] = ['RUB', 'USD', 'EUR', 'GEL', 'RSD', 'AMD']

/**
 * «Счета» (MOL-123, handoff 02): where the money lies — the totals in the spending currency, the
 * accounts for spending and the savings, and the ones taken out of the choice. Every figure is the
 * server's, always «≈» in the totals: a sum by rates is not money in hand. Offline it is the last
 * answer with its age; an account is written with a connection only.
 */
export default defineComponent({
  name: 'AccountsView',
  components: {
    AccountSheet,
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    ListRow,
    NavRow,
    IconArchive,
    IconChevron,
    IconDown,
    IconInfo,
    IconPlus,
    IconUndo,
    ScreenSkeleton,
    ScreenState,
    SectionCaption,
    SkeletonPart,
    StatusStrip,
    TransferSheet,
    UnassignedSheet,
    UndoStrip,
  },
  setup() {
    const { t, locale } = useI18n()
    const store = useAccountsStore()
    useAccountsOnScreen()
    const actor = useActorStore()
    const announce = useAnnouncer()

    const online = useOnline()
    // «Перевод между счетами» stands only where some currency has two live accounts (MOL-253).
    const transferable = computed(() => canTransfer(store.accounts))
    const transferOpen = ref(false)
    const { done: transferDone } = useTransferOutcome()
    onMounted(() => void store.refresh())
    onUnmounted(() => {
      // The strip is this screen's offer: left, it is not made again on a later visit (review 18).
      store.removed = null
    })
    useReconnect(() => void store.refresh())

    const unassignedOpen = ref(false)
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
    const signed = (value: Money) => signedAmount(value, locale.value)

    /**
     * The large figures in the income currency and the line under them in the spending one (В-19 «в»,
     * В-1 «б»). One currency, or a page kept on the phone from before `incomeTotals` — one figure.
     * **And one where either left an account out** (self-review Р1-1): with no rate between the two,
     * each currency's own accounts are in its own figure alone, so the two lines spoke of two sets of
     * accounts — even at one count apiece; the note under the figure says what it misses.
     */
    const main = computed(() => {
      const page = overview.value
      if (!page) return null
      const income = page.incomeTotals
      return income && income.currency !== page.spendCurrency ? income : page.totals
    })
    const second = computed(() => {
      const page = overview.value
      if (!page || !main.value || main.value === page.totals) return null
      return main.value.uncounted === 0 && page.totals.uncounted === 0 ? page.totals : null
    })
    /**
     * The skeleton's «≈» line by the person's two currencies, as the settings name them; with none
     * known, two — the usual case. A page kept would be drawn, not the skeleton.
     */
    const twoCurrencies = computed(() => {
      const settings = actor.settings
      return settings ? settings.incomeCurrency !== settings.spendCurrency : true
    })

    /**
     * A date of a row is one word, «20 окт.» (self-review Р1-5): beside the balance at 320 it broke
     * between its day and month. Only the date — the whole «старт 20 окт.» held as one, a narrow column
     * broke it inside a word, «окт» over «.» (adversarial Б1).
     */
    const whole = (text: string) => text.replaceAll(' ', '\u00a0')
    const day = (date: string) => whole(shortDay(date, locale.value))

    function liveLine(account: MoneyAccountView): string {
      const { currency, lastCheckedOn, startOn } = account
      return lastCheckedOn
        ? t('accounts.screen.row_checked', { currency, date: day(lastCheckedOn) })
        : t('accounts.screen.row_started', { currency, date: day(startOn) })
    }
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
      // A fallback's publisher is not in the rate: «по курсу дня», never a bank it did not come from
      // (MOL-110, review 1).
      const fallback = ordered.some((rate) => rate.source === 'fallback')
      if (sources.size > 1 || fallback) return t('accounts.screen.rate_mixed', { rates: words })
      if (sources.has(true)) return t('accounts.screen.rate', { rates: words })
      // Each bank once, in the order of the rates (MOL-110): «ЦБ РА и НБ Грузии».
      const banks = [...new Set(ordered.map((rate) => bankWords(rate.base, rate.quote, t)))]
      return t('accounts.screen.rate_official', {
        rates: words,
        bank: banks.join(t('accounts.screen.rate_banks_and')),
      })
    })

    const showRemoved = ref(false)
    function removedLine(account: MoneyAccountView): string {
      return t('accounts.screen.archived_row', {
        currency: account.currency,
        amount: signedAmount(account.balance, locale.value),
        date: account.archivedAt
          ? whole(
              new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short' }).format(
                account.archivedAt,
              ),
            )
          : day(account.startOn),
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
    const undoing = ref(false)
    async function undoRemoval(): Promise<void> {
      const removal = store.removed
      if (!removal || undoing.value) return
      undoing.value = true
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
      } finally {
        undoing.value = false
      }
      await nextTick()
      ;(addButton.value?.$el as HTMLElement | undefined)?.focus()
    }

    return {
      IconTransfer,
      transferable,
      transferOpen,
      transferDone,
      unassignedOpen,
      t,
      IconWallet,
      store,
      online,
      phase,
      failed: computed(() => store.failed),
      overview,
      live,
      removedAccounts,
      spendCurrency,
      groups,
      estimate,
      signed,
      main,
      second,
      twoCurrencies,
      liveLine,
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
      undoing,
      undoRemoval,
    }
  },
})
</script>

<style scoped lang="scss">
/* The page's gutter is the frame's (Р-8): within a group 8, between groups 24 (Ф-10). */
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-2);
}

.total {
  container: total / inline-size;
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
}

.figure {
  @include display-type;

  margin: 0;
  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
}

/* «≈» of «Деньги» (`MoneyMonthCard`); both at the leading the skeleton's figure stands at (MOL-178). */
.figure-second {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
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

/* Two figures a tile (В-1 «б») do not fit half of a card of 320: the tiles stand one under the other
   there, every figure whole on its line. */
@container total (width < 20rem) {
  .tiles {
    grid-template-columns: minmax(0, 1fr);
  }
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
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.tile-second {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.unassigned {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--touch-target-lg);
  padding: 0 var(--space-3) 0 var(--space-4);
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--text-callout);
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.unassigned-text {
  flex: 1;
}

.unassigned-icon {
  @include icon;

  font-size: var(--icon-md);
}

.unassigned-chevron {
  @include icon;

  font-size: var(--icon);
}

.group,
.removed {
  margin-top: var(--space-4);
}

.money {
  display: grid;
  justify-items: end;
  white-space: nowrap;
}

.approx {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-regular);
}

.removed {
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
  @include icon;

  font-size: var(--icon-md);
}

/* One chevron turned rather than two swapped: it is seen to open the list (MOL-151). */
.removed-turn {
  @include icon;

  font-size: var(--icon);
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

/* The link and «Вернуть» side by side where both fit whole, else the button under the name, at the
   right: it keeps the width of «Возвращаем…» too (MOL-225), and shrunk beside it the name was cut. On a
   line of its own it shrinks to the row, from where the name begins, and wraps its words: «Вернём, когда
   будет связь» at 320 stood past the row's padding, 2 px from the card's edge, which cuts (adversarial
   А4). */
.removed-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--space-2);
  padding-right: var(--space-3);

  & + & {
    border-top: var(--hairline) solid var(--border);
  }
}

.removed-open {
  flex: 1 1 12rem;
  min-width: 0;

  :deep(.title) {
    color: var(--text-muted);
  }
}

.removed-restore {
  flex: 0 1 auto;
  max-width: calc(100% - var(--space-4));
  margin-block: var(--space-2);
  margin-inline-start: auto;
}

.removed-note {
  padding: 0 var(--space-4) var(--space-3);
}

/* The answer comes in where the skeleton stood, faded only: the screen keeps it in one block of its
   own, which `AppScreen` does not see, and nothing under the thumb may move (review №5, MOL-138). */
.content > * {
  @include appear(0);
}
</style>
