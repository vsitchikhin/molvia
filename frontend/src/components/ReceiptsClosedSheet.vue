<template>
  <BottomSheet :open="open" :on-closed="onClosed" @update:open="$emit('update:open', $event)">
    <template #title>{{ title }}</template>
    <p class="body">{{ body }}</p>
    <template #footer>
      <!-- While someone still reads the receipt, the camera stays the way on, first (owner's В-1 «а»). -->
      <!-- Payment open (MOL-277, В-7 «а»): the way that opens the reading again, first. -->
      <AppButton v-if="paying" size="large" block @click="$emit('choose', 'pay')">
        {{ t('receipts_access.sheet.pay', { price: receiptsPrice }) }}
      </AppButton>
      <AppButton
        v-if="othersRead"
        :variant="paying ? 'secondary' : 'primary'"
        :size="paying ? 'regular' : 'large'"
        block
        @click="$emit('choose', 'photo')"
      >
        <template #icon><IconCamera /></template>
        {{ t('receipts_access.sheet.photograph') }}
      </AppButton>
      <AppButton
        :variant="manualSecondary ? 'secondary' : 'primary'"
        :size="manualSecondary ? 'regular' : 'large'"
        block
        @click="$emit('choose', 'manual')"
      >
        <template v-if="!manualSecondary" #icon><IconPencil /></template>
        {{ t('purchases.manual_by_hand') }}
      </AppButton>
      <AppButton variant="ghost" block @click="$emit('choose', 'developer')">
        {{ t('settings.feedback.label') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCamera from '~icons/mdi/camera-outline'
import IconPencil from '~icons/mdi/pencil-outline'
import { PAYMENT_TARIFFS, formatMoney } from '@molvia/model'
import type { ReceiptsAccess, ReceiptsClosed } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { useLocalDay } from '@/composables/useLocalDay'
import { useFf } from '@/stores/ff'
import { closedWords } from '@/composables/useReceiptsAccess'
import type { ReceiptsClosedWay } from '@/composables/useReceiptsAccess'

/**
 * «Пробные чеки закончились» (MOL-276): stood before the camera when the model reads the person's receipts no more —
 * the trial spent with nothing paid, a paid reading run out (adversarial А2), or the month's hundred read. It says so
 * in words, and offers the way on: the record by hand, the developer, and, while Tesseract still reads in the model's
 * place, the camera itself — and, with the фф `payments` on, «Открыть за $2» first, to the screen of payment with
 * receipts chosen (MOL-277, В-7 «а»). Every way goes once the sheet is away: the button that opened it decides where.
 */
export default defineComponent({
  name: 'ReceiptsClosedSheet',
  components: { AppButton, BottomSheet, IconCamera, IconPencil },
  props: {
    open: { type: Boolean, required: true },
    reason: { type: String as PropType<ReceiptsClosed>, required: true },
    access: { type: Object as PropType<ReceiptsAccess>, required: true },
    othersRead: { type: Boolean, required: true },
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    choose: (way: ReceiptsClosedWay) => ['photo', 'manual', 'developer', 'pay'].includes(way),
  },
  setup(props) {
    const { t, locale } = useI18n()
    const today = useLocalDay()

    // Payment is a way only while the фф is on (MOL-382), and never for the month's hundred: a payment does not lift it.
    const ffPayments = useFf('payments')
    const paying = computed(() => ffPayments.value && props.reason !== 'month')
    // the tariff's dollar is the domain's; the drams are today's, and the screen of payment says them
    const receiptsPrice = computed(() =>
      formatMoney({ minor: PAYMENT_TARIFFS.receipts.cents, currency: 'USD' }, locale.value),
    )
    // which of the reason's texts the body is: the first way the sheet offers
    const bodyKind = computed(() => {
      if (paying.value) return 'pay'
      return props.othersRead ? 'read' : 'manual'
    })
    // the record by hand gives way to payment and to the camera
    const manualSecondary = computed(() => props.othersRead || paying.value)
    const title = computed(() => t(`receipts_access.sheet.${props.reason}_title`))
    const body = computed(() =>
      t(`receipts_access.sheet.${props.reason}_${bodyKind.value}`, {
        ...closedWords(props.reason, props.access, t, locale.value, today.value),
        price: receiptsPrice.value,
      }),
    )

    return { t, title, body, paying, manualSecondary, receiptsPrice }
  },
})
</script>

<style scoped lang="scss">
.body {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
