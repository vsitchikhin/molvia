<template>
  <div
    class="wallet-line"
    role="img"
    :aria-label="t('exchange.my_rate_line.aria', { rate: rateOf(own), cb: rateOf(track.official) })"
  >
    <span class="row">
      <TrackSpot :at="track.own"
        ><span class="label">{{
          t('exchange.my_rate_line.mine', { rate: rateOf(own) })
        }}</span></TrackSpot
      >
    </span>
    <span class="row line">
      <span class="rail"></span>
      <TrackSpot :at="track.own"><span class="own"></span></TrackSpot>
      <TrackSpot :at="track.officialAt"><span class="cb"></span></TrackSpot>
    </span>
    <span class="row">
      <TrackSpot :at="track.officialAt"
        ><span class="label">{{
          t('exchange.my_rate_line.cb_today', { rate: rateOf(track.official) })
        }}</span></TrackSpot
      >
    </span>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatRate } from '@molvia/model'
import type { ExchangeRate, ExchangesResponse } from '@molvia/model'
import TrackSpot from '@/components/TrackSpot.vue'

/**
 * «мой — ЦБ РА сегодня» under «Мой курс» (MOL-348, handoff 04, Р-19): two dots on one line, their
 * labels over and under them, each where the server put it (`walletTrack`) — the lower printed figure
 * left — and no tone: the central bank is never a verdict (MOL-187).
 */
export default defineComponent({
  name: 'WalletRateLine',
  components: { TrackSpot },
  props: {
    /** The person's own rate, as «Мой курс» prints it. */
    own: { type: Object as PropType<ExchangeRate>, required: true },
    track: {
      type: Object as PropType<NonNullable<ExchangesResponse['walletTrack']>>,
      required: true,
    },
  },
  setup() {
    const { t, locale } = useI18n()
    return { t, rateOf: (rate: ExchangeRate) => formatRate(rate, locale.value) }
  },
})
</script>

<style scoped lang="scss">
.wallet-line {
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-4);
  font-size: var(--text-footnote);
}

/* The labels' room at the ends: a label is centred on its dot and must stay inside the card. */
.row {
  display: grid;
  padding: 0 var(--space-6);

  > * {
    grid-area: 1 / 1;
  }
}

.line {
  height: 16px;
}

.rail {
  align-self: center;
  height: 2px;
  background: var(--border-strong);
}

.label {
  color: var(--text-muted);
  white-space: nowrap;
}

.own,
.cb {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
}

.own {
  background: var(--text);
}

.cb {
  border: 2px solid var(--graphic);
  background: var(--surface);
}
</style>
