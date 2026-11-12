<template>
  <div
    class="wallet-line"
    role="img"
    :aria-label="t('exchange.my_rate_line.aria', { rate: rateOf(own), cb: rateOf(track.official) })"
  >
    <span class="labels" :class="sideOf(track.own)"
      ><span class="label">{{ t('exchange.my_rate_line.mine', { rate: rateOf(own) }) }}</span></span
    >
    <span class="line">
      <span class="rail"></span>
      <TrackSpot :at="track.own"><span class="own"></span></TrackSpot>
      <TrackSpot :at="track.officialAt"><span class="cb"></span></TrackSpot>
    </span>
    <span class="labels" :class="sideOf(track.officialAt)"
      ><span class="label">{{
        t('exchange.my_rate_line.cb_today', { rate: rateOf(track.official) })
      }}</span></span
    >
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { CHART_LEVEL, formatRate } from '@molvia/model'
import type { ExchangeRate, ExchangesResponse } from '@molvia/model'
import TrackSpot from '@/components/TrackSpot.vue'

/**
 * «мой — ЦБ РА сегодня» under «Мой курс» (MOL-348, handoff 04, Р-19): two dots on one line, each where
 * the server put it (`walletTrack`) — the lower printed figure left — and no tone: the central bank is
 * never a verdict (MOL-187). A label stands over or under its dot's end of the line, never centred on
 * the dot: centred on a dot at 150 or 850, «ЦБ РА сегодня 4,90 ֏/₽» hung past the card on 320 and took
 * the page sideways at 150 % and 200 % (adversarial Б1). It wraps within the card, as large text needs.
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
    /** The end of the line a dot is at: a third of it at each end, the middle between. */
    const sideOf = (at: number) =>
      at < CHART_LEVEL / 3 ? 'start' : at > (CHART_LEVEL * 2) / 3 ? 'end' : 'middle'
    return { t, sideOf, rateOf: (rate: ExchangeRate) => formatRate(rate, locale.value) }
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

/* The dots keep a little room from the card's edges; the labels have its whole width. */
.line {
  display: grid;
  height: 16px;
  padding: 0 var(--space-6);

  > * {
    grid-area: 1 / 1;
  }
}

.rail {
  align-self: center;
  height: 2px;
  background: var(--border-strong);
}

.labels {
  display: flex;

  &.start {
    justify-content: flex-start;
    text-align: start;
  }

  &.middle {
    justify-content: center;
    text-align: center;
  }

  &.end {
    justify-content: flex-end;
    text-align: end;
  }
}

.label {
  min-width: 0;
  color: var(--text-muted);
  overflow-wrap: anywhere;
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
