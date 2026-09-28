<template>
  <p v-if="answer?.held" class="held">
    <span>{{ words }}</span>
    <button type="button" class="fill" @click="$emit('fill', answer.held)">
      {{ t('accounts.held_fill') }}
    </button>
  </p>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AccountsHeldResponse, Currency, Money } from '@molvia/model'
import { api } from '@/api'
import { shortDay, signedAmount } from '@/components/accounts'
import { useAccountsStore } from '@/stores/accounts'

/**
 * «По счетам на 25 сент.: 5 920,81 ₽ · Подставить» under «сколько было до» of an exchange and an
 * income (MOL-123, owner's decision В-3): what the accounts of the currency held at the end of the
 * day, the operation amended left out — the server's sum (Р-20 MOL-115). A hint and nothing more:
 * put into the wallet in silence it would re-price past months (MOL-73 В-6), so only a tap fills it.
 * Nothing to say — no account of the currency, or one started that day or later — and there is no
 * line.
 */
export default defineComponent({
  name: 'HeldFromAccounts',
  props: {
    currency: { type: String as PropType<Currency>, required: true },
    day: { type: String, required: true },
    /** The exchange or income being amended: left out of what it counts. */
    except: { type: String as PropType<string | null>, default: null },
  },
  emits: {
    fill: (held: Money) => typeof held === 'object',
  },
  setup(props) {
    const { t, locale } = useI18n()
    const store = useAccountsStore()
    const answer = ref<AccountsHeldResponse | null>(null)
    let latest = 0

    async function ask(): Promise<void> {
      const mine = ++latest
      answer.value = null
      if (!store.accounts.some(({ currency }) => currency === props.currency)) return
      try {
        const held = await api.accountsHeld({
          currency: props.currency,
          day: props.day,
          ...(props.except ? { except: props.except } : {}),
        })
        if (mine === latest) answer.value = held
      } catch {
        // No line: a hint that could not be asked is not a failure of the sheet.
      }
    }
    watch(() => [props.currency, props.day, props.except, store.accounts], ask, {
      immediate: true,
    })

    const words = computed(() => {
      const held = answer.value?.held
      if (!held) return ''
      const amount = signedAmount(held, locale.value)
      return t('accounts.held_hint', {
        date: shortDay(props.day, locale.value),
        amount: answer.value?.approximate ? `≈ ${amount}` : amount,
      })
    })
    return { t, answer, words }
  },
})
</script>

<style scoped lang="scss">
.held {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.fill {
  min-height: var(--touch-target);
  padding: 0 var(--space-2);
  border: 0;
  background: transparent;
  color: var(--accent-ink);
  font: inherit;
  font-weight: var(--weight-bold);
  cursor: pointer;
}
</style>
