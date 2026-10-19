<template>
  <AppScreen :title="t('income.title')">
    <template v-if="overview && phase !== 'loading'">
      <!-- The connection in one line, with the time of the answer shown (MOL-181, Ф-14). Nothing is
           kept on the phone, but an app stays open for days: «на 14:05» of yesterday would be untrue.
           What waits for the connection — «Записать доход» — says so on itself (Р-1). -->
      <StatusStrip
        v-if="!online && fetchedAt"
        class="status"
        kind="offline"
        :text="t('income.offline.strip', { when: whenOf(fetchedAt) })"
      />
      <!-- The list read again after a write's answer — a conflict, a vanished income, a late
           «Вернуть» — did not come: what is shown may no longer be what the server holds. The strip
           over the tab bar holds «Записать доход», so «Повторить» is here (К-5). -->
      <StatusStrip
        v-else-if="stale && fetchedAt"
        class="status"
        kind="unanswered"
        :text="t('income.error_strip', { when: whenOf(fetchedAt) })"
        :attempt="attempt"
      >
        <template #action>
          <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
        </template>
      </StatusStrip>
      <p v-if="failed" class="notice failed" role="alert">{{ t('income.failed') }}</p>
      <!-- Read again and not answered — the server silent or the connection gone (MOL-187, Б1) — the
           list is the one from before the write: «показываем, как он записан» over it would be
           untrue. -->
      <p v-if="conflicted" class="notice" role="alert">
        {{ behind ? t('income.conflict_stale') : t('income.conflict') }}
      </p>
      <p v-if="amendConflicted" class="notice" role="alert">
        {{ behind ? t('income.amend_conflict_stale') : t('income.amend_conflict') }}
      </p>
      <p v-if="vanished" class="notice" role="alert">
        {{ behind ? t('income.vanished_stale') : t('income.vanished') }}
      </p>
      <p v-if="gone" class="notice" role="alert">{{ t('income.restore_gone') }}</p>
    </template>

    <!-- The shape of what is coming, in the order it will stand (Ф-13): a month and two cards, then a
         month and a card — their plates by the account a new income lands on (`skeletonPlates`). -->
    <ScreenSkeleton v-if="phase === 'loading'">
      <SkeletonPart kind="caption" :width="22" />
      <OperationSkeleton form="income" :plates="skeletonPlates[0]" />
      <SkeletonPart kind="caption" :width="18" />
      <OperationSkeleton form="income" :plates="skeletonPlates[1]" />
    </ScreenSkeleton>

    <template v-else-if="phase !== 'idle'">
      <ScreenState
        v-if="phase === 'error'"
        kind="error"
        :title="t('income.load_error.title')"
        :body="t('income.load_error.body')"
        @retry="retry"
      />

      <!-- No button: nothing is kept on the phone, and the screen loads by itself when the
           connection is back. -->
      <ScreenState
        v-else-if="phase === 'offline'"
        kind="offline"
        tone="warn"
        :title="t('income.offline.title')"
        :body="t('income.offline.body')"
      />

      <!-- Nothing is required of anyone: incomes are optional, and trips and ratings work
           without them (MOL-41). «Записать доход» is the strip's, as on a screen with incomes
           (Ф-16). -->
      <ScreenState
        v-else-if="phase === 'empty'"
        kind="empty"
        :icon="IconCashPlus"
        :title="t('income.empty.title')"
        :body="t('income.empty.body')"
      />

      <template v-else-if="overview">
        <!-- A month and what came in, per currency and never converted (В-2): the sums are the
             server's. -->
        <AppReveal group>
          <section v-for="month in overview.months" :key="month.month" class="month">
            <SectionCaption class="month-head"
              >{{ monthOf(month.month) }}<template #tail>{{ sumsOf(month.sums) }}</template>
            </SectionCaption>
            <ul class="cards">
              <AppReveal group>
                <li v-for="income in month.incomes" :key="income.id">
                  <IncomeCard :income="income" :today="shownToday()" @edit="edit" />
                </li>
              </AppReveal>
            </ul>
          </section>
        </AppReveal>
      </template>
    </template>

    <!-- «Записать доход» stands in the strip over the tab bar, never over the last card (Ф-28):
         with incomes and on the empty screen alike, not while there is no answer yet. Without a
         connection it stays, not now, and says why on itself (Ф-6, Р-1). -->
    <!-- «Вернуть» over the strip, ten seconds, one look for every operation of «Деньги» (MOL-189,
         Ф-29). Whatever the screen became under it: removing the last income leaves the empty state
         (В-5). The strip puts the focus on «Вернуть» and says the removal itself. -->
    <template v-if="removed && removed.id !== landing" #undo>
      <UndoStrip
        :key="removed.id"
        :text="t('income.removed', { amount: amountOf(removed) })"
        :announcement="t('income.removed_announced', { amount: amountOf(removed) })"
        :action="t('income.restore')"
        :busy="restoring"
        :busy-label="t('income.restoring')"
        :waiting="!online && !restoring"
        :waiting-action="t('income.restore_offline')"
        :inactive="busy && !restoring"
        @restore="restore"
        @expire="forget"
      />
    </template>

    <template v-if="phase === 'ready' || phase === 'empty'" #docked>
      <AppButton ref="recordButton" size="large" block :inactive="!online || busy" @click="compose">
        <template #icon><IconPlus /></template>
        {{ online ? t('income.record') : t('income.record_offline') }}
      </AppButton>
    </template>

    <IncomeSheet
      v-if="overview"
      v-model:open="sheetOpen"
      :overview="overview"
      :editing="editing"
      :record="record"
      :amend="amend"
      removable
      :busy="busy"
      :behind="behind"
      :stale="stale"
      :attempt="attempt"
      @remove="ask"
      @retry="retry"
      @closed="landed"
    />
    <!-- Over the sheet of the amendment, «‹» back to it (Д-1). -->
    <IncomeRemoveSheet
      v-model:open="removeOpen"
      :income="target"
      :amounts="target ? `${amountOf(target)} · ${lineOf(target)}` : ''"
      :busy="busy"
      :failed="removeFailed"
      @confirm="confirmRemove"
    />
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IncomeView as Row, Money } from '@molvia/model'
import IconCashPlus from '~icons/mdi/cash-plus'
import IconPlus from '~icons/mdi/plus'
import AppButton from '@/components/AppButton.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import IncomeCard from '@/components/IncomeCard.vue'
import IncomeRemoveSheet from '@/components/IncomeRemoveSheet.vue'
import IncomeSheet from '@/components/IncomeSheet.vue'
import OperationSkeleton from '@/components/OperationSkeleton.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import { defaultAccount } from '@/components/accounts'
import { asTyped } from '@/components/spending'
import ScreenState from '@/components/ScreenState.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useIncomes } from '@/composables/useIncomes'
import { useLocalDay } from '@/composables/useLocalDay'
import { answeredAt, calendarDay, monthOf, shownDay } from '@/days'
import { useAccountsStore } from '@/stores/accounts'

/**
 * «Доходы» (MOL-66), under «Деньги» beside «Обмен денег» (MOL-81): the money that came in, by month, each
 * month with what came in per currency. Every figure is the server's. What an income does to the
 * person's own rate is said on «Обмен денег», where the rate is.
 */
export default defineComponent({
  name: 'IncomesView',
  components: {
    AppButton,
    AppReveal,
    AppScreen,
    IconPlus,
    IncomeCard,
    IncomeRemoveSheet,
    IncomeSheet,
    OperationSkeleton,
    ScreenSkeleton,
    ScreenState,
    SectionCaption,
    SkeletonPart,
    StatusStrip,
    UndoStrip,
  },
  setup() {
    const { t, locale } = useI18n()
    const incomes = useIncomes()
    // «Сегодня» of the cards, asked again when the app comes back into view (MOL-121, adversarial Н).
    const today = useLocalDay()
    // The day the captions and the cards speak by, one for both: the later of the screen's and the
    // clock's, as `answeredAt` (adversarial А1, Б1) — past New Year's midnight, drawn again by a
    // write's answer, «December 2026» stood over a card of the 31st that said «Today».
    const shownToday = (): string => shownDay(today.value)
    const sheetOpen = ref(false)
    // The income the sheet amends, or null when it records a new one.
    const editing = ref<Row | null>(null)
    function compose(): void {
      editing.value = null
      sheetOpen.value = true
    }
    function edit(income: Row): void {
      editing.value = income
      sheetOpen.value = true
    }
    // «Удалить доход?» first, then «Вернуть» after (В-5). Asked from the sheet of the amendment and
    // over it (MOL-189, Ф-34), «‹» back to what was typed there.
    const removeOpen = ref(false)
    const target = ref<Row | null>(null)
    function ask(income: Row): void {
      target.value = income
      removeOpen.value = true
    }
    // «Вернуть» goes with its strip once it worked: the focus goes to «Записать доход» (review Т-3).
    const recordButton = ref<{ $el: HTMLElement } | null>(null)
    const announce = useAnnouncer()
    let unsay: (() => void) | undefined
    watch(incomes.restored, async (back) => {
      if (!back) return
      unsay?.()
      unsay = announce?.(t('income.restored'))
      await nextTick()
      recordButton.value?.$el.focus()
    })
    onUnmounted(() => unsay?.())

    // Both sheets stay up until the server answers (MOL-189, adversarial А3, А5): «Удаляем…» is seen,
    // the card is not opened again under it, and a removal that failed leaves what was typed. The
    // strip waits for the sheets to go, or its focus and its words land in a sheet on its way out.
    const removeFailed = ref(false)
    watch(removeOpen, (open) => {
      if (!open) removeFailed.value = false
    })
    // The one being removed: its strip waits for the sheets; one already standing stays.
    const landing = ref<string | null>(null)
    async function confirmRemove(): Promise<void> {
      const income = target.value
      if (!income || incomes.busy.value) return
      removeFailed.value = false
      landing.value = income.id
      await incomes.remove(income)
      if (incomes.removed.value?.id !== income.id) {
        landing.value = null
        removeFailed.value = true
        return
      }
      // Closing the amendment closes the question over it too, in one step of the history: the
      // stack steps over the sheets above the one closed. Each closed on its own would step back twice.
      if (sheetOpen.value && editing.value?.id === income.id) sheetOpen.value = false
      else landing.value = null
    }
    function landed(): void {
      landing.value = null
    }

    const online = ref(navigator.onLine)
    const follow = (): void => {
      online.value = navigator.onLine
    }
    // The names of the accounts on the cards (MOL-123): the page as the server has it now.
    const accounts = useAccountsStore()
    onMounted(() => void accounts.refresh())
    /**
     * The plates of the skeleton's cards, in lines (adversarial Б2): a new income lands untouched on the
     * first account of the income currency (`defaultAccount`), so with one every card has its plate —
     * the account and a note, the account (frame incomes-light); with none, a note and nothing (frame
     * incomes-loading). An account in another currency takes no income untouched (adversarial В1: a card
     * in drams under a salary in roubles). Taken as the skeleton comes and held while it stands (В2):
     * with nothing in memory the accounts may answer before the incomes, and the skeleton would change
     * its shape in one frame (MOL-151); the answer is where the cards take their own.
     */
    const platesNow = (): readonly [readonly number[], readonly number[]] => {
      const currency = accounts.overview?.incomeTotals?.currency
      return currency && defaultAccount(accounts.accounts, currency) ? [[2, 1], [1]] : [[1, 0], [1]]
    }
    const skeletonPlates = ref(platesNow())
    watch(incomes.phase, (phase) => {
      if (phase === 'loading') skeletonPlates.value = platesNow()
    })
    onMounted(() => {
      window.addEventListener('online', follow)
      window.addEventListener('offline', follow)
    })
    onUnmounted(() => {
      window.removeEventListener('online', follow)
      window.removeEventListener('offline', follow)
    })

    // As typed, as everywhere in «Деньги» (owner's decision В-1 of MOL-81).
    const amountOf = (income: Row): string => asTyped(income.amount, locale.value)
    /** «Зарплата · 15 сент.» */
    const lineOf = (income: Row): string =>
      t('income.row_line', {
        source: t(`income.source.${income.source}`),
        // A calendar day of Yerevan, never the moment of its midnight (adversarial Ж).
        date: calendarDay(income.receivedOn, locale.value, { day: 'numeric', month: 'short' }),
      })
    const sumsOf = (sums: readonly Money[]): string =>
      sums.map((sum) => asTyped(sum, locale.value)).join(' · ')
    // «14 окт., 14:05» — the answer's day and time, as «Обмен денег», «Деньги» and «Траты» print it;
    // by the day the screen holds, so a night offline turns «сегодня» into «вчера» (MOL-187, А2).
    const whenOf = (at: Date): string => answeredAt(at, locale.value, today.value)

    return {
      shownToday,
      skeletonPlates,
      t,
      ...incomes,
      sheetOpen,
      editing,
      compose,
      edit,
      removeOpen,
      recordButton,
      target,
      ask,
      confirmRemove,
      removeFailed,
      landing,
      landed,
      online,
      amountOf,
      lineOf,
      sumsOf,
      whenOf,
      // The year only where it is not the phone's (В-2 «а»).
      monthOf: (month: string) => monthOf(month, locale.value, shownToday()),
      IconCashPlus,
    }
  },
})
</script>

<style scoped lang="scss">
// A notice of the last write, never the kit's `.strip` — a class of the screen would land on the root
// of `StatusStrip` too (MOL-187).
.notice {
  @include appear;

  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-footnote);
}

// Strips over the answer stand 16 apart. `margin`, not its bottom alone: a notice is a paragraph, and
// the browser's 1em above it stood on top of the 16 (MOL-187, №2).
.notice,
.status {
  margin: 0 0 var(--space-4);
}

.failed {
  background: var(--bad-tint);
  color: var(--bad-ink);
}

// Months 24 apart, the cards of a month 8 apart and 8 under its caption (Ф-10): the caption's own 8.
.month + .month {
  margin-top: var(--space-6);
}

.cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
