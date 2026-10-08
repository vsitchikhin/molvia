<template>
  <BottomSheet :open="open" :on-closed="onClosed" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('receipt.codes.title') }}</template>
    <p class="body">{{ t('receipt.codes.body') }}</p>
    <AppCard as="ul" list>
      <ListRow
        v-for="one in codes"
        :key="one.position"
        as="li"
        :title="one.name"
        :meta="one.code"
      />
    </AppCard>

    <template #footer>
      <AppButton size="large" block @click="answer(true)">
        {{ t('item.barcode.bind') }}
      </AppButton>
      <AppButton variant="ghost" block @click="answer(false)">
        {{ t('receipt.codes.skip') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ListRow from '@/components/ListRow.vue'

/** A line's code and the item it would go to. */
export interface LineCode {
  readonly position: number
  readonly code: string
  /** The item the line is recorded as: the catalogue's, or the new one's name. */
  readonly name: string
}

/**
 * «Привязать штрихкоды?» (MOL-234, owner's В-2 «а»): the codes the Serbian tax office gave the lines,
 * which their items do not hold, asked about once at «Записать» — never written in silence (MOL-100).
 * A code written is found by the scanner for everyone, so the person with the receipt decides; the
 * words are MOL-100's. Either answer records: the codes are a gift to the catalogue, not the receipt.
 */
export default defineComponent({
  name: 'ReceiptBarcodesSheet',
  components: { AppButton, AppCard, BottomSheet, ListRow },
  props: {
    open: { type: Boolean, required: true },
    codes: { type: Array as PropType<readonly LineCode[]>, required: true },
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    /** The person's answer: bind the codes, or record without them. */
    answered: (bind: boolean) => typeof bind === 'boolean',
  },
  setup(_props, { emit }) {
    const { t } = useI18n()
    return {
      t,
      answer: (bind: boolean) => {
        emit('answered', bind)
        emit('update:open', false)
      },
    }
  },
})
</script>

<style scoped lang="scss">
.body {
  margin: 0 0 var(--space-4);
  font-size: var(--text-callout);
}
</style>
