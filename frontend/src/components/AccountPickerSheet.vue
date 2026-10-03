<template>
  <BottomSheet :open="open" back @update:open="$emit('update:open', $event)">
    <template #title>{{ title }}</template>
    <template #meta>{{ t('accounts.picker.meta') }}</template>

    <div class="groups" role="radiogroup" :aria-label="title">
      <template v-for="section in sections" :key="section.key">
        <h3 class="caption">{{ section.title }}</h3>
        <ul class="card">
          <li v-for="account in section.accounts" :key="account.id">
            <button
              type="button"
              role="radio"
              class="option"
              :aria-checked="selected === account.id ? 'true' : 'false'"
              @click="pick(account.id)"
            >
              <span class="text">
                <span class="name">{{ account.name }}</span>
                <span class="sub">{{ subOf(account) }}</span>
              </span>
              <span class="balance" :class="{ negative: account.balance.minor < 0n }">
                {{ balanceOf(account) }}
              </span>
              <IconCheck v-if="selected === account.id" class="check" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </template>
      <ul class="card">
        <li>
          <button
            type="button"
            role="radio"
            class="option"
            :aria-checked="selected === null ? 'true' : 'false'"
            @click="pick(null)"
          >
            <span class="text">
              <span class="name">{{ t('accounts.picker.none') }}</span>
              <span class="sub">{{ t('accounts.picker.none_hint') }}</span>
            </span>
            <IconCheck v-if="selected === null" class="check" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <p class="footnote">{{ footnote }}</p>
    </div>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/mdi/check'
import type { Currency, MoneyAccountView } from '@molvia/model'
import BottomSheet from '@/components/BottomSheet.vue'
import { pickerGroups, signedAmount } from '@/components/accounts'

/**
 * «Счёт» — the choice of an account, over the sheet of an operation (MOL-123, handoff 06): the
 * accounts of the operation's currency, the others where «списано» can cover them — a spending and
 * a trip — and «Без счёта». A list of radios, each with what it holds now, since at the shelf one
 * picks where there is enough. A choice closes the sheet: there is nothing to confirm.
 */
export default defineComponent({
  name: 'AccountPickerSheet',
  components: { BottomSheet, IconCheck },
  props: {
    open: { type: Boolean, required: true },
    title: { type: String, required: true },
    accounts: { type: Array as PropType<MoneyAccountView[]>, required: true },
    currency: { type: String as PropType<Currency>, required: true },
    /** An income and an exchange take only accounts of their own currency. */
    strict: { type: Boolean, default: false },
    selected: { type: String as PropType<string | null>, default: null },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    pick: (id: string | null) => id === null || typeof id === 'string',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const groups = computed(() => pickerGroups(props.accounts, props.currency, props.strict))
    const sections = computed(() =>
      [
        {
          key: 'own',
          title: t('accounts.picker.group_same', {
            currency: t(`accounts.currency_in.${props.currency}`),
          }),
          accounts: groups.value.own,
        },
        { key: 'other', title: t('accounts.picker.group_other'), accounts: groups.value.other },
      ].filter((section) => section.accounts.length > 0),
    )
    const subOf = (account: MoneyAccountView) =>
      account.savings
        ? t('accounts.currency_savings', { currency: account.currency })
        : account.currency
    const balanceOf = (account: MoneyAccountView) => signedAmount(account.balance, locale.value)
    const footnote = computed(() => {
      if (!props.strict) return t('accounts.picker.note_loose')
      const currency = t(`accounts.currency_in.${props.currency}`)
      return groups.value.own.length > 0
        ? t('accounts.picker.note_strict', { currency })
        : t('accounts.picker.note_strict_none', { currency })
    })
    function pick(id: string | null): void {
      emit('pick', id)
      emit('update:open', false)
    }
    return { t, sections, subOf, balanceOf, footnote, pick }
  },
})
</script>

<style scoped lang="scss">
.groups {
  display: grid;
  gap: var(--space-2);
}

.caption {
  margin: var(--space-2) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.card {
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  list-style: none;

  li + li {
    border-top: var(--hairline) solid var(--border);
  }
}

.option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 3.75rem;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &[aria-checked='true'] {
    background: var(--accent-tint);

    /* Muted text is under 4.5:1 on a tint (MOL-172): on the chosen row its lines are ink. */
    .sub,
    .balance:not(.negative) {
      color: var(--text);
    }
  }

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.text {
  display: grid;
  flex: 1;
  min-width: 0;
}

.name {
  overflow: hidden;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub,
.footnote {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.footnote {
  margin: var(--space-1) var(--space-1) 0;
}

.balance {
  flex: none;
  color: var(--text-muted);
  font-size: var(--text-callout);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  &.negative {
    color: var(--bad-ink);
  }
}

.check {
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  color: var(--accent-ink);
}
</style>
