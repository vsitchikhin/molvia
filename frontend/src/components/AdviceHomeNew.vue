<template>
  <div class="home">
    <!-- The headline speaks of the queue of verdicts, and only of one known: «первые покупки»
         over a queue not yet answered told a person with twelve purchases they had none
         (adversarial В) — so until it answers, the skeleton; with no answer to be had, nothing. -->
    <div v-if="variant !== 'unknown'" class="intro">
      <h2 class="intro-title">{{ t(INTRO[variant].title) }}</h2>
      <p class="intro-body">{{ t(INTRO[variant].body, { app: t('app.name') }) }}</p>
    </div>
    <!-- The headline's own shape while the queue is on its way, on the ground as the answer stands: a
         card of paragraphs left the cycle 70 px higher than the answer put it (MOL-178, adversarial А3
         of MOL-203). Its height is the words of the commonest answer, the queue empty, set unseen —
         a shape of fixed lines fitted one phone and one language and moved the cycle on the others
         (self-review 4); the bars stand over them. -->
    <ScreenSkeleton v-else-if="asking">
      <span class="intro ghost-intro">
        <span class="ghost-title" :data-words="t(INTRO.new.title)"
          ><span class="ghost-lines"
            ><span class="ghost-line"><span class="ghost-bar"></span></span></span
        ></span>
        <span class="ghost-body" :data-words="t(INTRO.new.body, { app: t('app.name') })"
          ><span class="ghost-lines"
            ><span v-for="width in [100, 94, 58]" :key="width" class="ghost-line"
              ><span class="ghost-bar" :style="{ width: `${width}%` }"></span></span></span
        ></span>
      </span>
    </ScreenSkeleton>

    <!-- (б): the first receipt is being read (MOL-127) — its row, which leads to «Покупки», and
         breathes as it does there (2c). -->
    <AppReveal>
      <AppCard v-if="variant === 'parsing' && reading" class="pending" list>
        <ListRow
          :class="{ breathing }"
          :icon="underWay?.state === 'parsing' ? IconSync : IconCloudUpload"
          :title="t('purchases.group_working')"
          :meta="underWayMeta ?? ''"
          wrap
          next
          @click="goTab('purchases')"
        />
      </AppCard>
    </AppReveal>

    <!-- (в): purchases recorded and none rated — the one thing left to do, and where. The star is a
         status, not a button (Ф-4): the chevron says the row opens. -->
    <AppReveal>
      <AppCard v-if="pending > 0" class="pending" list>
        <ListRow
          :icon="IconStar"
          :title="t('verdict.pending_count', { n: pending }, pending)"
          :meta="pendingFrom ?? ''"
          wrap
          next
          @click="goTab('verdicts')"
        />
      </AppCard>
    </AppReveal>

    <SectionCaption as="p" class="caption">{{ t('advice.home.next') }}</SectionCaption>
    <!-- The cycle explains the tab bar too: every step wears its tab's icon. The steps that lead
         to another tab are buttons; the last is this screen, and nothing to tap. -->
    <AppCard as="ol" list>
      <li>
        <ListRow
          :icon="IconCart"
          :title="
            t(
              country
                ? 'advice.home.step_purchases_capture_title'
                : 'advice.home.step_purchases_title',
            )
          "
          :meta="
            t(
              country
                ? 'advice.home.step_purchases_capture_body'
                : 'advice.home.step_purchases_body',
            )
          "
          wrap
          whole
          next
          @click="goTab('purchases')"
        />
      </li>
      <li>
        <ListRow
          :icon="IconStar"
          :title="t('advice.home.step_verdicts_title')"
          :meta="t('advice.home.step_verdicts_body')"
          wrap
          whole
          next
          @click="goTab('verdicts')"
        />
      </li>
      <li>
        <ListRow
          as="div"
          :icon="IconLightbulb"
          :title="t('advice.home.step_advice_title')"
          :meta="t('advice.home.step_advice_body')"
          wrap
          whole
        />
      </li>
    </AppCard>

    <!-- With receipts the strip holds the camera, and the record typed by hand is a row of its own
         under the cycle (2a): at the market, or with the receipt lost. -->
    <div v-if="country" class="by-hand">
      <ManualEntryButton row @busy="$emit('busy', $event)" />
    </div>

    <p class="trust">{{ t('advice.home.trust') }}</p>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCart from '~icons/mdi/cart-outline'
import IconLightbulb from '~icons/mdi/lightbulb-on-outline'
import IconStar from '~icons/mdi/star-outline'
import IconSync from '~icons/mdi/sync'
import IconCloudUpload from '~icons/mdi/cloud-upload-outline'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import ListRow from '@/components/ListRow.vue'
import ManualEntryButton from '@/components/ManualEntryButton.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import { usePendingFrom } from '@/composables/usePendingFrom'
import { useReceiptCapture } from '@/composables/useReceiptCapture'
import { UNDER_WAY, useReceipts } from '@/composables/useReceipts'
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
 * Every row is the kit's `ListRow` (MOL-203, Ф-12), its title wrapping, and a step's meta whole: a step
 * cut to «…» explains nothing. Its icon is muted — a status, never the accent of a button (Ф-4).
 *
 * Only the person's own data: other people's figures are behind access (MOL-31).
 */
export default defineComponent({
  name: 'AdviceHomeNew',
  components: {
    AppCard,
    AppReveal,
    ListRow,
    ManualEntryButton,
    ScreenSkeleton,
    SectionCaption,
  },
  emits: {
    /** «Записать вручную» has a sheet up: the screen keeps this mounted meanwhile (review 6, Р-15). */
    busy: (up: boolean) => typeof up === 'boolean',
  },
  setup() {
    const { t } = useI18n()
    const { goTab } = useNavigation()
    const queue = useVerdictQueue()
    const pending = computed(() => queue.count.value)
    const { country } = useReceiptCapture()
    const receipts = useReceipts()
    // Only a receipt being sent or read: a refused or stuck one is not «разбираем» (А4, review 11).
    const underWay = computed(() =>
      country.value === null
        ? null
        : (receipts.rows.value.find((row) => UNDER_WAY.includes(row.state)) ?? null),
    )
    const reading = computed(() => underWay.value !== null)
    // As on «Покупки»: with no connection nothing is being read, and nothing breathes.
    const breathing = computed(() => underWay.value?.state === 'parsing' && receipts.online.value)
    const underWayMeta = computed(() => {
      const row = underWay.value
      if (!row) return null
      // a receipt by its link has no parts: it is a link (MOL-232, MOL-233)
      const parts =
        row.parts === 0
          ? t('purchases.by_link')
          : t('receipt.capture.parts', { n: row.parts }, row.parts)
      if (row.state === 'waiting') return t('purchases.waiting', { parts })
      if (row.state === 'sending') return t('purchases.sending', { parts })
      return t('purchases.parsing_unknown')
    })
    const INTRO = computed(() => ({
      pending: { title: 'advice.home.pending.title', body: 'advice.home.pending.body' },
      parsing: { title: 'advice.home.parsing.title', body: 'advice.home.parsing.body' },
      new: country.value
        ? { title: 'advice.home.new_capture.title', body: 'advice.home.new_capture.body' }
        : { title: 'advice.home.new.title', body: 'advice.home.new.body' },
    }))
    return {
      t,
      IconCart,
      IconLightbulb,
      IconStar,
      IconSync,
      IconCloudUpload,
      underWay,
      underWayMeta,
      pending,
      country,
      reading,
      breathing,
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

.intro-title,
.ghost-title {
  @include display-type;

  margin: 0 0 var(--space-2);
  font-size: var(--text-title);
  line-height: var(--leading-tight);
  text-wrap: balance;
}

.intro-body,
.ghost-body {
  margin: 0;
  font-size: var(--text-body);
  line-height: var(--leading-body);
}

.intro-body {
  color: var(--text);
}

/* The words of the answer, unseen, give the skeleton its height: in an attribute, so no reader, no
   search of the page and no test of the text finds «первые покупки» over a queue not known (В). */
.ghost-intro,
.ghost-title,
.ghost-body {
  display: block;
}

.ghost-title,
.ghost-body {
  position: relative;

  &::before {
    visibility: hidden;
    content: attr(data-words);
  }
}

/* The bars over the first lines, each in the middle of its line; a phrase that takes more lines has
   them empty under the bars. */
.ghost-lines {
  position: absolute;
  inset: 0 0 auto;
  display: grid;
}

.ghost-line {
  display: flex;
  align-items: center;
}

.ghost-title .ghost-line {
  height: calc(var(--text-title) * var(--leading-tight));

  .ghost-bar {
    width: 64%;
  }
}

.ghost-body .ghost-line {
  height: calc(var(--text-body) * var(--leading-body));
}

.ghost-bar {
  @include skeleton-bar;

  height: var(--skeleton-line);
}

.pending {
  margin-top: var(--space-6);
}

.caption {
  margin-top: var(--space-6);
}

.breathing :deep(.icon) {
  @include work-breath;
}

.by-hand {
  margin-top: var(--space-2);
}

.trust {
  margin: var(--space-6) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
