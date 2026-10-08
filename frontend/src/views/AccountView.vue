<template>
  <AppScreen :title="account?.name ?? ''">
    <template v-if="account && phase !== 'missing'" #trailing>
      <AppButton variant="ghost" @click="editOpen = true">{{
        t('accounts.account.edit')
      }}</AppButton>
    </template>
    <template v-if="account" #subtitle>{{ subtitle }}</template>

    <div class="content" :class="{ roomy: phase === 'ready' }">
      <p v-if="phase === 'ready' && stale === 'offline'" class="strip">
        <IconCloudOff class="strip-icon" aria-hidden="true" />
        {{ countedAt ? t('accounts.stale', { time: countedAt }) : t('spending.offline.title') }}
      </p>
      <ScreenState
        v-else-if="phase === 'ready' && stale === 'error'"
        kind="error"
        inline
        :title="t('accounts.account.error.title')"
        :body="t('accounts.error_body')"
        @retry="retry"
      />

      <ScreenSkeleton v-if="phase === 'loading'" :groups="[40, 70, 60, 24, 80, 64, 72]" />

      <ScreenState
        v-else-if="phase === 'missing'"
        kind="attention"
        :title="t('accounts.account.not_found')"
      >
        <template #action>
          <AppButton size="large" block @click="toList">
            {{ t('accounts.account.to_list') }}
          </AppButton>
        </template>
      </ScreenState>

      <ScreenState
        v-else-if="phase === 'error'"
        kind="error"
        :title="t('accounts.account.error.title')"
        :body="t('accounts.error_body')"
        @retry="retry"
      />

      <ScreenState
        v-else-if="phase === 'offline'"
        kind="offline"
        tone="warn"
        :title="t('spending.offline.title')"
        :body="t('accounts.screen.offline_empty')"
      />

      <template v-else-if="journal && account">
        <AppCard class="balance">
          <SectionCaption as="p" inset>{{ t('accounts.balance') }}</SectionCaption>
          <p class="figure" :class="{ negative: account.balance.minor < 0n }" aria-live="polite">
            {{ money(account.balance) }}
          </p>
          <p v-if="account.inSpend" class="approx">
            {{ t('accounts.account.approx', { amount: `≈ ${estimate(account.inSpend)}` }) }}
          </p>
          <p class="footnote">{{ startLine }}</p>
        </AppCard>

        <p v-if="account.archivedAt" class="archived">
          <IconArchive class="strip-icon" aria-hidden="true" />{{ archivedLine }}
        </p>

        <section class="operations">
          <SectionCaption class="group-caption">{{
            t('accounts.account.operations')
          }}</SectionCaption>
          <div class="days">
            <AppCard v-if="journal.rows.length === 0" class="empty">
              <p class="empty-title">{{ t('accounts.no_operations') }}</p>
              <p class="footnote">{{ t('accounts.account.empty.body') }}</p>
            </AppCard>
            <AppReveal group>
              <section v-for="day in days" :key="day.day" class="day">
                <h3 class="day-head">{{ dayTitle(day.day) }}</h3>
                <AppCard as="ul" list>
                  <AppReveal group>
                    <OperationRow
                      v-for="row in day.rows"
                      :key="`${row.id}-${row.side ?? ''}`"
                      v-bind="rowOf(row)"
                      @open="openRow(row)"
                    />
                  </AppReveal>
                </AppCard>
              </section>
            </AppReveal>
          </div>
        </section>
        <div v-if="journal.cursor" ref="sentinel" class="more">
          <p v-if="more === 'loading'" class="footnote">{{ t('state.loading') }}</p>
          <AppButton v-else-if="more === 'failed'" variant="ghost" @click="loadMore">
            {{ t('spending.more_retry') }}
          </AppButton>
        </div>
      </template>
    </div>

    <template v-if="removed || transferRemoved" #undo>
      <UndoStrip
        v-if="removed"
        :key="removed.stamp"
        :text="t('spending.removed', removed)"
        :announcement="t('spending.removed_announced', removed)"
        :action="t('spending.restore')"
        @restore="restoreSpending"
        @expire="removed = null"
      />
      <!-- A transfer and its fee, both rows gone at once and back at once (MOL-253). -->
      <UndoStrip
        v-else-if="transferRemoved"
        :key="transferRemoved.stamp"
        :text="t('transfer.removed')"
        :announcement="t('transfer.removed_announced')"
        :action="t('spending.restore')"
        @restore="restoreTransfer"
        @expire="transferRemoved = null"
      />
    </template>
    <!-- Not under «Вернуть», as on «Счета», until its actions go into the docked strip (MOL-194). -->
    <FloatingDock v-if="!removed && !transferRemoved && phase === 'ready' && account" class="float">
      <AppButton
        v-if="account?.archivedAt"
        size="large"
        :disabled="!online && !restoring"
        :busy="restoring"
        :busy-label="t('accounts.screen.restoring')"
        @click="bringBack"
      >
        <template #icon><IconUndo /></template>
        {{ t('accounts.screen.restore') }}
      </AppButton>
      <template v-else>
        <AppButton size="large" @click="reconcileOpen = true">
          <template #icon><IconScale /></template>
          {{ t('accounts.account.reconcile') }}
        </AppButton>
        <!-- The second action under the first: one main action a screen (Ф-15, Р-9). Floating over
             the cards it needs a fill, so not the ghost of the docked strip until MOL-194. -->
        <AppButton
          v-if="transferable"
          variant="secondary"
          aria-haspopup="dialog"
          @click="transferOpen = true"
        >
          <template #icon><IconTransfer /></template>
          {{ t('accounts.account.transfer') }}
        </AppButton>
      </template>
    </FloatingDock>

    <AccountSheet
      v-model:open="editOpen"
      :account="account"
      :spend-currency="account?.currency ?? 'AMD'"
      :online="online"
      @done="edited"
    />
    <ReconcileSheet
      v-if="account"
      v-model:open="reconcileOpen"
      :account="account"
      :online="online"
      :categories="categories"
      :name-of="nameOf"
      :account-name="accountName"
    />
    <OperationSheet
      v-model:open="operationOpen"
      :operation="operation"
      :online="online"
      @removed="onRemoved"
      @transfer="transferEnded"
    />
    <TransferSheet
      v-if="account"
      v-model:open="transferOpen"
      :from="account.id"
      :online="online"
      :spend-currency="account.currency"
      @done="transferEnded"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import IconArchive from '~icons/mdi/archive-outline'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconScale from '~icons/mdi/scale-balance'
import IconTransfer from '~icons/mdi/bank-transfer'
import IconUndo from '~icons/mdi/undo-variant'
import type { AccountOperationView, Money } from '@molvia/model'
import { api } from '@/api'
import AccountSheet from '@/components/AccountSheet.vue'
import type { AccountOutcome } from '@/components/AccountSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import FloatingDock from '@/components/FloatingDock.vue'
import OperationRow from '@/components/OperationRow.vue'
import OperationSheet from '@/components/OperationSheet.vue'
import ReconcileSheet from '@/components/ReconcileSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import TransferSheet from '@/components/TransferSheet.vue'
import type { TransferOutcome } from '@/components/TransferSheet.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import {
  canTransfer,
  countedWhen,
  operationRowProps,
  shortDay,
  signedAmount,
} from '@/components/accounts'
import type { Removed } from '@/components/spending'
import { useAccountJournal } from '@/composables/useAccountJournal'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useLocalDay } from '@/composables/useLocalDay'
import { useOwnCategories } from '@/composables/useOwnCategories'
import { useReconnect } from '@/composables/useReconnect'
import { useTransferOutcome } from '@/composables/useTransferOutcome'
import { calendarDay, shiftDay } from '@/days'
import { useNavigation } from '@/navigation'
import { useAccountsOnScreen, useAccountsStore } from '@/stores/accounts'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'

/**
 * One account (MOL-123, handoff 04): what it holds — the server's count, «≈» where a rate counted
 * something — its start and last check, and every operation on it by day, newest first, a page at a
 * time. A row opens its own sheet, where the account is changed too. «Сверить с фактом» floats
 * under the thumb; on an account taken out of the choice, «Вернуть» stands there instead (В-2).
 */
export default defineComponent({
  name: 'AccountView',
  components: {
    AccountSheet,
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    FloatingDock,
    IconArchive,
    IconCloudOff,
    IconScale,
    IconTransfer,
    IconUndo,
    OperationRow,
    OperationSheet,
    ReconcileSheet,
    ScreenSkeleton,
    ScreenState,
    SectionCaption,
    TransferSheet,
    UndoStrip,
  },
  setup() {
    const { t, locale } = useI18n()
    const route = useRoute()
    const store = useAccountsStore()
    useAccountsOnScreen()
    const trips = useTripQueueStore()
    const { goUp } = useNavigation()
    const queue = useSpendingQueueStore()
    const announce = useAnnouncer()
    const { categories, nameOf } = useOwnCategories()

    const accountId = computed(() => String(route.params.accountId ?? ''))
    const { phase, journal, stale, more, loadMore, retry } = useAccountJournal(accountId)

    const online = ref(navigator.onLine)
    const onLine = () => (online.value = true)
    const offLine = () => (online.value = false)
    onMounted(() => {
      window.addEventListener('online', onLine)
      window.addEventListener('offline', offLine)
      // Always asked: a page kept from an earlier launch is no answer, and its balance stood over a
      // fresh journal with nothing to say it was old (adversarial А).
      void store.refresh()
    })
    onUnmounted(() => {
      window.removeEventListener('online', onLine)
      window.removeEventListener('offline', offLine)
    })

    /** The page's account where it is newer — a write answers with the page, not the journal. */
    useReconnect(() => void store.refresh())

    /**
     * The account as the newer answer has it: the page once it answered in this session — a write
     * answers with the page, not the journal — else the journal once it answered, else whichever
     * the phone kept (adversarial А).
     */
    const account = computed(() => {
      const fromPage = store.accounts.find(({ id }) => id === accountId.value) ?? null
      const fromJournal = journal.value?.account ?? null
      if (fromPage && store.stale === null) return fromPage
      if (fromJournal && stale.value === null) return fromJournal
      return fromPage ?? fromJournal
    })
    const accountName = (id: string) => store.accounts.find((one) => one.id === id)?.name ?? null
    const rowOf = (row: AccountOperationView) =>
      operationRowProps(row, {
        t,
        locale: locale.value,
        categories: categories.value,
        nameOf,
        accountName,
        inAccount: true,
      })

    const money = (value: Money) => signedAmount(value, locale.value)
    const estimate = (value: Money) => signedAmount(value, locale.value, { estimate: true })
    const countedAt = computed(() =>
      store.overview ? countedWhen(store.overview.countedAt, locale.value) : null,
    )

    const subtitle = computed(() => {
      const value = account.value
      if (!value) return ''
      return t(value.savings ? 'accounts.currency_savings' : 'accounts.currency_spending', {
        currency: value.currency,
      })
    })
    const startLine = computed(() => {
      const value = account.value
      if (!value) return ''
      const started = t('accounts.account.started', {
        amount: money(value.start),
        date: shortDay(value.startOn, locale.value),
      })
      return value.lastCheckedOn
        ? `${started} · ${t('accounts.account.checked', { date: shortDay(value.lastCheckedOn, locale.value) })}`
        : started
    })
    const archivedLine = computed(() => {
      const at = account.value?.archivedAt
      if (!at) return ''
      const date = new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short' }).format(
        at,
      )
      return t('accounts.account.archived', { date })
    })

    /** Rows by day, as the server ordered them: newest first, and within a day newest first. */
    const days = computed(() => {
      const list: { day: string; rows: AccountOperationView[] }[] = []
      for (const row of journal.value?.rows ?? []) {
        // A trip whose removal waits in the queue is shown nowhere (MOL-76, review 25).
        if (row.kind === 'trip' && trips.removing.has(row.id)) continue
        const last = list.at(-1)
        if (last?.day === row.day) last.rows.push(row)
        else list.push({ day: row.day, rows: [row] })
      }
      return list
    })

    // The phone's today, asked again when the app comes back into view (MOL-121, adversarial Н).
    const today = useLocalDay()
    function dayTitle(day: string): string {
      const date = calendarDay(day, locale.value)
      if (day === today.value) return t('spending.day_today', { date })
      if (day === shiftDay(today.value, -1)) return t('spending.day_yesterday', { date })
      const text = calendarDay(day, locale.value, {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
      })
      return text.charAt(0).toLocaleUpperCase(locale.value) + text.slice(1)
    }

    // The next page as the end of the journal comes into view, as the month's (MOL-82).
    const sentinel = ref<HTMLElement | null>(null)
    let observer: IntersectionObserver | null = null
    watch(sentinel, (element) => {
      observer?.disconnect()
      if (!element || typeof IntersectionObserver === 'undefined') return
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting) && more.value === 'idle') void loadMore()
      })
      observer.observe(element)
    })
    onUnmounted(() => observer?.disconnect())

    const editOpen = ref(false)
    const reconcileOpen = ref(false)
    const operationOpen = ref(false)
    const operation = ref<AccountOperationView | null>(null)
    function openRow(row: AccountOperationView): void {
      operation.value = row
      operationOpen.value = true
    }

    function edited(outcome: AccountOutcome): void {
      if (outcome.kind === 'saved') {
        announce?.(t('accounts.sheet.saved'))
        return
      }
      if (outcome.kind === 'deleted')
        store.removed = { id: outcome.id, name: outcome.name, stamp: Date.now() }
      else announce?.(t('accounts.screen.archived_done', { name: outcome.name }))
      // «Удалить» and «Убрать» from the account's own screen lead to the page (handoff 03), where
      // «Вернуть» stands — a step back where «Счета» lies under it, not a second one in the history
      // (review 19), and a replace onto it where «Деньги» does: opened from a line of the card, the
      // step went to «Деньги», with nothing there to bring the account back (review 32).
      // A task later: stepped inside the pop that closed the sheet, the step was swallowed.
      window.setTimeout(() => void goUp())
    }

    const restoring = ref(false)
    async function bringBack(): Promise<void> {
      const value = account.value
      if (!value) return
      restoring.value = true
      try {
        store.accept(await api.restoreMoneyAccount(value.id))
        announce?.(t('accounts.screen.restored', { name: value.name }))
      } catch {
        announce?.(t('accounts.sheet.failed'))
      } finally {
        restoring.value = false
      }
    }

    const removed = ref<(Removed & { stamp: number }) | null>(null)
    function onRemoved(value: Removed): void {
      // One «Вернуть» at a time: the newer removal's strip takes the place of the older (С-6).
      transferRemoved.value = null
      removed.value = { ...value, stamp: Date.now() }
    }
    function restoreSpending(): void {
      const value = removed.value
      if (!value) return
      queue.restore(value.undo)
      removed.value = null
      announce?.(t('spending.restored'))
    }

    function toList(): void {
      void goUp()
    }

    // «Перевести» stands only where there is somewhere to transfer to (MOL-253, handoff 01).
    const transferable = computed(() => {
      const value = account.value
      return !!value && value.archivedAt === null && canTransfer(store.accounts, value.currency)
    })
    const transferOpen = ref(false)
    const {
      removed: transferRemoved,
      done: transferDone,
      restore: restoreTransfer,
    } = useTransferOutcome()
    function transferEnded(outcome: TransferOutcome): void {
      if (outcome.kind === 'removed') removed.value = null
      transferDone(outcome)
    }

    return {
      transferable,
      transferOpen,
      transferRemoved,
      transferEnded,
      restoreTransfer,
      t,
      phase,
      journal,
      stale,
      more,
      loadMore,
      retry,
      online,
      account,
      accountName,
      categories,
      nameOf,
      money,
      estimate,
      countedAt,
      subtitle,
      startLine,
      archivedLine,
      days,
      dayTitle,
      sentinel,
      editOpen,
      reconcileOpen,
      operationOpen,
      operation,
      openRow,
      rowOf,
      edited,
      restoring,
      bringBack,
      removed,
      onRemoved,
      restoreSpending,
      toList,
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

.strip,
.archived {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  font-size: var(--text-footnote);
}

.strip {
  @include appear;

  background: var(--warn-tint);
  color: var(--warn-ink);
}

.archived {
  background: var(--surface-2);
  color: var(--text-muted);
}

.strip-icon {
  @include icon;

  font-size: var(--icon-sm);
}

.balance {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
}

.group-caption {
  margin-top: var(--space-3);
}

/* The caption and the days in a block of their own: in the content's gap the 8 under it would be 20. */
.days {
  display: grid;
  gap: var(--space-3);
}

.figure {
  @include display-type;

  margin: 0;
  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;

  &.negative {
    color: var(--bad-ink);
  }
}

.approx {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}

.footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.empty {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
}

.empty-title {
  margin: 0;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.day {
  display: grid;
  gap: var(--space-2);
}

.day-head {
  margin: 0;
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.more {
  display: grid;
  justify-items: center;
  min-height: var(--touch-target);
}
</style>
