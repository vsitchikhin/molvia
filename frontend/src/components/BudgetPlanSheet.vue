<template>
  <BottomSheet :open="open" :on-closed="afterClose" @update:open="$emit('update:open', $event)">
    <template #title>{{ title }}</template>
    <template #meta>{{ t('budget.sheet.meta') }}</template>

    <form class="form" novalidate @submit.prevent="submit">
      <p v-if="!online" class="strip">
        <IconCloudOff class="strip-icon" aria-hidden="true" />{{ t('budget.sheet.offline') }}
      </p>

      <AppField
        v-if="subject.kind === 'choose'"
        v-model="chosen"
        :label="t('spending.sheet.category')"
        kind="select"
        :options="categoryOptions"
      />

      <SegmentedControl
        v-if="subject.kind !== 'savings'"
        v-model="kind"
        :options="kinds"
        :legend="t('budget.sheet.kind')"
      />

      <div>
        <AppField
          ref="valueField"
          v-model="value"
          :label="kind === 'share' ? t('budget.sheet.percent') : t('budget.sheet.amount')"
          :kind="kind === 'share' ? 'digits' : 'decimal'"
          :error-text="problem"
          enterkeyhint="done"
          @update:model-value="problem = null"
        >
          <template #suffix>{{ kind === 'share' ? '%' : sign }}</template>
        </AppField>
        <p v-if="before" class="hint before">{{ before }}</p>
        <p class="hint">
          {{
            subject.kind === 'savings'
              ? t('budget.sheet.savings_hint')
              : kind === 'share'
                ? t('budget.sheet.share_hint')
                : t('budget.sheet.amount_hint')
          }}
        </p>
      </div>

      <p class="from">{{ fromWords }}</p>
    </form>

    <template #footer>
      <p v-if="failed" class="failed" role="alert">{{ failed }}</p>
      <AppButton size="large" block :busy="sending" :disabled="sending || !online" @click="submit">
        <template #icon><IconCheck v-if="online" /><IconCloudOff v-else /></template>
        {{ online ? t('budget.sheet.save') : t('budget.sheet.wait_online') }}
      </AppButton>
      <AppButton
        v-if="plan"
        variant="danger-ghost"
        block
        :disabled="sending || !online"
        @click="send(null)"
      >
        <template #icon><IconClose /></template>
        {{ t('budget.sheet.remove') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref, watch } from 'vue'
import type { ComponentPublicInstance, PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/mdi/check'
import IconClose from '~icons/mdi/close'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import { ApiError } from '@molvia/client'
import {
  BUDGET_AMOUNT_MAX_MINOR,
  BUDGET_PERCENT_MAX,
  ERROR,
  currencySign,
  decimalFromMinor,
  formatMoney,
  parseMoney,
  previousMonth,
} from '@molvia/model'
import type {
  BudgetPlanBody,
  BudgetPlanValue,
  Currency,
  MoneyBudgetView,
  SpendingCategoryView,
} from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { monthGenitive, monthName } from '@/components/charts'
import { shown } from '@/composables/useItemDetails'

/** What the plan is of: a category on screen, one to choose, or the savings target (В-4). */
export type BudgetSubject =
  | { readonly kind: 'category'; readonly categoryId: string }
  | { readonly kind: 'choose' }
  | { readonly kind: 'savings' }

/** What the sheet hands the screen once it has closed. */
export interface BudgetOutcome {
  readonly kind: 'saved' | 'removed'
  readonly name: string
}

/**
 * The plan of a category, or the savings target, from the month on screen on (MOL-117, В-1, Р-9):
 * a sum in the spending currency or a whole percent of «Пришло» (В-2) — the target is a percent
 * only. Written with a connection only, as an account is (Р-8): a plan is set at home, and the
 * answer is the month's budget counted anew. The phone works no plan out of «Пришло»: what a percent
 * comes to is the server's, on the row once saved.
 */
export default defineComponent({
  name: 'BudgetPlanSheet',
  components: {
    AppButton,
    AppField,
    BottomSheet,
    IconCheck,
    IconClose,
    IconCloudOff,
    SegmentedControl,
  },
  props: {
    open: { type: Boolean, required: true },
    /** The month the plan holds from — the one on screen. */
    month: { type: String, required: true },
    subject: { type: Object as PropType<BudgetSubject>, required: true },
    /** The plan that holds in the month now, or null. */
    plan: { type: Object as PropType<BudgetPlanValue | null>, default: null },
    /** The categories one may choose, in the order of the chips — the live ones. */
    categories: { type: Array as PropType<readonly SpendingCategoryView[]>, default: () => [] },
    nameOf: { type: Function as PropType<(id: string) => string>, required: true },
    spendCurrency: { type: String as PropType<Currency>, required: true },
    online: { type: Boolean, default: true },
    /** The write, the screen's: it shows the budget the write comes back with (review 6, Ж). */
    save: {
      type: Function as PropType<(body: BudgetPlanBody) => Promise<MoneyBudgetView>>,
      required: true,
    },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    done: (outcome: BudgetOutcome) => typeof outcome === 'object',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()

    const kind = ref<'amount' | 'share'>('amount')
    const value = ref('')
    const chosen = ref('')
    const problem = ref<string | null>(null)
    const failed = ref<string | null>(null)
    const sending = ref(false)
    const valueField = ref<ComponentPublicInstance | null>(null)
    let outcome: BudgetOutcome | null = null

    watch(
      () => props.open,
      (open) => {
        if (!open) return
        const plan = props.plan
        kind.value = props.subject.kind === 'savings' || plan?.kind === 'share' ? 'share' : 'amount'
        // A sum kept from another currency of spending — a move — is never put in the field as if it
        // were in this one: «Сохранить» would have made 250 000 ֏ into 250 000 ₽ (adversarial Б).
        value.value =
          plan?.kind === 'share'
            ? String(plan.percent)
            : plan?.kind === 'amount' && plan.amount.currency === props.spendCurrency
              ? shown(decimalFromMinor(plan.amount), locale.value === 'ru' ? ',' : '.')
              : ''
        chosen.value = props.categories[0]?.id ?? ''
        problem.value = null
        failed.value = null
        outcome = null
      },
      { immediate: true },
    )

    const categoryId = computed(() =>
      props.subject.kind === 'category'
        ? props.subject.categoryId
        : props.subject.kind === 'choose'
          ? chosen.value || null
          : null,
    )
    const title = computed(() =>
      props.subject.kind === 'savings'
        ? t('budget.savings.title')
        : props.subject.kind === 'category'
          ? props.nameOf(props.subject.categoryId)
          : t('budget.sheet.title_choose'),
    )
    const categoryOptions = computed(() =>
      props.categories.map((category) => ({
        value: category.id,
        label: props.nameOf(category.id),
      })),
    )
    const kinds = computed(() => [
      { value: 'amount', label: t('budget.sheet.kind_amount') },
      { value: 'share', label: t('budget.sheet.kind_share') },
    ])
    const sign = computed(() => currencySign(props.spendCurrency, locale.value))
    /** «Был 250 000 ֏ — введите сумму в ₽»: the plan of another currency, said and not typed. */
    const before = computed(() => {
      const plan = props.plan
      if (plan?.kind !== 'amount' || plan.amount.currency === props.spendCurrency) return null
      return t('budget.sheet.other_currency', {
        amount: formatMoney(plan.amount, locale.value),
        sign: sign.value,
      })
    })
    /** «С октября и дальше. Сентябрь не меняется.» — what the plan is of in time (Р-9). */
    const fromWords = computed(() => {
      const before = monthName(previousMonth(props.month), locale.value)
      return t('budget.sheet.from', {
        month: monthGenitive(props.month, t),
        before: before.charAt(0).toLocaleUpperCase(locale.value) + before.slice(1),
      })
    })

    /** What was typed, as a plan — or null with the reason put under the field. */
    function typed(): BudgetPlanValue | null {
      const text = value.value.trim()
      if (kind.value === 'share') {
        const percent = /^\d{1,3}$/.test(text) ? Number(text) : NaN
        if (!(percent >= 0 && percent <= BUDGET_PERCENT_MAX)) {
          problem.value = t('budget.sheet.bad_percent', { max: BUDGET_PERCENT_MAX })
          return null
        }
        return { kind: 'share', percent }
      }
      try {
        const amount = parseMoney(text, props.spendCurrency)
        if (amount.minor > BUDGET_AMOUNT_MAX_MINOR) {
          problem.value = t('budget.sheet.too_big')
          return null
        }
        return { kind: 'amount', amount }
      } catch {
        problem.value = t('budget.sheet.bad_amount')
        return null
      }
    }

    function finished(done: BudgetOutcome): void {
      if (!props.open) {
        emit('done', done)
        return
      }
      outcome = done
      emit('update:open', false)
    }
    function afterClose(): void {
      const done = outcome
      outcome = null
      if (done) emit('done', done)
    }

    async function send(plan: BudgetPlanValue | null): Promise<void> {
      if (sending.value || !props.online) return
      failed.value = null
      const id = categoryId.value
      if (props.subject.kind !== 'savings' && id === null) {
        failed.value = t('spending.sheet.bad_category')
        return
      }
      sending.value = true
      try {
        await props.save({ categoryId: id, from: props.month, plan })
        finished({
          kind: plan ? 'saved' : 'removed',
          name: id === null ? t('budget.savings.title') : props.nameOf(id),
        })
      } catch (caught) {
        const code = caught instanceof ApiError ? caught.code : null
        failed.value =
          code === ERROR.NOT_FOUND ? t('budget.sheet.category_gone') : t('budget.sheet.failed')
      } finally {
        sending.value = false
      }
    }

    async function submit(): Promise<void> {
      const plan = typed()
      if (!plan) {
        await nextTick()
        ;(valueField.value?.$el as HTMLElement | undefined)?.querySelector('input')?.focus()
        return
      }
      await send(plan)
    }

    return {
      t,
      kind,
      kinds,
      value,
      chosen,
      categoryOptions,
      problem,
      failed,
      sending,
      valueField,
      title,
      sign,
      before,
      fromWords,
      afterClose,
      submit,
      send,
    }
  },
})
</script>

<style scoped lang="scss">
.form {
  display: grid;
  gap: var(--space-4);
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
  @include icon;

  font-size: var(--icon-sm);
}

.hint,
.from {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.from {
  margin: 0;
  color: var(--text);
  font-weight: var(--weight-medium);
}

.failed {
  margin: 0 0 var(--space-2);
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}

.hint.before {
  color: var(--warn-ink);
}
</style>
