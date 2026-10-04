<template>
  <AppScreen :title="t('spending.categories.title')">
    <div class="content">
      <ScreenSkeleton v-if="phase === 'loading'" :groups="[56, 72, 64, 48, 60]" />

      <ScreenState
        v-else-if="phase === 'error'"
        kind="error"
        :title="t('spending.categories.load_error.title')"
        :body="t('spending.categories.load_error.body')"
        @retry="load"
      />

      <ScreenState
        v-else-if="phase === 'offline'"
        kind="offline"
        tone="warn"
        :title="t('spending.categories.offline.title')"
        :body="t('spending.categories.offline.body')"
      />

      <template v-else-if="phase === 'ready'">
        <AppReveal group>
          <ScreenState
            v-for="item in refusals"
            :key="item.key"
            kind="attention"
            inline
            :title="t('spending.rejected_other.title')"
            :body="reasonOf(item.code)"
          >
            <template #action>
              <AppButton variant="ghost" @click="queue.dismiss(item)">
                {{ t('spending.sheet.dismiss') }}
              </AppButton>
            </template>
          </ScreenState>
        </AppReveal>

        <AppButton block @click="newOpen = true">
          <template #icon><IconPlus /></template>
          {{ t('spending.categories.add') }}
        </AppButton>

        <section class="group">
          <SectionCaption class="caption">{{ t('spending.categories.live') }}</SectionCaption>
          <AppCard as="ul" list>
            <AppReveal group>
              <li v-for="category in live" :key="category.id" class="row">
                <span
                  class="dot"
                  :style="{ background: colourOf(category) }"
                  aria-hidden="true"
                ></span>
                <span class="name">
                  {{ nameOf(category) }}
                  <span v-if="!category.preset" class="own">{{
                    t('spending.categories.own')
                  }}</span>
                  <span v-if="waiting(category.id)" class="waiting">{{
                    t('spending.pending')
                  }}</span>
                </span>
                <AppButton
                  variant="danger-ghost"
                  :aria-label="t('spending.categories.remove_label', { name: nameOf(category) })"
                  @click="queue.archiveCategory(category.id, true)"
                >
                  {{ t('spending.categories.remove') }}
                </AppButton>
              </li>
            </AppReveal>
          </AppCard>
        </section>

        <template v-if="archived.length > 0">
          <section class="group">
            <SectionCaption class="caption">{{ t('spending.categories.archived') }}</SectionCaption>
            <AppCard as="ul" list>
              <AppReveal group>
                <li v-for="category in archived" :key="category.id" class="row">
                  <span
                    class="dot"
                    :style="{ background: colourOf(category) }"
                    aria-hidden="true"
                  ></span>
                  <span class="name">{{ nameOf(category) }}</span>
                  <AppButton
                    variant="ghost"
                    :aria-label="t('spending.categories.restore_label', { name: nameOf(category) })"
                    @click="queue.archiveCategory(category.id, false)"
                  >
                    {{ t('spending.restore') }}
                  </AppButton>
                </li>
              </AppReveal>
            </AppCard>
          </section>
        </template>
        <p class="note">{{ t('spending.categories.note') }}</p>
      </template>
    </div>

    <NewCategorySheet v-model:open="newOpen" :categories="all" />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconPlus from '~icons/mdi/plus'
import type { SpendingCategoryView, WireCode } from '@molvia/model'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import NewCategorySheet from '@/components/NewCategorySheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { categoriesWith, categoryColour } from '@/components/spending'
import SectionCaption from '@/components/SectionCaption.vue'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { reportFailure } from '@/failures'

/**
 * «Деньги → Категории» (MOL-82, В-1): the person's own list. «Убрать» takes a category out of the
 * choice and erases nothing — the spendings in it keep it, past months keep their sums (MOL-73,
 * В-3) — so it asks nothing, and «Вернуть» stands right under it. Every change goes through the
 * queue (В-4); the list is the server's with what waits laid over it.
 */
export default defineComponent({
  name: 'MoneyCategoriesView',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    IconPlus,
    NewCategorySheet,
    ScreenSkeleton,
    ScreenState,
    SectionCaption,
  },
  setup() {
    const { t } = useI18n()
    const actor = useActorStore()
    const queue = useSpendingQueueStore()

    const server = ref<SpendingCategoryView[] | null>(null)
    const failure = ref<'error' | 'offline' | null>(null)
    const newOpen = ref(false)
    let latest = 0

    async function load(): Promise<void> {
      if (!actor.id) return
      const mine = ++latest
      try {
        const answer = await api.spendingCategories()
        if (mine !== latest) return
        server.value = answer.categories
        failure.value = null
      } catch (error) {
        reportFailure(error, 'screen')
        if (mine !== latest) return
        failure.value = navigator.onLine ? 'error' : 'offline'
      }
    }

    onMounted(() => void load())
    useReconnect(() => void load())
    watch(
      () => actor.id,
      () => void load(),
    )
    watch(
      () => queue.landed,
      () => void load(),
    )

    const phase = computed(() => {
      if (server.value) return 'ready'
      return failure.value ?? 'loading'
    })
    const all = computed(() =>
      categoriesWith(server.value ?? [], [...queue.arrived, ...queue.pending]),
    )
    const live = computed(() => all.value.filter((category) => !category.archived))
    const archived = computed(() => all.value.filter((category) => category.archived))

    const nameOf = (category: SpendingCategoryView) =>
      category.preset ? t(`spending.category.${category.preset}`) : (category.name ?? '')
    const waiting = (id: string) =>
      queue.pending.some((write) => write.kind === 'category-add' && write.body.id === id)
    const refusals = computed(() =>
      queue.rejected.filter((item) => item.write.kind.startsWith('category-')),
    )
    const reasonOf = (code: WireCode) =>
      code.startsWith('error.') ? t(code) : t('spending.rejected_other.unknown', { code })

    return {
      t,
      queue,
      phase,
      all,
      live,
      archived,
      newOpen,
      nameOf,
      waiting,
      refusals,
      reasonOf,
      colourOf: categoryColour,
      load,
    }
  },
})
</script>

<style scoped lang="scss">
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-3);
  padding: var(--space-4);
}

/* A caption and its card stand in a block of their own: in the content's gap the 8 under it would be 20. */
.caption {
  margin-top: var(--space-3);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-target-lg);
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-4);

  & + & {
    border-top: var(--hairline) solid var(--border);
  }
}

.dot {
  flex: none;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-pill);
}

.name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-body);
  overflow-wrap: anywhere;
}

.own,
.waiting {
  margin-left: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.waiting {
  color: var(--warn-ink);
}

.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

/* The answer comes in where the skeleton stood, faded only: the screen keeps it in one block of its
   own, which `AppScreen` does not see, and nothing under the thumb may move (review №5, MOL-138). */
.content > * {
  @include appear(0);
}
</style>
