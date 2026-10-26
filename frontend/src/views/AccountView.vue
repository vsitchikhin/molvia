<template>
  <AppScreen :title="title">
    <template v-if="account && phase !== 'missing'" #trailing>
      <AppButton variant="ghost" @click="editOpen = true">{{
        t('accounts.account.edit')
      }}</AppButton>
    </template>
    <template v-if="account && phase !== 'missing'" #subtitle>{{ subtitle }}</template>

    <div class="content">
      <!-- The connection in one line, the screen's words with the hour of the answer shown (MOL-181,
           Ф-14). The strip holds «Сверить с фактом», so «Повторить» is here (К-5). -->
      <StatusStrip
        v-if="phase === 'ready' && stale === 'offline'"
        kind="offline"
        :text="countedAt ? t('accounts.stale', { time: countedAt }) : t('spending.offline.title')"
      />
      <StatusStrip
        v-else-if="phase === 'ready' && stale === 'error'"
        kind="unanswered"
        :text="
          countedAt
            ? t('accounts.screen.unanswered', { time: countedAt })
            : t('accounts.account.unanswered')
        "
        :attempt="failures"
      >
        <template #action>
          <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
        </template>
      </StatusStrip>

      <!-- The shape of the answer (Ф-13): the balance with «≈» where the account kept on the phone is
           in another currency, the caption and a day of rows with the circle. -->
      <ScreenSkeleton v-if="phase === 'loading'">
        <SkeletonPart kind="figure" :approx="!!account?.inSpend" />
        <SkeletonPart kind="caption" :width="24" />
        <SkeletonPart kind="rows" lead="circle" tail next />
      </ScreenSkeleton>

      <!-- «К счетам» is the strip's (handoff 02, 8h): attention is no failure of the screen, so the
           block does not take the strip as an error does — the screen puts it there itself (Р-1). -->
      <ScreenState
        v-else-if="phase === 'missing'"
        kind="attention"
        :title="t('accounts.account.not_found')"
      />

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

        <AppNote v-if="account.archivedAt" :icon="IconArchive">{{ archivedLine }}</AppNote>

        <section class="operations">
          <SectionCaption>{{ t('accounts.account.operations') }}</SectionCaption>
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

    <!-- «Вернуть» over the strip, which stays under it (Ф-29, С-8): on a removed account both, the
         strip saying what it brings back and «Вернуть» of the account under it. -->
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

    <!-- The screen's actions in its strip (Ф-28, owner's В-1 «б»): «Сверить с фактом» the main one and
         «Перевести» a ghost under it (Р-9 MOL-253); on a removed account «Вернуть» in their place
         (В-2 MOL-123). Over an answer only, as on «Счета» (Р-1 MOL-193). -->
    <template v-if="phase === 'missing'" #docked>
      <AppButton size="large" block @click="toList">
        <template #icon><IconList /></template>
        {{ t('accounts.account.to_list') }}
      </AppButton>
    </template>
    <template v-else-if="phase === 'ready' && account" #docked>
      <!-- Without a connection not now, saying why (Ф-6); at work its own word, the connection lost
           meanwhile or not (MOL-225). -->
      <AppButton
        v-if="account.archivedAt"
        size="large"
        block
        :inactive="!online && !restoring"
        :busy="restoring"
        :busy-label="t('accounts.screen.restoring')"
        @click="bringBack"
      >
        <template #icon>
          <IconCloudOff v-if="!online && !restoring" />
          <IconUndo v-else />
        </template>
        {{ online || restoring ? t('accounts.screen.restore') : t('accounts.screen.restore_wait') }}
      </AppButton>
      <template v-else>
        <AppButton ref="reconcileButton" size="large" block @click="reconcileOpen = true">
          <template #icon><IconScale /></template>
          {{ t('accounts.account.reconcile') }}
        </AppButton>
        <AppButton
          v-if="transferable"
          variant="ghost"
          block
          aria-haspopup="dialog"
          @click="transferOpen = true"
        >
          <template #icon><IconTransfer /></template>
          {{ t('accounts.account.transfer') }}
        </AppButton>
      </template>
    </template>

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
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import IconArchive from '~icons/mdi/archive-outline'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconList from '~icons/mdi/format-list-bulleted'
import IconScale from '~icons/mdi/scale-balance'
import IconTransfer from '~icons/mdi/bank-transfer'
import IconUndo from '~icons/mdi/undo-variant'
import type { AccountOperationView, Money } from '@molvia/model'
import { api } from '@/api'
import AccountSheet from '@/components/AccountSheet.vue'
import type { AccountOutcome } from '@/components/AccountSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNote from '@/components/AppNote.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import OperationRow from '@/components/OperationRow.vue'
import OperationSheet from '@/components/OperationSheet.vue'
import ReconcileSheet from '@/components/ReconcileSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip from '@/components/StatusStrip.vue'
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
 * time. A row opens its own sheet, where the account is changed too. «Сверить с фактом» is the
 * strip's, «Перевести» under it; on an account taken out of the choice, «Вернуть» stands there
 * instead (В-2, MOL-194).
 */
export default defineComponent({
  name: 'AccountView',
  components: {
    AccountSheet,
    AppButton,
    AppCard,
    AppNote,
    AppReveal,
    AppScreen,
    IconCloudOff,
    IconList,
    IconScale,
    IconTransfer,
    IconUndo,
    OperationRow,
    OperationSheet,
    ReconcileSheet,
    ScreenSkeleton,
    ScreenState,
    SectionCaption,
    SkeletonPart,
    StatusStrip,
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
    const { phase, journal, stale, more, failures, loadMore, retry } = useAccountJournal(accountId)

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
    // The name the phone knows while the journal is on its way, failed or offline, else «Счёт» (Е-6);
    // never the name of an account the server says is not there (8h).
    const title = computed(() =>
      phase.value === 'missing'
        ? t('accounts.account.title')
        : (account.value?.name ?? t('accounts.account.title')),
    )
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
      // Whole: after «21 сент.» the full stop of the sentence doubled (handoff 03).
      const date = new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'long' }).format(
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
    const reconcileButton = ref<ComponentPublicInstance | null>(null)
    async function bringBack(): Promise<void> {
      const value = account.value
      if (!value) return
      restoring.value = true
      try {
        store.accept(await api.restoreMoneyAccount(value.id))
        announce?.(t('accounts.screen.restored', { name: value.name }))
        // The button pressed is gone with the mark: the focus goes to the action in its place, not to
        // the page (Р-5).
        await nextTick()
        const next = reconcileButton.value?.$el as unknown
        if (next instanceof HTMLElement) next.focus()
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
      IconArchive,
      title,
      failures,
      reconcileButton,
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
/* The page's gutter and the room over the strip are the frame's (MOL-179): 8 within the balance's
   group, 24 to the operations (Ф-10). */
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-2);
}

.balance {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
}

/* The caption and the days in a block of their own, 24 from the card above (Ф-10); a caption's own
   8 is the card's under it. */
.operations {
  margin-top: var(--space-4);
}

/* Days 24 apart (handoff 02 п. 5, Ф-10). */
.days {
  display: grid;
  gap: var(--space-6);
}

.figure {
  @include display-type;

  margin: 0;
  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);

  &.negative {
    color: var(--bad-ink);
  }
}

.approx {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
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
