<template>
  <AppScreen :title="t('income.title')">
    <template v-if="overview && phase !== 'loading'">
      <!-- Above every branch: removing the last income leaves the empty state, and «Вернуть» must
           still be there (В-5). -->
      <p v-if="!online" class="strip">
        <IconCloud aria-hidden="true" />{{ t('income.offline.strip') }}
      </p>
      <p v-if="failed" class="strip failed" role="alert">{{ t('income.failed') }}</p>
      <p v-if="conflicted" class="strip" role="alert">{{ t('income.conflict') }}</p>
      <p v-if="amendConflicted" class="strip" role="alert">{{ t('income.amend_conflict') }}</p>
      <p v-if="vanished" class="strip" role="alert">{{ t('income.vanished') }}</p>
      <p v-if="gone" class="strip" role="alert">{{ t('income.restore_gone') }}</p>
      <div v-if="removed" ref="removedStrip" class="strip removed">
        <span class="removed-text">{{ t('income.removed', { amount: amountOf(removed) }) }}</span>
        <AppButton variant="ghost" :inactive="!online || busy" @click="restore">
          {{ t('income.restore') }}
        </AppButton>
      </div>
    </template>

    <!-- The shape of what is coming: cards of incomes under the month (handoff 03). -->
    <ScreenSkeleton v-if="phase === 'loading'" :groups="[32]">
      <OperationSkeleton :plate="false" />
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
           without them (MOL-41). -->
      <ScreenState
        v-else-if="phase === 'empty'"
        kind="empty"
        tone="accent"
        :icon="IconCashPlus"
        :title="t('income.empty.title')"
        :body="t('income.empty.body')"
      >
        <template #action>
          <AppButton block :inactive="!online" @click="compose">
            {{ t('income.record') }}
          </AppButton>
        </template>
      </ScreenState>

      <template v-else-if="overview">
        <!-- A month and what came in, per currency and never converted (В-2): the sums are the
             server's. -->
        <AppReveal group>
          <section v-for="month in overview.months" :key="month.month" class="month">
            <h2 class="month-head">
              <span class="caption">{{ monthOf(month.month) }}</span>
              <span class="sums">{{ sumsOf(month.sums) }}</span>
            </h2>
            <ul class="cards">
              <AppReveal group>
                <li v-for="income in month.incomes" :key="income.id">
                  <IncomeCard
                    :income="income"
                    :today="today"
                    :disabled="!online || busy"
                    @edit="edit"
                    @remove="ask"
                  />
                </li>
              </AppReveal>
            </ul>
          </section>
        </AppReveal>
      </template>
    </template>

    <!-- «Записать доход» floats where «Трата» does (handoff 03); the empty state keeps its own
         button at the bottom instead. -->
    <FloatingDock v-if="overview && phase === 'ready'">
      <AppButton
        ref="recordButton"
        size="large"
        class="add"
        :aria-label="t('income.record')"
        :inactive="!online || busy"
        @click="compose"
      >
        <template #icon><IconPlus /></template>
        {{ t('income.fab') }}
      </AppButton>
    </FloatingDock>

    <IncomeSheet
      v-if="overview"
      v-model:open="sheetOpen"
      :overview="overview"
      :editing="editing"
      :record="record"
      :amend="amendEditing"
    />
    <IncomeRemoveSheet
      v-model:open="removeOpen"
      :income="target"
      :amounts="target ? `${amountOf(target)} · ${lineOf(target)}` : ''"
      :busy="busy"
      @confirm="confirmRemove"
    />
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IncomeAmendBody, IncomeView as Row, Money } from '@molvia/model'
import IconCashPlus from '~icons/mdi/cash-plus'
import IconCloud from '~icons/mdi/cloud-off-outline'
import IconPlus from '~icons/mdi/plus'
import AppButton from '@/components/AppButton.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import FloatingDock from '@/components/FloatingDock.vue'
import IncomeCard from '@/components/IncomeCard.vue'
import IncomeRemoveSheet from '@/components/IncomeRemoveSheet.vue'
import IncomeSheet from '@/components/IncomeSheet.vue'
import OperationSkeleton from '@/components/OperationSkeleton.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import { asTyped } from '@/components/spending'
import ScreenState from '@/components/ScreenState.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import type { AmendOutcome } from '@/composables/useExchanges'
import { incomesOf, useIncomes } from '@/composables/useIncomes'
import { useLocalDay } from '@/composables/useLocalDay'
import { calendarDay, monthOf } from '@/days'
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
    FloatingDock,
    IconCloud,
    IconPlus,
    IncomeCard,
    IncomeRemoveSheet,
    IncomeSheet,
    OperationSkeleton,
    ScreenSkeleton,
    ScreenState,
  },
  setup() {
    const { t, locale } = useI18n()
    const incomes = useIncomes()
    // «Сегодня» of the cards, asked again when the app comes back into view (MOL-121, adversarial Н).
    const today = useLocalDay()
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
    // A conflict leaves the sheet open over the version the server holds now.
    async function amendEditing(id: string, body: IncomeAmendBody): Promise<AmendOutcome> {
      const outcome = await incomes.amend(id, body)
      if (outcome === 'conflict') {
        editing.value =
          incomesOf(incomes.overview.value).find((row) => row.id === id) ?? editing.value
      }
      return outcome
    }
    const removeOpen = ref(false)
    const target = ref<Row | null>(null)
    function ask(income: Row): void {
      target.value = income
      removeOpen.value = true
    }
    // The bin that opened the sheet is gone with its row: the focus goes to «Вернуть», and the
    // removal is said out loud (MOL-40, review Н-1).
    const removedStrip = ref<HTMLElement | null>(null)
    const announce = useAnnouncer()
    let unsay: (() => void) | undefined
    watch(incomes.removed, async (income) => {
      unsay?.()
      unsay = income ? announce?.(t('income.removed', { amount: amountOf(income) })) : undefined
      if (!income) return
      await nextTick()
      removedStrip.value?.querySelector('button')?.focus()
    })
    const recordButton = ref<{ $el: HTMLElement } | null>(null)
    watch(incomes.restored, async (back) => {
      if (!back) return
      unsay?.()
      unsay = announce?.(t('income.restored'))
      await nextTick()
      recordButton.value?.$el.focus()
    })
    onUnmounted(() => unsay?.())

    function confirmRemove(): void {
      const income = target.value
      removeOpen.value = false
      if (income) void incomes.remove(income)
    }

    const online = ref(navigator.onLine)
    const follow = (): void => {
      online.value = navigator.onLine
    }
    // The names of the accounts on the cards (MOL-123): the page as the server has it now.
    const accounts = useAccountsStore()
    onMounted(() => void accounts.refresh())
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

    return {
      today,
      t,
      ...incomes,
      sheetOpen,
      editing,
      compose,
      edit,
      amendEditing,
      removeOpen,
      removedStrip,
      recordButton,
      target,
      ask,
      confirmRemove,
      online,
      amountOf,
      lineOf,
      sumsOf,
      monthOf: (month: string) => monthOf(month, locale.value),
      IconCashPlus,
    }
  },
})
</script>

<style scoped lang="scss">
.strip {
  @include appear;

  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-footnote);

  svg {
    @include icon;

    font-size: var(--icon-sm);
  }
}

.removed {
  align-items: center;
  justify-content: space-between;
  background: var(--surface-2);
  color: var(--text);
}

.removed-text {
  min-width: 0;
}

.failed {
  background: var(--bad-tint);
  color: var(--bad-ink);
}

.month + .month {
  margin-top: var(--space-4);
}

.month-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0 0 var(--space-2);
}

.caption {
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.sums {
  min-width: 0;
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

// Room for «Доход» under the last card: it floats over the list, as «Трата» does on the month.
.month:last-of-type {
  padding-bottom: calc(var(--space-8) + var(--space-8) + var(--space-6));
}
</style>
