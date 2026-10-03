<template>
  <li class="row">
    <!-- No `aria-label`: it would silence everything the row says; the verb is read first. -->
    <button class="body" type="button" @click="$emit('open', operation)">
      <span class="badge" :style="badgeStyle" aria-hidden="true">
        <component :is="icon" class="glyph" />
      </span>
      <span class="text">
        <span class="verb">{{ t('accounts.account.row_open') }}</span>
        <span class="title">{{ title ?? ownTitle }}</span>
        <span v-if="(meta ?? ownMeta) !== ''" class="meta">{{ meta ?? ownMeta }}</span>
      </span>
      <span v-if="!plain" class="sums">
        <span class="amount">{{ amount }}</span>
        <span v-if="source" class="source">{{ source }}</span>
      </span>
      <IconChevron class="chevron" aria-hidden="true" />
    </button>
  </li>
</template>

<script lang="ts">
import { computed, defineComponent, markRaw } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCart from '~icons/mdi/cart-outline'
import IconCashPlus from '~icons/mdi/cash-plus'
import IconChevron from '~icons/mdi/chevron-right'
import IconSwap from '~icons/mdi/swap-horizontal'
import type { AccountOperationView, SpendingCategoryView } from '@molvia/model'
import { signedAmount } from '@/components/accounts'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { asTyped, categoryColour, categoryIcon } from '@/components/spending'

/**
 * The note «Записать разницу» writes, in every language the app speaks: written on a Russian screen
 * and read on an English one it is still «Прочее · сверка» (review 29).
 */
const RECONCILE_NOTES = new Set([ru.accounts.reconcile.note, en.accounts.reconcile.note])

/**
 * One operation as the journal of an account, «не попали» and a check list it (MOL-123, handoff
 * 04, 05): a spending, a trip, an income or one side of an exchange, each in its own words. `in`
 * an account, the amount is what it did to that account — «≈» when a rate of its day counted it —
 * and under it the operation's own money when that was another currency. Out of any account, it is
 * the operation's own amount. Always with its sign; the colour is the text's: only a balance below
 * zero is «плохо» (handoff 04).
 */
export default defineComponent({
  name: 'OperationRow',
  components: { IconChevron },
  props: {
    operation: { type: Object as PropType<AccountOperationView>, required: true },
    categories: { type: Array as PropType<SpendingCategoryView[]>, required: true },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
    /** The name of an account by its id — the other half of an exchange. */
    accountName: {
      type: Function as PropType<(id: string) => string | null>,
      required: true,
    },
    /** The row is in an account's journal: its amount is what it moved there. */
    inAccount: { type: Boolean, default: false },
    /** A check names its reasons in its own words (handoff 05). */
    title: { type: String as PropType<string | null>, default: null },
    meta: { type: String as PropType<string | null>, default: null },
    /** A reason of a check: its title already says the sum, so the row carries none. */
    plain: { type: Boolean, default: false },
  },
  emits: {
    open: (operation: AccountOperationView) => typeof operation === 'object',
  },
  setup(props) {
    const { t, locale } = useI18n()

    const category = computed(() => {
      const { kind, categoryId } = props.operation
      if (kind === 'trip') return props.categories.find((one) => one.preset === 'groceries') ?? null
      return props.categories.find((one) => one.id === categoryId) ?? null
    })
    const categoryName = computed(() =>
      category.value ? props.nameOf(category.value) : t('spending.category.other'),
    )
    /** «Прочее · сверка»: what «Записать разницу» wrote (handoff 05) — its note and «Прочее». */
    const reconciled = computed(() => {
      const { kind, note, source } = props.operation
      if (note === null || !RECONCILE_NOTES.has(note)) return false
      return kind === 'income' ? source === 'other' : category.value?.preset === 'other'
    })

    const icon = computed(() => {
      const kind = props.operation.kind
      if (kind === 'trip') return markRaw(IconCart)
      if (kind === 'income') return markRaw(IconCashPlus)
      if (kind === 'exchange') return markRaw(IconSwap)
      return category.value ? categoryIcon(category.value) : markRaw(IconCart)
    })
    const badgeStyle = computed(() => {
      const kind = props.operation.kind
      if (kind === 'trip') return { background: 'var(--accent-tint)', color: 'var(--accent-ink)' }
      if (kind !== 'spending' || !category.value)
        return { background: 'var(--surface-2)', color: 'var(--text-muted)' }
      const colour = categoryColour(category.value)
      return {
        color: colour,
        background: `color-mix(in oklch, ${colour} var(--cat-tint-share), var(--surface))`,
      }
    })

    const ownTitle = computed(() => {
      const operation = props.operation
      if (reconciled.value) return t('accounts.account.reconcile_row')
      switch (operation.kind) {
        case 'trip':
          return t('spending.trip_row_title', { place: operation.place ?? '' })
        case 'income':
          return t(`income.source.${operation.source ?? 'other'}`)
        case 'exchange':
          return t('accounts.account.exchange')
        default:
          return operation.note ?? categoryName.value
      }
    })

    const ownMeta = computed(() => {
      const operation = props.operation
      if (reconciled.value)
        return t(
          operation.kind === 'income'
            ? 'accounts.account.reconcile_in'
            : 'accounts.account.reconcile_out',
        )
      switch (operation.kind) {
        case 'trip': {
          const items = operation.items ?? 0
          const line = t(
            'spending.trip_row_meta',
            { category: categoryName.value, n: items },
            items,
          )
          return operation.unpriced > 0
            ? `${line}, ${String(operation.unpriced)} ${t('accounts.trip_unpriced')}`
            : line
        }
        case 'income':
          return [t('income.fab'), operation.note].filter(Boolean).join(' · ')
        case 'exchange': {
          const other = operation.counterpart
          if (!other) return ''
          const size = {
            ...other.amount,
            minor: other.amount.minor < 0n ? -other.amount.minor : other.amount.minor,
          }
          const amount = asTyped(size, locale.value)
          const name = other.accountId ? props.accountName(other.accountId) : null
          if (!name) return amount
          return t(
            operation.side === 'received'
              ? 'accounts.account.exchange_from'
              : 'accounts.account.exchange_to',
            { name, amount },
          )
        }
        default: {
          const { note, place } = operation
          if (note === null) return place ?? ''
          return place ? `${categoryName.value} · ${place}` : categoryName.value
        }
      }
    })

    const amount = computed(() => {
      const operation = props.operation
      if (!props.inAccount) {
        const [own] = operation.amounts
        return own ? signedAmount(own, locale.value, { plus: true }) : ''
      }
      if (!operation.moved) return t('spending.uncounted_row')
      const text = signedAmount(operation.moved, locale.value, {
        plus: true,
        estimate: operation.approximate,
      })
      return operation.approximate ? `≈ ${text}` : text
    })

    /** «9 891 ֏ · списано», «24,99 € · без «списано»» — only where it was another currency. */
    const source = computed(() => {
      const operation = props.operation
      const moved = operation.moved
      if (!props.inAccount || !moved) return null
      const other = operation.amounts.filter((one) => one.currency !== moved.currency)
      if (other.length === 0) return null
      const text = other
        .map((one) =>
          asTyped({ ...one, minor: one.minor < 0n ? -one.minor : one.minor }, locale.value),
        )
        .join(', ')
      return t(
        operation.debited ? 'accounts.account.charged_sub' : 'accounts.account.no_charged_sub',
        { amount: text },
      )
    })

    return { t, icon, badgeStyle, ownTitle, ownMeta, amount, source }
  },
})
</script>

<style scoped lang="scss">
.row + .row {
  border-top: var(--hairline) solid var(--border);
}

.body {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 3.75rem;
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  @media (hover: hover) {
    &:hover {
      background: var(--surface-2);
    }
  }

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-pill);
}

.glyph {
  @include icon;

  font-size: var(--icon);
}

.text {
  display: grid;
  flex: 1;
  justify-items: start;
  min-width: 0;
}

.verb {
  @include visually-hidden;
}

.title,
.meta {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title {
  font-size: var(--text-headline);
}

.meta,
.source {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.sums {
  display: grid;
  flex: none;
  justify-items: end;
}

.amount {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.source {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.chevron {
  @include icon;

  font-size: var(--icon);
  color: var(--text-muted);
}
</style>
