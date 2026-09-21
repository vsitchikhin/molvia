<template>
  <div class="notes" :class="{ empty: !jump && !fallback && !stale }">
    <!-- A jump is flagged, never refused (MOL-39, owner's decision): the rate may have truly
         moved, and only the person knows which number their money changed at. -->
    <div v-if="jump" class="note warn">
      <p class="title">{{ t('trip.rate.jump_title') }}</p>
      <p class="body">{{ jump }}</p>
      <AppButton variant="ghost" @click="choosing = true">{{ t('trip.rate.choose') }}</AppButton>
    </div>

    <!-- Not the central bank of Armenia. Named, not hinted at: the person trusts the number by
         where it came from, and the aggregator's terms require its name beside it. -->
    <p v-if="fallback" class="note good">
      {{ t('trip.rate.fallback') }}
      <a v-if="link" class="link" :href="link" target="_blank" rel="noopener noreferrer">{{
        sourceName
      }}</a>
      <template v-else>{{ sourceName }}</template>
    </p>

    <p v-if="stale" class="note quiet">{{ stale }}</p>

    <!-- Outside anything conditional, like the sheets of «Поход»: the trip can lose its jump
         while the sheet is up — finished on another device — and a sheet taken away mid-air
         leaves its history entry behind (MOL-18; В2, мелочи). -->
    <TripRateSheet v-model:open="choosing" :trip="trip" />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatRate } from '@molvia/model'
import type { RateProvider, TripView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import TripRateSheet from '@/components/TripRateSheet.vue'
import { purchaseDay } from '@/days'

/** What the terms of the open aggregator ask for beside its rate; the banks need no link. */
const LINKS: Partial<Record<RateProvider, string>> = {
  erapi: 'https://www.exchangerate-api.com',
}

/**
 * What is worth knowing about the rate a trip counts by, and nothing more: it jumped, it is not
 * the central bank's, or the bank has published nothing for over a week (MOL-39).
 *
 * The three are not one text. «Курс на 1 сентября, с тех пор ЦБ РА не менялся» is false about a
 * rate that came from an open source, so a stale fallback says something else; and «not the
 * central bank» has to name the source it is instead, because a person weighs a number by who
 * published it.
 */
export default defineComponent({
  name: 'TripRateNotes',
  components: { AppButton, TripRateSheet },
  props: {
    trip: { type: Object as PropType<TripView>, required: true },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const choosing = ref(false)

    const provider = computed(() => props.trip.rateProvider)
    const sourceName = computed(() =>
      provider.value ? t(`trip.rate.source_${provider.value}`) : '',
    )
    const link = computed(() => (provider.value ? LINKS[provider.value] : undefined))

    const fallback = computed(() => props.trip.rate?.source === 'fallback')

    const stale = computed(() => {
      const rate = props.trip.rate
      if (!props.trip.rateStale || !rate) return null
      const date = purchaseDay(rate.asOf, locale.value)
      return fallback.value
        ? t('trip.rate.stale_fallback', { date })
        : t('trip.rate.stale_official', { date })
    })

    const jump = computed(() => {
      const jumped = props.trip.rateJump
      if (!jumped) return null
      const now = formatRate(jumped.jumped, locale.value)
      const previous = jumped.previous
      return previous
        ? t('trip.rate.jump_previous', {
            rate: now,
            previous: formatRate(previous, locale.value),
            date: purchaseDay(previous.asOf, locale.value),
          })
        : t('trip.rate.jump_alone', { rate: now })
    })

    return { t, choosing, fallback, sourceName, link, stale, jump }
  },
})
</script>

<style scoped lang="scss">
/* No notes — nothing to take room: the screen has enough of its own. A class rather than
   `:has()`, which older WebViews do not know. */
.empty {
  display: contents;
}

.notes {
  display: grid;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.note {
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  font-size: var(--text-footnote);
}

.warn {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
  background: var(--warn-tint);
  color: var(--warn-ink);
}

.good {
  background: var(--good-tint);
  color: var(--good-ink);
}

/* «The rate is of its date» is a fact, not a warning: no tint, no colour of its own. */
.quiet {
  padding: 0 var(--space-3);
  color: var(--text-muted);
}

.title {
  margin: 0;
  font-weight: var(--weight-medium);
}

.body {
  margin: 0;
}

.link {
  color: inherit;
}
</style>
