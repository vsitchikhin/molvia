<template>
  <AppScreen :title="t('spending.categories.title')">
    <div class="content">
      <!-- The answer's shape (Ф-13, 7f): the caption of «В выборе» and six rows of a circle, a name and
           the button — a `ListRow` in a plain `li`, so its tail stays beside the words at any width. -->
      <ScreenSkeleton v-if="phase === 'loading'">
        <SkeletonPart kind="caption" :width="22" />
        <SkeletonPart kind="rows" :count="6" lead="circle" :meta="false" tail :narrow="false" />
      </ScreenSkeleton>

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
          <section v-if="presets.length > 0" class="group">
            <SectionCaption>{{ t('spending.categories.presets') }}</SectionCaption>
            <AppCard as="ul" list>
              <AppReveal group>
                <li v-for="category in presets" :key="category.id">
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

          <!-- One's own opens its sheet — a name, an icon, a colour, and «Убрать» there (MOL-285, В-2
               «а»): a row that opens has the chevron and no button, and one card never mixes the two. -->
          <section v-if="own.length > 0" class="group">
            <SectionCaption>{{ t('spending.categories.own_group') }}</SectionCaption>
            <AppCard as="ul" list>
              <AppReveal group>
                <li v-for="category in own" :key="category.id">
                  <ListRow
                    :icon="iconOf(category)"
                    :tint="colourOf(category)"
                    :title="nameOf(category)"
                    wrap
                    next
                    @click="edit(category)"
                  >
                    <template v-if="waiting(category.id)" #below>
                      <AppTag tone="warn" :icon="IconUpload">{{ t('spending.pending') }}</AppTag>
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

    <!-- The main action in the strip over the tab bar, as on every screen of «Деньги» (Ф-28), over a list
         shown only — offline over it too, since the queue makes a category either way (В-4). Not under the
         skeleton (owner's В-2 «а» of MOL-191): the sheet knows one's own names from the list alone, and
         opened before it, it let one taken through to the server's refusal (adversarial А1); nor offline
         with nothing ever shown (7h), which took the strip from under an open sheet and its focus with it
         (А3). An error takes the strip for «Повторить» by itself. -->
    <template v-if="phase === 'ready'" #docked>
      <AppButton size="large" block @click="edit(null)">
        <template #icon><IconPlus /></template>
        {{ t('spending.categories.add') }}
      </AppButton>
    </template>

    <CategorySheet v-model:open="sheetOpen" :categories="all" :category="editing" />
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
import CategorySheet from '@/components/CategorySheet.vue'
import ListRow from '@/components/ListRow.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { categoriesWith, categoryColour, categoryIcon } from '@/components/spending'
import SectionCaption from '@/components/SectionCaption.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { reportFailure } from '@/failures'

/**
 * «Деньги → Категории» (MOL-82, В-1): the person's own list. «Убрать» takes a category out of the
 * choice and erases nothing — the spendings in it keep it, past months keep their sums (MOL-73,
 * В-3) — so it asks nothing, is no red word (Ф-34), and «Вернуть» stands right under it. One's own
 * stand apart and open their sheet, where the name, the icon and the colour are amended and «Убрать»
 * is (MOL-285, В-2 «а»). Every change goes through the
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
    CategorySheet,
    IconPlus,
    ListRow,
    ScreenSkeleton,
    ScreenState,
    SectionCaption,
    SkeletonPart,
  },
  setup() {
    const { t } = useI18n()
    const actor = useActorStore()
    const queue = useSpendingQueueStore()

    const server = ref<SpendingCategoryView[] | null>(null)
    const failure = ref<'error' | 'offline' | null>(null)
    const sheetOpen = ref(false)
    /** One's own the sheet amends; none while it makes a new one. */
    const editing = ref<SpendingCategoryView | null>(null)
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
    const presets = computed(() =>
      all.value.filter((category) => !category.archived && category.preset !== null),
    )
    const own = computed(() =>
      all.value.filter((category) => !category.archived && category.preset === null),
    )
    const archived = computed(() => all.value.filter((category) => category.archived))

    const nameOf = (category: SpendingCategoryView) =>
      category.preset ? t(`spending.category.${category.preset}`) : (category.name ?? '')
    const waiting = (id: string) =>
      queue.pending.some(
        (write) =>
          (write.kind === 'category-add' && write.body.id === id) ||
          (write.kind === 'category-amend' && write.id === id),
      )
    function edit(category: SpendingCategoryView | null): void {
      editing.value = category
      sheetOpen.value = true
    }
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
      presets,
      own,
      archived,
      sheetOpen,
      editing,
      edit,
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
