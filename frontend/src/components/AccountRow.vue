<template>
  <button
    type="button"
    class="row"
    :class="{ inactive: disabled, invalid }"
    aria-haspopup="dialog"
    :aria-disabled="disabled ? 'true' : undefined"
    :aria-invalid="invalid ? 'true' : undefined"
    @click="press"
  >
    <IconWallet class="icon" aria-hidden="true" />
    <span class="label"
      ><span class="hidden">{{ t('accounts.picker.row_open') }}</span
      >{{ label }}</span
    >
    <span class="value" :class="{ none: !account }">
      {{ account?.name ?? empty ?? t('accounts.picker.none') }}
    </span>
    <IconChevron v-if="!disabled" class="chevron" aria-hidden="true" />
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
    /** What the row says with no account: «Без счёта» unless the sheet has no such choice. */
    empty: { type: String as PropType<string | null>, default: null },
    /**
     * Not now (MOL-174): nothing to choose yet — «Куда» before «Откуда», or no second account of the
     * currency (MOL-253). Still in focus, without a chevron, and it opens nothing.
     */
    disabled: { type: Boolean, default: false },
    /** The account chosen was refused — gone on another phone (MOL-253, state 6). */
    invalid: { type: Boolean, default: false },
  },
  emits: ['open'],
  setup(props, { emit }) {
    function press(): void {
      if (!props.disabled) emit('open')
    }
    return { t: useI18n().t, press }
  },
})
</script>

<style scoped lang="scss">
.row {
  /* It measures itself for the icon below (MOL-321). */
  container-type: inline-size;
  display: flex;

  /* Wraps only where the value takes a line of its own (below); a row cannot ask its own width. */
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--touch-target-lg);
  padding: 0 var(--space-2) 0 var(--space-3);
  border: var(--hairline) solid var(--border-strong);
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

  &.inactive {
    cursor: default;

    .value {
      color: var(--text-muted);
      font-weight: var(--weight-medium);
    }

    @media (hover: hover) {
      &:hover {
        background: var(--surface-2);
      }
    }
  }

  &.invalid {
    border-color: var(--bad);
    box-shadow: inset 0 0 0 var(--hairline) var(--bad);
  }
}

.icon {
  @include icon;

  font-size: var(--icon-md);
  color: var(--text-muted);
}

/* Breaks between its words, never inside one, where the row is short (MOL-321): «Получил на» held on
   one line took the exchange's sheet 33 px past a phone at 200 %. */
.label {
  flex: 0 1 auto;
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.hidden {
  @include visually-hidden;
}

/* No width of its own (`width: 0` beside `flex: 1`), as `SearchField`'s input: the name's whole line was
   the row's least width, and a long one pushed the sheet past a phone of 320 instead of ending in «…». */
.value {
  flex: 1;
  width: 0;
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
  @include icon;

  font-size: var(--icon);
  color: var(--text-muted);
}

/* Narrower than this the wallet gives its place to the words, and the account's name goes to a line of its
   own under the label (MOL-321): the wallet only decorates, and at 200 % «Account» of one word, the wallet
   and the chevron stood 23 px past the spending's sheet; beside «Получил на» the name had some 20 px and
   was «…» — the row's very answer. In rem: from some 160 % of the text on 320, never at 100 %. */
$icon-beside: 10rem;

@container (width < #{$icon-beside}) {
  .icon {
    display: none;
  }

  .label {
    flex: 1 1 calc(100% - var(--icon) - var(--space-2));
  }

  .value {
    flex-basis: 100%;
    order: 1;
    text-align: left;
  }
}
</style>
