<template>
  <div class="home">
    <!-- The headline speaks of the queue of verdicts, and only of one known: «первые покупки»
         over a queue not yet answered told a person with twelve purchases they had none
         (adversarial В) — so until it answers, the skeleton; with no answer to be had, nothing. -->
    <div v-if="variant !== 'unknown'" class="intro">
      <h2 class="intro-title">{{ t(INTRO[variant].title) }}</h2>
      <p class="intro-body">{{ t(INTRO[variant].body, { app: t('app.name') }) }}</p>
    </div>
    <ScreenSkeleton v-else-if="asking" :groups="[70]" />

    <!-- (б): the first receipt is being read (MOL-127) — its row, which leads to «Покупки». -->
    <AppReveal>
      <AppCard v-if="variant === 'parsing' && reading" class="pending" list>
        <PurchaseRow
          :icon="IconSync"
          :title="t('purchases.group_working')"
          :meta="t('purchases.parsing_unknown')"
          @open="goTab('purchases')"
        />
      </AppCard>
    </AppReveal>

    <!-- (в): purchases recorded and none rated — the one thing left to do, and where. -->
    <AppReveal>
      <AppCard v-if="pending > 0" class="pending" list>
        <PurchaseRow
          :icon="IconStar"
          accent
          :title="t('verdict.pending_count', { n: pending }, pending)"
          :meta="pendingFrom"
          @open="goTab('verdicts')"
        />
      </AppCard>
    </AppReveal>

    <p class="caption">{{ t('advice.home.next') }}</p>
    <!-- The cycle explains the tab bar too: every step wears its tab's icon. The steps that lead
         to another tab are buttons; the last is this screen, and nothing to tap. -->
    <AppCard as="ol" list>
      <li>
        <button class="line link" type="button" @click="goTab('purchases')">
          <IconCart class="icon" aria-hidden="true" />
          <span class="text">
            <span class="title">{{
              t(
                country
                  ? 'advice.home.step_purchases_capture_title'
                  : 'advice.home.step_purchases_title',
              )
            }}</span>
            <span class="sub">{{
              t(
                country
                  ? 'advice.home.step_purchases_capture_body'
                  : 'advice.home.step_purchases_body',
              )
            }}</span>
          </span>
          <IconChevronRight class="chevron" aria-hidden="true" />
        </button>
      </li>
      <li>
        <button class="line link" type="button" @click="goTab('verdicts')">
          <IconStar class="icon" aria-hidden="true" />
          <span class="text">
            <span class="title">{{ t('advice.home.step_verdicts_title') }}</span>
            <span class="sub">{{ t('advice.home.step_verdicts_body') }}</span>
          </span>
          <IconChevronRight class="chevron" aria-hidden="true" />
        </button>
      </li>
      <li class="line">
        <IconLightbulb class="icon" aria-hidden="true" />
        <span class="text">
          <span class="title">{{ t('advice.home.step_advice_title') }}</span>
          <span class="sub">{{ t('advice.home.step_advice_body') }}</span>
        </span>
      </li>
    </AppCard>

    <!-- With receipts the strip holds the camera, and the record typed by hand is a row of its own
         under the cycle (2a): at the market, or with the receipt lost. -->
    <div v-if="country" class="by-hand">
      <ManualEntryButton by-hand />
      <p class="by-hand-note">{{ t('advice.home.manual_body') }}</p>
    </div>

    <p class="trust">{{ t('advice.home.trust') }}</p>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCart from '~icons/mdi/cart-outline'
import IconChevronRight from '~icons/mdi/chevron-right'
import IconLightbulb from '~icons/mdi/lightbulb-on-outline'
import IconStar from '~icons/mdi/star-outline'
import IconSync from '~icons/mdi/sync'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import ManualEntryButton from '@/components/ManualEntryButton.vue'
import PurchaseRow from '@/components/PurchaseRow.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import { usePendingFrom } from '@/composables/usePendingFrom'
import { useReceiptCapture } from '@/composables/useReceiptCapture'
import { WORKING, useReceipts } from '@/composables/useReceipts'
import { useVerdictQueue } from '@/composables/useVerdictQueue'
import { useNavigation } from '@/navigation'

/**
 * «Что брать» of a person it is known to be empty for (MOL-128, handoff `02`) — the first screen a
 * new person meets, and an offer to act rather than «no data». Moved here from «Поход» (MOL-77):
 * the cycle is the same, and it starts where the app now opens.
 *
 * With receipts (MOL-127, handoff v2 02): (а) «Сфотографируйте первый чек», (б) «Первый чек
 * разбираем» while one is read, (в) «Осталось оценить» once purchases wait for a verdict; the camera
 * stands in the strip, «Записать вручную» is a row under the cycle. Without (Д-3): (а) «Запишите
 * первые покупки» or (в), and «Записать покупки» in the strip.
 *
 * Only the person's own data: other people's figures are behind access (MOL-31).
 */
export default defineComponent({
  name: 'AdviceHomeNew',
  components: {
    AppCard,
    AppReveal,
    IconCart,
    IconChevronRight,
    IconLightbulb,
    IconStar,
    ManualEntryButton,
    PurchaseRow,
    ScreenSkeleton,
  },
  setup() {
    const { t } = useI18n()
    const { goTab } = useNavigation()
    const queue = useVerdictQueue()
    const pending = computed(() => queue.count.value)
    const { country } = useReceiptCapture()
    const receipts = useReceipts()
    const reading = computed(
      () =>
        country.value !== null && receipts.rows.value.some((row) => WORKING.includes(row.state)),
    )
    const INTRO = computed(() => ({
      pending: { title: 'advice.home.pending.title', body: 'advice.home.pending.body' },
      parsing: { title: 'advice.home.parsing.title', body: 'advice.home.parsing.body' },
      new: country.value
        ? { title: 'advice.home.new_capture.title', body: 'advice.home.new_capture.body' }
        : { title: 'advice.home.new.title', body: 'advice.home.new.body' },
    }))
    return {
      t,
      IconStar,
      IconSync,
      pending,
      country,
      reading,
      INTRO,
      variant: computed<'pending' | 'parsing' | 'new' | 'unknown'>(() => {
        if (pending.value > 0) return 'pending'
        if (reading.value) return 'parsing'
        return queue.phase.value === 'empty' ? 'new' : 'unknown'
      }),
      asking: computed(() => queue.phase.value === 'loading'),
      pendingFrom: usePendingFrom(queue),
      goTab: (tab: 'purchases' | 'verdicts') => void goTab(tab),
    }
  },
})
</script>

<style scoped lang="scss">
.home {
  display: flex;
  flex-direction: column;
}

.intro {
  padding: 0 var(--space-1);
}

.intro-title {
  @include display-type;

  margin: 0 0 var(--space-2);
  font-size: var(--text-title);
  line-height: var(--leading-tight);
  text-wrap: balance;
}

.intro-body {
  margin: 0;
  color: var(--text);
  font-size: var(--text-body);
  line-height: var(--leading-body);
}

.pending {
  margin-top: var(--space-4);
}

.caption {
  margin: var(--space-6) var(--space-1) var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.line {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-height: calc(var(--touch-target-lg) + var(--space-3));
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  color: var(--text);
  background: var(--surface);
  text-align: left;
  font: inherit;
}

/* At no weight, so the rule between rows stays `AppCard list`'s. */
:where(.line) {
  border: 0;
}

.link {
  cursor: pointer;

  &:hover {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.icon {
  @include icon;

  font-size: var(--icon-md);
  color: var(--text-muted);
}

.text {
  flex: 1;
  min-width: 0;
}

.title,
.sub {
  display: block;
  overflow-wrap: anywhere;
}

.title {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.sub {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.chevron {
  @include icon;

  font-size: var(--icon);
  color: var(--text-muted);
}

.by-hand {
  margin-top: var(--space-2);
}

.by-hand-note {
  margin: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: center;
}

.trust {
  margin: var(--space-4) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
