<template>
  <BottomSheet :open="open" :on-closed="onClosed" @update:open="$emit('update:open', $event)">
    <template #title>{{ title }}</template>
    <p class="body">{{ body }}</p>
    <template #footer>
      <!-- While someone still reads the receipt, the camera stays the way on, first (owner's В-1 «а»). -->
      <AppButton v-if="othersRead" size="large" block @click="$emit('choose', 'photo')">
        <template #icon><IconCamera /></template>
        {{ t('receipts_access.sheet.photograph') }}
      </AppButton>
      <AppButton
        :variant="othersRead ? 'secondary' : 'primary'"
        :size="othersRead ? 'regular' : 'large'"
        block
        @click="$emit('choose', 'manual')"
      >
        <template v-if="!othersRead" #icon><IconPencil /></template>
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
import type { ReceiptsAccess, ReceiptsClosed } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { useLocalDay } from '@/composables/useLocalDay'
import { closedWords } from '@/composables/useReceiptsAccess'
import type { ReceiptsClosedWay } from '@/composables/useReceiptsAccess'

/**
 * «Пробные чеки закончились» (MOL-276): stood before the camera when the model reads the person's receipts no more —
 * the trial spent with nothing paid, a paid reading run out (adversarial А2), or the month's hundred read. It says so
 * in words, and offers the way on: the
 * record by hand, the developer — who opens the reading by hand until payment (MOL-277 adds its buttons here) — and,
 * while Tesseract still reads in the model's place, the camera itself. Every way goes once the sheet is away: the
 * button that opened it decides where.
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
    choose: (way: ReceiptsClosedWay) => ['photo', 'manual', 'developer'].includes(way),
  },
  setup(props) {
    const { t, locale } = useI18n()
    const today = useLocalDay()

    const title = computed(() => t(`receipts_access.sheet.${props.reason}_title`))
    const body = computed(() =>
      t(
        `receipts_access.sheet.${props.reason}_${props.othersRead ? 'read' : 'manual'}`,
        closedWords(props.reason, props.access, t, locale.value, today.value),
      ),
    )

    return { t, title, body }
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
