<template>
  <AppScreen :title="t('pay.title')">
    <ScreenSkeleton v-if="phase === 'loading'">
      <SkeletonPart kind="caption" />
      <SkeletonPart kind="rows" :count="3" lead="icon" tail />
    </ScreenSkeleton>

    <ScreenState
      v-else-if="phase === 'error'"
      kind="error"
      :title="t('pay.load_error.title')"
      :body="t('pay.load_error.body')"
      @retry="retry"
    />

    <ScreenState
      v-else-if="phase === 'offline'"
      kind="offline"
      tone="warn"
      :title="t('pay.offline.title')"
      :body="t('pay.offline.body')"
    />

    <!-- No price today is the world's state, not our failure (Р-1): said, and asked again on return. -->
    <ScreenState
      v-else-if="phase === 'unpriced'"
      kind="attention"
      :title="t('pay.unpriced.title')"
      :body="t('pay.unpriced.body')"
    />

    <template v-else-if="offer && offer.tariffs">
      <section class="group">
        <SectionCaption>{{ t('pay.group_tariffs') }}</SectionCaption>
        <AppCard as="ul" list role="radiogroup" :aria-label="t('pay.group_tariffs')">
          <li v-for="choice in offer.tariffs" :key="choice.tariff">
            <ListRow
              role="radio"
              :aria-checked="chosen === choice.tariff"
              :selected="chosen === choice.tariff"
              :icon="ICONS[choice.tariff]"
              :title="t(`pay.tariff.${choice.tariff}`)"
              :meta="metaOf(choice)"
              whole
              @click="chosen = choice.tariff"
            >
              <template #tail>
                <span class="price">
                  <span class="dollars">{{ dollars(choice.cents) }}</span>
                  <span class="drams">{{ money(choice.amount) }}</span>
                </span>
              </template>
            </ListRow>
          </li>
        </AppCard>
        <p class="note">{{ t('pay.note') }}</p>
      </section>

      <section v-if="offer.tips" class="group">
        <SectionCaption>{{ t('pay.group_tip') }}</SectionCaption>
        <AppCard as="ul" list>
          <li v-for="tip in offer.tips" :key="tip.cents">
            <ListRow
              :title="`${dollars(tip.cents)} · ${money(tip.amount)}`"
              :meta="starting === String(tip.cents) ? t('pay.starting') : ''"
              :inactive="starting !== null"
              next
              @click="payTip(tip.cents)"
            />
          </li>
        </AppCard>
      </section>
    </template>

    <template v-if="phase === 'ready'" #docked>
      <p v-if="refused" :id="`${id}-refused`" class="refused">{{ t(refusalKey(refused)) }}</p>
      <AppButton
        size="large"
        block
        :busy="starting === chosen"
        :busy-label="t('pay.starting')"
        :inactive="starting !== null && starting !== chosen"
        :aria-describedby="refused ? `${id}-refused` : undefined"
        @click="payTariff"
      >
        {{ t('pay.pay', { amount: chosenAmount }) }}
      </AppButton>
      <AppButton variant="ghost" block @click="rfCardOpen = true">
        {{ t('pay.rf_card') }}
      </AppButton>
    </template>

    <RfCardSheet v-model:open="rfCardOpen" />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import IconBoth from '~icons/mdi/check-all'
import IconData from '~icons/mdi/account-group-outline'
import IconReceipt from '~icons/mdi/receipt-text-outline'
import { formatMoney, pickLocale } from '@molvia/model'
import type { Money, TariffOffer } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import ListRow from '@/components/ListRow.vue'
import RfCardSheet from '@/components/RfCardSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import { openBankPage } from '@/bankPage'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useLocalDay } from '@/composables/useLocalDay'
import { usePaymentOffer } from '@/composables/usePaymentOffer'
import type { StartRefusal } from '@/composables/usePaymentOffer'
import { dateOfAnyYear } from '@/days'

type Tariff = TariffOffer['tariff']

/** The server's refusal says it in the error's own words, the connection's in the screen's. */
function refusalKey(refusal: StartRefusal): string {
  switch (refusal) {
    case 'day_limited':
      return 'error.payments_day_limited'
    case 'unpriced':
      return 'error.payment_unpriced'
    case 'bank':
      return 'error.payment_channel_unavailable'
    default:
      return `pay.refused.${refusal}`
  }
}

const ICONS = { data: IconData, receipts: IconReceipt, both: IconBoth } as const

/**
 * «Оплата» (MOL-277, the lavish's mockup, В-6 «а»): three tariffs of thirty days, one chosen, one primary button —
 * «Оплатить картой N ֏» — the bank's page after it; the tips at the bottom, each its own way to the bank (В-4 «а»),
 * and «У меня только карта РФ» (Р-8). Every price and every date is the server's: until when each term is open now
 * and until when it would be once paid. Opened with `?tariff=` chosen — the receipts' sheet and the settings' row.
 */
export default defineComponent({
  name: 'PayView',
  components: {
    AppButton,
    AppCard,
    AppScreen,
    ListRow,
    RfCardSheet,
    ScreenSkeleton,
    ScreenState,
    SectionCaption,
    SkeletonPart,
  },
  setup() {
    const { t, locale } = useI18n()
    const id = useId()
    const route = useRoute()
    const today = useLocalDay()
    const announce = useAnnouncer()
    const asked = route.query.tariff
    const chosen = ref<Tariff>(asked === 'data' || asked === 'both' ? asked : 'receipts')
    const rfCardOpen = ref(false)
    const state = usePaymentOffer(openBankPage)
    const lang = computed(() => pickLocale(locale.value))

    const money = (amount: Money): string => formatMoney(amount, locale.value)
    const dollars = (cents: number): string =>
      formatMoney({ minor: BigInt(cents), currency: 'USD' }, locale.value)
    const day = (when: Date): string => dateOfAnyYear(when, locale.value, today.value, 'long')

    /** Where each term stands now and where it would go: «открыто до 3 декабря → до 2 января». */
    function metaOf(choice: TariffOffer): string {
      const access = state.offer.value?.access
      if (!access) return ''
      // the server names a term already over as none: «open until» is only ever a term still running
      const part = (now: Date | null, after: Date | null): string =>
        after === null
          ? ''
          : now === null
            ? t('pay.meta.opens', { after: day(after) })
            : t('pay.meta.extends', { now: day(now), after: day(after) })
      if (choice.tariff === 'data') return part(access.shared, choice.after.shared)
      if (choice.tariff === 'receipts') {
        return `${t('pay.meta.receipts')} · ${part(access.receipts, choice.after.receipts)}`
      }
      return t('pay.meta.both')
    }

    const chosenAmount = computed(() => {
      const offer = state.offer.value?.tariffs?.find((choice) => choice.tariff === chosen.value)
      return offer ? money(offer.amount) : ''
    })

    async function payTariff(): Promise<void> {
      await state.start({ tariff: chosen.value }, lang.value)
    }
    async function payTip(cents: number): Promise<void> {
      await state.start({ tariff: 'tip', tipCents: cents }, lang.value)
    }
    watch(state.refused, (refusal) => {
      if (refusal) announce?.(t(refusalKey(refusal)))
    })

    return {
      t,
      refusalKey,
      id,
      ICONS,
      chosen,
      rfCardOpen,
      ...state,
      money,
      dollars,
      metaOf,
      chosenAmount,
      payTariff,
      payTip,
    }
  },
})
</script>

<style scoped lang="scss">
.group + .group {
  margin-top: var(--space-6);
}

.note {
  margin: var(--space-3) 0 0;
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.price {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.dollars {
  font-weight: var(--weight-medium);
}

.drams {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.refused {
  margin: 0;
  color: var(--bad-ink);
  font-size: var(--text-footnote);
  overflow-wrap: anywhere;
}
</style>
