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

        <div class="lists">
          <section class="group">
            <SectionCaption>{{ t('spending.categories.live') }}</SectionCaption>
            <AppCard as="ul" list>
              <AppReveal group>
                <li v-for="category in live" :key="category.id">
                  <ListRow
                    as="div"
                    :icon="iconOf(category)"
                    :tint="colourOf(category)"
                    :title="nameOf(category)"
                    :meta="category.preset ? '' : t('spending.categories.own')"
                    wrap
                  >
                    <template v-if="waiting(category.id)" #below>
                      <AppTag tone="warn" :icon="IconUpload">{{ t('spending.pending') }}</AppTag>
                    </template>
                    <template #tail>
                      <AppButton
                        variant="ghost"
                        :aria-label="
                          t('spending.categories.remove_label', { name: nameOf(category) })
                        "
                        @click="queue.archiveCategory(category.id, true)"
                      >
                        {{ t('spending.categories.remove') }}
                      </AppButton>
                    </template>
                  </ListRow>
                </li>
              </AppReveal>
            </AppCard>
          </section>

          <section v-if="archived.length > 0" class="group">
            <SectionCaption>{{ t('spending.categories.archived') }}</SectionCaption>
            <AppCard as="ul" list>
              <AppReveal group>
                <li v-for="category in archived" :key="category.id">
                  <ListRow
                    as="div"
                    :icon="iconOf(category)"
                    :tint="colourOf(category)"
                    :title="nameOf(category)"
                    wrap
                  >
                    <template #tail>
                      <AppButton
                        variant="ghost"
                        :aria-label="
                          t('spending.categories.restore_label', { name: nameOf(category) })
                        "
                        @click="queue.archiveCategory(category.id, false)"
                      >
                        {{ t('spending.restore') }}
                      </AppButton>
                    </template>
                  </ListRow>
                </li>
              </AppReveal>
            </AppCard>
          </section>
          <p class="note">{{ t('spending.categories.note') }}</p>
        </div>
      </template>
    </div>

    <!-- The main action in the strip over the tab bar, as on every screen of «Деньги» (Ф-28): while the
         list is coming too — the queue makes a category with or without the answer (В-4) — but not
         offline with nothing ever shown (7h). An error takes the strip for «Повторить» by itself. -->
    <template v-if="phase === 'loading' || phase === 'ready'" #docked>
      <AppButton size="large" block @click="newOpen = true">
        <template #icon><IconPlus /></template>
        {{ t('spending.categories.add') }}
      </AppButton>
    </template>

    <NewCategorySheet v-model:open="newOpen" :categories="all" />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, markRaw, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconUpload from '~icons/mdi/cloud-upload-outline'
import IconPlus from '~icons/mdi/plus'
import type { SpendingCategoryView, WireCode } from '@molvia/model'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import AppTag from '@/components/AppTag.vue'
import ListRow from '@/components/ListRow.vue'
import NewCategorySheet from '@/components/NewCategorySheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { categoriesWith, categoryColour, categoryIcon } from '@/components/spending'
import SectionCaption from '@/components/SectionCaption.vue'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { reportFailure } from '@/failures'

/**
 * «Деньги → Категории» (MOL-82, В-1): the person's own list. «Убрать» takes a category out of the
 * choice and erases nothing — the spendings in it keep it, past months keep their sums (MOL-73,
 * В-3) — so it asks nothing, is no red word (Ф-34), and «Вернуть» stands right under it. Every change goes through the
 * queue (В-4); the list is the server's with what waits laid over it.
 */
export default defineComponent({
  name: 'MoneyCategoriesView',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    AppTag,
    IconPlus,
    ListRow,
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
      iconOf: categoryIcon,
      IconUpload: markRaw(IconUpload),
      load,
    }
  },
})
</script>

<style scoped lang="scss">
/* The field is `AppScreen`'s 16 (С-23); between the refusals and the lists, 24. */
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-6);
}

/* A caption and its card stand in a block of their own, its 8 the caption's; 24 between the groups
   and 8 from the last card to the note (handoff 06). */
.lists {
  display: flex;
  flex-direction: column;
}

.group + .group {
  margin-top: var(--space-6);
}

.note {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

/* The answer comes in where the skeleton stood, faded only: the screen keeps it in one block of its
   own, which `AppScreen` does not see, and nothing under the thumb may move (review №5, MOL-138). */
.content > * {
  @include appear(0);
}
</style>
