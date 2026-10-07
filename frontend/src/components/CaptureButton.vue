<template>
  <AppButton size="large" block @click="opened">
    <template #icon><IconCamera /></template>
    {{ t('purchases.capture') }}
  </AppButton>

  <!-- Mounted on the tap and put away from `onClosed`, as the sheet of a purchase: each opening
       starts with no parts, and a closed sheet leaves no file field in the page. -->
  <CaptureSheet
    v-if="mounted && photo"
    v-model:open="open"
    :country="photo"
    :on-closed="unmount"
    @sent="sent"
  />
  <!-- A Serbian receipt: its QR read off the photo, only the link sent (MOL-233), or pasted (MOL-232). -->
  <LinkReceiptSheet v-else-if="mounted" v-model:open="open" :on-closed="unmount" @sent="sent" />
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import IconCamera from '~icons/mdi/camera-outline'
import { photoReceiptCountrySchema } from '@molvia/model'
import type { ReceiptCountry } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import CaptureSheet from '@/components/CaptureSheet.vue'
import LinkReceiptSheet from '@/components/LinkReceiptSheet.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { afterStep, useNavigation } from '@/navigation'

/**
 * «Сфотографировать чек» (MOL-127, handoff 01–03): the main action of the strip on «Что брать» and
 * «Покупки» in the version «с чеком» (Д-3). A receipt sent from «Что брать» opens «Покупки», so the
 * person sees its row come (handoff v1, 03); «Чек отправлен» is said there and shown for a moment
 * in place of the strip's «Вернуть» (3d). A country whose receipts come by their link — Serbia
 * (MOL-232) — takes the same button to a sheet that reads the QR code off the photo (MOL-233).
 */
export default defineComponent({
  name: 'CaptureButton',
  components: { AppButton, CaptureSheet, IconCamera, LinkReceiptSheet },
  props: {
    country: { type: String as PropType<ReceiptCountry>, required: true },
  },
  emits: {
    /** Whether its sheet is up: the screen keeps the button mounted meanwhile (as «Записать»). */
    busy: (up: boolean) => typeof up === 'boolean',
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const route = useRoute()
    const { goTab } = useNavigation()
    const announce = useAnnouncer()
    const open = ref(false)
    const mounted = ref(false)
    watch(open, (up) => {
      emit('busy', up)
    })

    function sent(offline: boolean): void {
      announce?.(t(offline ? 'receipt.capture.sent_offline' : 'receipt.capture.sent'))
      // Told from the sheet's `onClosed`, inside the step back that closed it: a move made there is
      // dropped, so it waits for the step to land (review 3).
      if (route.name !== 'purchases') afterStep(() => void goTab('purchases'))
    }

    // the country whose receipts are read off the photo, or none: a Serbian receipt is its QR's link
    const photo = computed(() => {
      const parsed = photoReceiptCountrySchema.safeParse(props.country)
      return parsed.success ? parsed.data : null
    })

    return {
      t,
      photo,
      open,
      mounted,
      opened: () => {
        mounted.value = true
        open.value = true
      },
      unmount: () => {
        mounted.value = false
      },
      sent,
    }
  },
})
</script>
