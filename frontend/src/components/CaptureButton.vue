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

  <!-- «Пробные чеки закончились» (MOL-276): before the camera when the model reads no more. Mounted on
       the tap, as the camera's sheet, and every way it offers goes once it is away. -->
  <ReceiptsClosedSheet
    v-if="closedShown && closed && access"
    v-model:open="closedOpen"
    :reason="closed"
    :access="access"
    :others-read="othersRead"
    :on-closed="afterClosed"
    @choose="choose"
  />
  <!-- The record by hand that sheet offers: the strip's own way in, with no button of its own. -->
  <ManualEntryButton v-if="manualUsed" ref="manual" bare @busy="manualBusy = $event" />
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
import ManualEntryButton from '@/components/ManualEntryButton.vue'
import ReceiptsClosedSheet from '@/components/ReceiptsClosedSheet.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useReceiptsAccess } from '@/composables/useReceiptsAccess'
import type { ReceiptsClosedWay } from '@/composables/useReceiptsAccess'
import { useReconnect } from '@/composables/useReconnect'
import { afterStep, useNavigation } from '@/navigation'
import { useActorStore } from '@/stores/actor'
import { useFeedbackSheetStore } from '@/stores/feedbackSheet'

/**
 * «Сфотографировать чек» (MOL-127, handoff 01–03): the main action of the strip on «Что брать» and
 * «Покупки» in the version «с чеком» (Д-3). A receipt sent from «Что брать» opens «Покупки», so the
 * person sees its row come (handoff v1, 03); «Чек отправлен» is said there and shown for a moment
 * in place of the strip's «Вернуть» (3d). A country whose receipts come by their link — Serbia
 * (MOL-232) — takes the same button to a sheet that reads the QR code off the photo (MOL-233).
 *
 * **Where the model reads no more, the tap meets «Пробные чеки закончились» first** (MOL-276): at every tap where
 * nobody would read the receipt — the фф `payments` on, or Georgia — else once, the camera first in it (owner's В-1
 * «а»). Decided by `/actors/me` as last heard, asked again as the app comes back into view (Р-3); not known — a
 * launch offline, a server before MOL-275 — is no sheet, and the server decides who reads (Р-2).
 */
export default defineComponent({
  name: 'CaptureButton',
  components: {
    AppButton,
    CaptureSheet,
    IconCamera,
    LinkReceiptSheet,
    ManualEntryButton,
    ReceiptsClosedSheet,
  },
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
    const actor = useActorStore()
    const feedback = useFeedbackSheetStore()
    const { access, closed, othersRead, sheetFirst } = useReceiptsAccess()
    const closedOpen = ref(false)
    const closedShown = ref(false)
    const manualUsed = ref(false)
    const manualBusy = ref(false)
    const manual = ref<{ begin: () => void } | null>(null)
    let chosen: ReceiptsClosedWay | null = null
    watch([open, closedOpen, manualBusy], (ups) => {
      emit('busy', ups.includes(true))
    })

    // Where the person stands with the model is asked again as the app comes back (MOL-276, Р-3): the trial may
    // have ended on another phone, a grant come meanwhile. `verify` asks once for every button that asks with it.
    useReconnect(() => {
      if (actor.state === 'ready' && navigator.onLine) void actor.verify()
    })

    function camera(): void {
      mounted.value = true
      open.value = true
    }

    function choose(way: ReceiptsClosedWay): void {
      chosen = way
      if (way === 'manual') manualUsed.value = true
      closedOpen.value = false
    }

    // Every way waits for the step back of the sheet that offered it (`afterStep`), as «Записать вручную» does.
    function afterClosed(): void {
      const way = chosen
      chosen = null
      closedShown.value = false
      afterStep(() => {
        if (way === 'photo') camera()
        else if (way === 'manual') manual.value?.begin()
        // The plain way in, nothing attached: today the developer opens the reading by hand.
        else if (way === 'developer') feedback.open({ from: 'settings' })
      })
    }

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
      access,
      closed,
      othersRead,
      closedOpen,
      closedShown,
      manualUsed,
      manualBusy,
      manual,
      choose,
      afterClosed,
      // A photo country only: Serbia's receipt is read by its link, never by the model (MOL-232).
      opened: () => {
        if (photo.value && sheetFirst()) {
          closedShown.value = true
          closedOpen.value = true
        } else camera()
      },
      unmount: () => {
        mounted.value = false
      },
      sent,
    }
  },
})
</script>
