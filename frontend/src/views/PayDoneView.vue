<template>
  <AppScreen :title="t('pay.title')">
    <ScreenSkeleton v-if="phase === 'loading'">
      <SkeletonPart kind="lines" :count="2" />
    </ScreenSkeleton>

    <ScreenState
      v-else-if="phase === 'error'"
      kind="error"
      :title="t('pay.done.error.title')"
      :body="t('pay.done.error.body')"
      @retry="ask"
    />

    <ScreenState
      v-else-if="phase === 'offline'"
      kind="offline"
      tone="warn"
      :title="t('pay.done.offline.title')"
      :body="t('pay.done.offline.body')"
    />

    <ScreenState
      v-else-if="phase === 'missing'"
      kind="attention"
      :title="t('pay.done.missing.title')"
      :body="t('pay.done.missing.body')"
    />

    <!-- The bank has not said yet: the server's minute asks it too, so the screen may be left (requirement 5). -->
    <ScreenState
      v-else-if="phase === 'waiting'"
      kind="attention"
      :title="t('pay.done.waiting.title')"
      :body="t('pay.done.waiting.body')"
    />

    <ScreenState
      v-else-if="phase === 'failed'"
      kind="attention"
      :title="t('pay.done.failed.title')"
      :body="t('pay.done.failed.body')"
    >
      <template #action>
        <AppButton size="large" block @click="go('pay')">
          {{ t('pay.done.failed.again') }}
        </AppButton>
      </template>
    </ScreenState>

    <section v-else-if="status" class="paid" aria-labelledby="paid-title">
      <AppCard>
        <h2 id="paid-title" class="paid-title">{{ t(`pay.done.${status.state}.title`) }}</h2>
        <p class="paid-body">{{ paidWords }}</p>
      </AppCard>
    </section>

    <template v-if="phase === 'paid'" #docked>
      <AppButton size="large" block @click="go('advice')">
        {{ t('pay.done.ok') }}
      </AppButton>
    </template>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { resourceIdOf } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import { useLocalDay } from '@/composables/useLocalDay'
import { usePaymentStatus } from '@/composables/usePaymentStatus'
import { dateOfAnyYear } from '@/days'

/**
 * The page the bank sends the browser back to (MOL-277, requirement 5, `BackURL`): a screen of the app, opened from
 * the cache by the bank's navigation, which asks the API by its own `fetch` (MOL-368 holds). It never believes the
 * address the bank came back with — `resposneCode=00` is typed by hand as easily — only the server's word on the
 * payment, which the server takes from the bank by its own saved id.
 */
export default defineComponent({
  name: 'PayDoneView',
  components: { AppButton, AppCard, AppScreen, ScreenSkeleton, ScreenState, SkeletonPart },
  setup() {
    const { t, locale } = useI18n()
    const route = useRoute()
    const router = useRouter()
    const today = useLocalDay()
    const { status, phase, ask } = usePaymentStatus(
      computed(() => resourceIdOf(route.params.paymentId)),
    )

    /** «Распознавание чеков открыто до 20 декабря» — the access the payment opened, by the server's dates. */
    const paidWords = computed(() => {
      const shown = status.value
      if (!shown) return ''
      if (shown.state === 'refunded') return t('pay.done.refunded.body')
      if (shown.tariff === 'tip') return t('pay.done.paid.tip')
      const day = (when: Date) => dateOfAnyYear(when, locale.value, today.value, 'long')
      const { shared, receipts } = shown.access
      if (shown.tariff === 'both' && shared && receipts) {
        return t('pay.done.paid.both', { shared: day(shared), receipts: day(receipts) })
      }
      if (shown.tariff === 'data' && shared) return t('pay.done.paid.data', { until: day(shared) })
      if (shown.tariff === 'receipts' && receipts) {
        return t('pay.done.paid.receipts', { until: day(receipts) })
      }
      return t('pay.done.paid.plain')
    })

    /** Out of the return page, never back to it: the bank's page and this one are behind. */
    function go(name: 'pay' | 'advice'): void {
      void router.replace({ name })
    }

    return { t, status, phase, paidWords, ask, go }
  },
})
</script>

<style scoped lang="scss">
.paid-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-headline);
}

.paid-body {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
