<template>
  <li class="line" :class="{ dense }">
    <RouterLink class="open" :to="{ name: 'money-account', params: { accountId: account.id } }">
      <span class="text">
        <span class="name">
          <span class="name-text">{{ account.name }}</span>
          <span v-if="dense && account.savings" class="tag">{{ t('accounts.savings_tag') }}</span>
        </span>
        <span v-if="!dense" class="sub">{{ sub }}</span>
      </span>
      <span class="money">
        <span class="balance" :class="{ negative: account.balance.minor < 0n }">
          {{ balance }}
        </span>
        <span v-if="!dense && account.inSpend" class="approx">≈ {{ inSpend }}</span>
      </span>
      <IconChevron v-if="!dense" class="chevron" aria-hidden="true" />
    </RouterLink>
  </li>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevron from '~icons/mdi/chevron-right'
import type { MoneyAccountView } from '@molvia/model'
import { shortDay, signedAmount } from '@/components/accounts'

/**
 * One account as a row (MOL-123): on the card of «Деньги» — the name, «сбережения» and the balance
 * (handoff 01), and on «Счета» — with the currency and the last thing that happened to it, and the
 * balance in the spending currency beside a foreign one (handoff 02). The balance is the server's;
 * below zero it is the one figure of the section drawn as «плохо». No rate: the price of money is
 * its currency's, never an account's (MOL-43, Р-2).
 */
export default defineComponent({
  name: 'AccountLine',
  components: { IconChevron },
  props: {
    account: { type: Object as PropType<MoneyAccountView>, required: true },
    /** The card of the month: one line, no «≈» — the total carries it (handoff 01). */
    dense: { type: Boolean, default: false },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const balance = computed(() => signedAmount(props.account.balance, locale.value))
    const inSpend = computed(() =>
      props.account.inSpend
        ? signedAmount(props.account.inSpend, locale.value, { estimate: true })
        : '',
    )
    const sub = computed(() => {
      const { currency, lastCheckedOn, startOn } = props.account
      return lastCheckedOn
        ? t('accounts.screen.row_checked', {
            currency,
            date: shortDay(lastCheckedOn, locale.value),
          })
        : t('accounts.screen.row_started', { currency, date: shortDay(startOn, locale.value) })
    })
    return { t, balance, inSpend, sub }
  },
})
</script>

<style scoped lang="scss">
.line + .line {
  border-top: var(--hairline) solid var(--border);
}

.open {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 4rem;
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  color: var(--text);
  text-decoration: none;

  @media (hover: hover) {
    &:hover {
      background: var(--surface-2);
    }
  }

  .dense & {
    min-height: var(--touch-target-lg);
    padding: var(--space-1) var(--space-4);
  }
}

.text {
  display: grid;
  flex: 1;
  min-width: 0;
}

.name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);

  .dense & {
    font-size: var(--text-body);
    font-weight: var(--weight-regular);
  }
}

.name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag {
  flex: none;
  padding: 0 var(--space-2);
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
}

.sub,
.approx {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.money {
  display: grid;
  flex: none;
  justify-items: end;
}

.balance {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  &.negative {
    color: var(--bad-ink);
  }
}

.chevron {
  @include icon;

  font-size: var(--icon);
  color: var(--text-muted);
}
</style>
