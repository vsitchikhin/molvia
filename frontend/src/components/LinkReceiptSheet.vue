<template>
  <BottomSheet :open="open" :on-closed="closed" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('purchases.capture_link') }}</template>

    <div class="body">
      <p v-if="!online" class="notice">
        <IconCloudOff class="notice-icon" aria-hidden="true" />
        {{ t('receipt.capture.offline') }}
      </p>
      <p v-if="notKept" class="problem" role="alert">{{ t('receipt.capture.not_kept') }}</p>

      <ol class="steps">
        <li>{{ t('receipt.link.step_qr') }}</li>
        <li>{{ t('receipt.link.step_copy') }}</li>
        <li>{{ t('receipt.link.step_paste') }}</li>
      </ol>

      <AppField
        v-model="text"
        :label="t('receipt.link.field')"
        :error-text="refusal === null ? null : t(`receipt.link.refusal.${refusal}`)"
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="send"
        @keydown.enter.prevent="send"
      />
    </div>

    <template #footer>
      <AppButton size="large" block @click="send">{{ t('receipt.capture.send') }}</AppButton>
      <p v-if="!online" class="under">{{ t('receipt.capture.send_offline') }}</p>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import { LOCALES, serbianReceiptLink } from '@molvia/model'
import type { ReceiptLinkRefusal } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { useOnline } from '@/composables/useOnline'
import { newId } from '@/ids'
import { useReceiptQueueStore } from '@/stores/receiptQueue'

/**
 * «Чек по ссылке» (MOL-232, В-2): a Serbian receipt by the link of its QR code, pasted — the system
 * camera reads the code and opens the tax office's page, whose address is copied here. The link is
 * checked on the phone by the very function the server checks it by, and «Отправить чек» puts it in
 * the receipts' queue and closes: with a connection or without one, the sheet never waits on the
 * network (MOL-24). The tax office is asked by the server — the page cannot read its answer.
 */
export default defineComponent({
  name: 'LinkReceiptSheet',
  components: { AppButton, AppField, BottomSheet, IconCloudOff },
  props: {
    open: { type: Boolean, required: true },
    /** The sheet is put away — the opener unmounts it then, as the capture sheet's. */
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    /** Queued; called once the sheet is away, so the screen may move. */
    sent: (offline: boolean) => typeof offline === 'boolean',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const queue = useReceiptQueueStore()
    const online = useOnline()
    const text = ref('')
    const tried = ref(false)
    const notKept = ref(false)
    let sentOffline: boolean | null = null

    const read = computed(() => serbianReceiptLink(text.value))
    // Said once there is something to judge: a paste at once, an empty field only after «Отправить».
    const refusal = computed<ReceiptLinkRefusal | null>(() => {
      if (read.value.ok || (text.value.trim() === '' && !tried.value)) return null
      return read.value.reason
    })

    function send(): void {
      tried.value = true
      const link = read.value
      if (!link.ok) return
      const language = LOCALES.find((one) => one === locale.value) ?? 'ru'
      const kept = queue.sendLink({
        id: newId(),
        link: link.link,
        country: 'RS',
        language,
        capturedAt: new Date(),
      })
      if (!kept) {
        notKept.value = true
        return
      }
      sentOffline = !navigator.onLine
      emit('update:open', false)
    }

    function closed(): void {
      const offline = sentOffline
      sentOffline = null
      text.value = ''
      tried.value = false
      notKept.value = false
      if (offline !== null) emit('sent', offline)
      props.onClosed?.()
    }

    return { t, online, text, refusal, notKept, send, closed }
  },
})
</script>

<style scoped lang="scss">
.body {
  display: grid;
  gap: var(--space-3);
}

.notice,
.problem {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  font-size: var(--text-callout);
}

.notice {
  color: var(--text-muted);
  background: var(--surface-2);
}

.problem {
  color: var(--warn-ink);
  background: var(--warn-tint);
}

.notice-icon {
  @include icon;

  font-size: var(--icon-sm);
}

.steps {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding-left: var(--space-6);
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.under {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: center;
}
</style>
