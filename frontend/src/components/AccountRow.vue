<template>
  <button type="button" class="row" aria-haspopup="dialog" @click="$emit('open')">
    <IconWallet class="icon" aria-hidden="true" />
    <span class="label"
      ><span class="hidden">{{ t('accounts.picker.row_open') }}</span
      >{{ label }}</span
    >
    <span class="value" :class="{ none: !account }">
      {{ account?.name ?? t('accounts.picker.none') }}
    </span>
    <IconChevron class="chevron" aria-hidden="true" />
  </button>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevron from '~icons/mdi/chevron-right'
import IconWallet from '~icons/mdi/wallet-outline'
import type { MoneyAccountView } from '@molvia/model'

/**
 * «Счёт: Наличные ֏ ›» in the sheet of an operation (MOL-123, handoff 06): where the money came
 * from or went to. A button that opens the picker over the sheet, never a native select — a select
 * cannot show the balance nor tell «same currency» from «другие». The screen does not draw it at
 * all while the owner has no account: the sheet is then exactly as it was before accounts.
 */
export default defineComponent({
  name: 'AccountRow',
  components: { IconChevron, IconWallet },
  props: {
    label: { type: String, required: true },
    account: { type: Object as PropType<MoneyAccountView | null>, default: null },
  },
  emits: ['open'],
  setup() {
    return { t: useI18n().t }
  },
})
</script>

<style scoped lang="scss">
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--touch-target-lg);
  padding: 0 var(--space-2) 0 var(--space-3);
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;

  @media (hover: hover) {
    &:hover {
      background: var(--accent-tint);

      /* Muted text is under 4.5:1 on a tint (MOL-172); the icon and the chevron are marks, 3:1. */
      .label,
      .value.none {
        color: var(--text);
      }
    }
  }

  &:focus-visible {
    @include focus-ring(2px);
  }
}

.icon {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  color: var(--text-muted);
}

.label {
  flex: none;
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.hidden {
  @include visually-hidden;
}

.value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.none {
    color: var(--text-muted);
    font-weight: var(--weight-regular);
  }
}

.chevron {
  flex: none;
  width: 1.375rem;
  height: 1.375rem;
  color: var(--text-muted);
}
</style>
