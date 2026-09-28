<template>
  <div class="charged">
    <AppField
      :model-value="modelValue"
      :label="t('accounts.charged.label', { sign })"
      kind="decimal"
      :placeholder="placeholder"
      :error-text="bad ? t('spending.sheet.bad_amount') : null"
      :aria-describedby="hintId"
      @update:model-value="$emit('update:modelValue', $event)"
    >
      <template #label-extra>
        <span class="optional">{{ t('spending.sheet.optional') }}</span>
      </template>
      <template #suffix>{{ sign }}</template>
    </AppField>
    <p :id="hintId" class="hint">{{ hint }}</p>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { currencySign, parseMoney } from '@molvia/model'
import type { Currency, Money, MoneyAccountView } from '@molvia/model'
import AppField from '@/components/AppField.vue'
import { asTyped } from '@/components/spending'

/** What was typed, as money of the account — null when empty or not money. */
function typedCharge(text: string, currency: Currency): Money | null {
  if (!text.trim()) return null
  try {
    return parseMoney(text, currency)
  } catch {
    return null
  }
}

/**
 * «Списано со счёта» (MOL-123, handoff 06; MOL-43 В-3): what left the account exactly, in its
 * currency, when the operation was in another. In a dashed frame under the account's row — the
 * field is about that row. Empty, the server counts it by the rate of the day and marks it «≈»; the
 * figure under it is only what the phone expects, never what is sent. «Мой курс» does not move by it.
 */
export default defineComponent({
  name: 'ChargedField',
  components: { AppField },
  props: {
    modelValue: { type: String, required: true },
    account: { type: Object as PropType<MoneyAccountView>, required: true },
    /** The operation's amount by the rate of the day, when the phone can tell it — the placeholder. */
    estimate: { type: Object as PropType<Money | null>, default: null },
    bad: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (value: string) => typeof value === 'string',
  },
  setup(props) {
    const { t, locale } = useI18n()
    const hintId = useId()
    const sign = computed(() => currencySign(props.account.currency, locale.value))
    const placeholder = computed(() =>
      props.estimate ? asTyped(props.estimate, locale.value).replace(/\s*\D+$/u, '') : '',
    )
    const hint = computed(() => {
      const filled = typedCharge(props.modelValue, props.account.currency)
      if (filled && filled.minor > 0n)
        return t('accounts.charged.hint_filled', {
          name: props.account.name,
          amount: asTyped(filled, locale.value),
        })
      return props.estimate
        ? t('accounts.charged.hint_empty', { amount: asTyped(props.estimate, locale.value) })
        : t('accounts.charged.hint_empty_plain')
    })
    return { t, hintId, sign, placeholder, hint }
  },
})
</script>

<style scoped lang="scss">
.charged {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius);
}

.optional {
  margin-left: var(--space-1);
  color: var(--text-muted);
  font-weight: var(--weight-regular);
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
