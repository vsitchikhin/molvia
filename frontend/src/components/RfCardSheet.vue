<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('pay.rf.title') }}</template>
    <p class="body">{{ t('pay.rf.body') }}</p>
    <template #footer>
      <AppButton size="large" block @click="$emit('update:open', false)">
        {{ t('pay.rf.ok') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { read, write } from '@/stores/storage'

/** The moment this device last tapped it: a repeat within a day is the same person, as the login's (MOL-68). */
const KEY = 'molvia.rf-card'
const DAY_MS = 24 * 60 * 60 * 1000

/** Whether this device tapped within the day before `now`; a moment from the future is no repeat. */
export function tappedWithinDay(kept: string | null, now: number): boolean {
  const at = Number(kept)
  return Number.isFinite(at) && at <= now && now - at < DAY_MS
}

/**
 * «Карты российских банков» (MOL-277, Р-8): the bank takes no card a Russian bank issued (MOL-282), and the sheet
 * says so; the tap is counted by the day, nobody named — how many come to pay with such a card alone decides
 * whether to look for a way. Sent once a tap, never retried: a count lost is a count, not a person's data.
 */
export default defineComponent({
  name: 'RfCardSheet',
  components: { AppButton, BottomSheet },
  props: { open: { type: Boolean, required: true } },
  emits: { 'update:open': (open: boolean) => typeof open === 'boolean' },
  setup(props) {
    const { t } = useI18n()
    watch(
      () => props.open,
      (open) => {
        if (!open) return
        const now = Date.now()
        const again = tappedWithinDay(read(KEY), now)
        write(KEY, String(now))
        api.rfCardTap(again).catch(() => undefined)
      },
    )
    return { t }
  },
})
</script>

<style scoped lang="scss">
.body {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
