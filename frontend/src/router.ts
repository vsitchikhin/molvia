import { START_LOCATION, createRouter, createWebHistory } from 'vue-router'
import type { NavigationGuard, RouteRecordRaw, Router, RouterScrollBehavior } from 'vue-router'
import type { FfName } from '@molvia/model'
import AdviceView from '@/views/AdviceView.vue'
import { lazyScreen } from '@/navigation'
import { sameScreen, watchBrowserAnimatedBack } from '@/transitions'
import { atNextFf, ffOn } from '@/stores/ff'
import { sheetOpen } from '@/composables/useSheetHistory'

/**
 * The five sections of the tab bar. «advice» is home (MOL-128): at the shelf a person reads, at
 * home they write — so the app opens on «Что брать», and «Покупки» is where the writing is.
 */
export type Tab = 'advice' | 'purchases' | 'verdicts' | 'money' | 'settings'

export type RouteName =
  | 'advice'
  | 'purchases'
  | 'purchase-manual'
  | 'purchase-receipt'
  | 'verdicts'
  | 'money'
  | 'money-spendings'
  | 'money-budget'
  | 'money-categories'
  | 'money-charts'
  | 'money-accounts'
  | 'money-account'
  | 'settings'
  | 'exchange'
  | 'incomes'
  | 'devices'
  | 'bot'
  | 'item-search'
  | 'purchase'
  | 'finished-search'
  | 'privacy'
  | 'terms'
  | 'kit'
  | 'pay'
  | 'pay-done'

declare module 'vue-router' {
  interface RouteMeta {
    /** The dictionary key of the screen's title: its heading, the back label, the tab title. */
    titleKey: string
    /** Set on a section; the tab bar is shown only there. */
    tab?: Tab
    /**
     * Set on a nested screen. The back chevron is labelled with the parent's title and leads
     * to it, so no screen has to know where it was opened from.
     */
    parent?: RouteName
    /**
     * Other screens this one may be opened from and lead back to, named by `?from=` — a finished
     * trip opened from «Деньги» says «‹ Деньги» (MOL-82, В-3). Listed, so an address cannot make
     * just any screen the parent.
     */
    from?: readonly RouteName[]
    /**
     * Drawn without a session: `App.vue` puts the login screen in front of every other route
     * (MOL-56). Only what is read before deciding to sign in may carry it — today «Данные и
     * приватность» alone (MOL-58).
     */
    public?: boolean
    /**
     * A screen of a feature under an «фф» (MOL-382): while it is off, the screen is an address the app
     * does not have, and a move there lands home as any unknown one does (`closedByFf`).
     */
    ff?: FfName
  }
}

// Every screen but home is a chunk of its own, loaded when first opened (MOL-337): a cold start at
// the shelf parses home and nothing else. MOL-17 kept them all in one bundle so that the first tap on
// a tab would never go to the network where the connection drops — that still holds: every screen is
// fetched after the first paint (`warmScreens`) and lies in the precache, and one that failed to load
// all the same is opened by a full load of its address (`reloadOnStaleChunk`). Home stays in the bundle:
// it is where the app opens and where «back» leads.
export const routes = [
  {
    path: '/settings',
    name: 'settings',
    component: lazyScreen(() => import('@/views/SettingsView.vue')),
    meta: { titleKey: 'settings.title', tab: 'settings' },
  },
  // Moved to «Деньги» (MOL-81): a bookmark or the history of an installed app still arrives.
  { path: '/settings/exchange', redirect: { name: 'exchange' } },
  { path: '/settings/incomes', redirect: { name: 'incomes' } },
  {
    path: '/settings/devices',
    name: 'devices',
    component: lazyScreen(() => import('@/views/DevicesView.vue')),
    meta: { titleKey: 'devices.title', parent: 'settings' },
  },
  {
    path: '/settings/bot',
    name: 'bot',
    component: lazyScreen(() => import('@/views/BotView.vue')),
    meta: { titleKey: 'bot.title', parent: 'settings' },
  },
  // Payment by card (MOL-277), while the фф `payments` is on: the screen, and the page the bank sends the browser
  // back to — the payment's id in the path, since the bank adds its own query to whatever address it was given.
  {
    path: '/pay',
    name: 'pay',
    component: lazyScreen(() => import('@/views/PayView.vue')),
    meta: { titleKey: 'pay.title', parent: 'settings', ff: 'payments' },
  },
  {
    path: '/pay/done/:paymentId',
    name: 'pay-done',
    component: lazyScreen(() => import('@/views/PayDoneView.vue')),
    meta: { titleKey: 'pay.title', parent: 'settings', ff: 'payments' },
  },
  {
    path: '/',
    name: 'advice',
    component: AdviceView,
    meta: { titleKey: 'advice.title', tab: 'advice' },
  },
  // «Что брать» became home and «Поход» became «Покупки» (MOL-128): a bookmark or the history of
  // an installed app still arrives, for good (MOL-81).
  { path: '/advice', redirect: { name: 'advice' } },
  {
    path: '/purchases',
    name: 'purchases',
    component: lazyScreen(() => import('@/views/PurchasesView.vue')),
    meta: { titleKey: 'purchases.title', tab: 'purchases' },
  },
  // The record typed by hand, the screen that was «Поход» with a trip going on. Before the
  // records by id, though a static segment outranks a parameter anyway.
  {
    path: '/purchases/manual',
    name: 'purchase-manual',
    component: lazyScreen(() => import('@/views/TripView.vue')),
    meta: { titleKey: 'trip.title', parent: 'purchases' },
  },
  {
    path: '/purchases/manual/add',
    name: 'item-search',
    component: lazyScreen(() => import('@/views/ItemSearchView.vue')),
    meta: { titleKey: 'item.search_title', parent: 'purchase-manual' },
  },
  // A receipt before it is recorded (MOL-127). Before the records by id: a static segment outranks
  // a parameter, and `receipts` must never be read as a trip.
  {
    path: '/purchases/receipts/:receiptId',
    name: 'purchase-receipt',
    component: lazyScreen(() => import('@/views/ReceiptView.vue')),
    meta: { titleKey: 'receipt.review.title_loading', parent: 'purchases' },
  },
  {
    path: '/purchases/:tripId',
    name: 'purchase',
    component: lazyScreen(() => import('@/views/FinishedTripView.vue')),
    // «Запись», as the record still being typed: the screen is named by its place, and the chevron of
    // its search reads the route's name — «Записанные покупки» there stood for words the screen it led
    // to never said (MOL-208, Е-13, owner's В-1 «а»).
    meta: {
      titleKey: 'trip.title',
      parent: 'purchases',
      from: ['money', 'money-spendings'],
    },
  },
  {
    path: '/purchases/:tripId/add',
    name: 'finished-search',
    component: lazyScreen(() => import('@/views/ItemSearchView.vue')),
    meta: { titleKey: 'item.search_title', parent: 'purchase' },
  },
  { path: '/trip', redirect: { name: 'purchases' } },
  { path: '/trip/add', redirect: { name: 'item-search' } },
  { path: '/trip/history', redirect: { name: 'purchases' } },
  {
    path: '/trip/history/:tripId',
    redirect: (to) => ({ name: 'purchase', params: to.params, query: to.query }),
  },
  {
    path: '/trip/history/:tripId/add',
    redirect: (to) => ({ name: 'finished-search', params: to.params }),
  },
  {
    path: '/verdicts',
    name: 'verdicts',
    component: lazyScreen(() => import('@/views/VerdictsView.vue')),
    meta: { titleKey: 'verdict.title', tab: 'verdicts' },
  },
  // The month is in the address (`?month=2026-09`) and changes by `replace` (MOL-82).
  {
    path: '/money',
    name: 'money',
    component: lazyScreen(() => import('@/views/MoneyView.vue')),
    meta: { titleKey: 'spending.title', tab: 'money' },
  },
  // «Траты» (MOL-159): the journal of the month «Деньги» has open, the month in the same address.
  {
    path: '/money/spendings',
    name: 'money-spendings',
    component: lazyScreen(() => import('@/views/MoneySpendingsView.vue')),
    meta: { titleKey: 'spending.list.title', parent: 'money' },
  },
  // «Бюджет» (MOL-117): the plans of the month «Деньги» has open, the month in the same address.
  {
    path: '/money/budget',
    name: 'money-budget',
    component: lazyScreen(() => import('@/views/MoneyBudgetView.vue')),
    meta: { titleKey: 'budget.title', parent: 'money' },
  },
  {
    path: '/money/exchange',
    name: 'exchange',
    component: lazyScreen(() => import('@/views/ExchangeView.vue')),
    meta: { titleKey: 'exchange.title', parent: 'money' },
  },
  {
    path: '/money/incomes',
    name: 'incomes',
    component: lazyScreen(() => import('@/views/IncomesView.vue')),
    meta: { titleKey: 'income.title', parent: 'money' },
  },
  // «Графики» (MOL-74, MOL-158): «Месяц · Год» (`?mode=year`), the month (`?month=`) and the
  // category (`?category=`) move by `replace`. The period of MOL-74 (`?period=`) is the year now,
  // so a bookmark of it still opens what it showed (handoff MOL-157 06).
  {
    path: '/money/charts',
    name: 'money-charts',
    component: lazyScreen(() => import('@/views/MoneyChartsView.vue')),
    meta: { titleKey: 'spending.charts.title', parent: 'money' },
    beforeEnter: (to) => {
      if (to.query.period === undefined) return true
      const kept = Object.entries(to.query).filter(([name]) => name !== 'period')
      return { ...to, query: { ...Object.fromEntries(kept), mode: 'year' }, replace: true }
    },
  },
  {
    path: '/money/categories',
    name: 'money-categories',
    component: lazyScreen(() => import('@/views/MoneyCategoriesView.vue')),
    meta: { titleKey: 'spending.categories.title', parent: 'money' },
  },
  // «Счета» and one account (MOL-123): where the money lies, counted by the server.
  {
    path: '/money/accounts',
    name: 'money-accounts',
    component: lazyScreen(() => import('@/views/AccountsView.vue')),
    meta: { titleKey: 'accounts.title', parent: 'money' },
  },
  {
    path: '/money/accounts/:accountId',
    name: 'money-account',
    component: lazyScreen(() => import('@/views/AccountView.vue')),
    meta: { titleKey: 'accounts.title', parent: 'money-accounts' },
  },
  // Under the settings, and open without a session: it is read before deciding to sign in (MOL-58).
  {
    path: '/privacy',
    name: 'privacy',
    component: lazyScreen(() => import('@/views/PrivacyView.vue')),
    meta: { titleKey: 'privacy.title', parent: 'settings', public: true },
  },
  // Beside it, and open without a session for the same reason: it is read before saying yes to it
  // (MOL-95).
  {
    path: '/terms',
    name: 'terms',
    component: lazyScreen(() => import('@/views/TermsView.vue')),
    meta: { titleKey: 'terms.title', parent: 'settings', public: true },
  },
  // Every piece of the kit in every state, and the sheet in a real history — for the eye in both
  // schemes and for the end-to-end tests, before any screen uses them (MOL-18). Development only:
  // in a production build the condition is false, the chunk is never emitted, and the path falls
  // through to home.
  ...(import.meta.env.DEV
    ? [
        {
          path: '/_kit',
          name: 'kit',
          component: () => import('@/views/KitView.vue'),
          meta: { titleKey: 'dev.kit.title', parent: 'advice' },
        } satisfies RouteRecordRaw & { name: RouteName },
      ]
    : []),
  { path: '/:rest(.*)', redirect: '/' },
] satisfies (RouteRecordRaw & { name?: RouteName })[]

// Before the web history exists, so the browser's own back animation is known in time — see
// `watchBrowserAnimatedBack`.
watchBrowserAnimatedBack()

/**
 * Back and forward return to where the person was; any other move to another screen starts at the
 * top. The sections keep no scroll of their own — their state lives in stores, not in components.
 *
 * A move to the same address is not the router's to scroll. It is one of two things. A sheet put
 * away: the sheet puts the page back itself, by the element it was opened from (`putBack` in
 * useSheetHistory.ts); scrolling back to the number saved when it opened moved the list by
 * whatever changed above the screen meanwhile — a list reread, a queued row sent, a notice come or
 * gone — which the browser had already kept out of sight (MOL-63). Or a push to where the router
 * already is: it refuses the duplicate and still asks this function, from the screen to itself.
 *
 * The first navigation is not one of them, though it comes «from» `START_LOCATION`, whose address
 * is «/»: that is the page loaded again — «back» into the app from another site — and the number
 * the router saved on `pagehide` is where the person was. Read as the same address, home, and only
 * home, forgot it (adversarial В1).
 *
 * A move that changes only the query is the screen's own state (`sameScreen`), and the page stays
 * where it is: the person chose the category to look at its chart, three cards down, and the top
 * took it away (MOL-136). The same route with other params is another screen.
 */
export const scrollBehavior: RouterScrollBehavior = (to, from, saved) => {
  if (from === START_LOCATION) return saved ?? { top: 0 }
  if (to.fullPath === from.fullPath) return false
  return saved ?? (sameScreen(from, to) ? false : { top: 0 })
}

/** What a person does to the page, never what the app does to it: a scroll or a focus may be the app's. */
const TOUCHES = ['pointerdown', 'touchstart', 'keydown', 'wheel', 'input'] as const

/**
 * A screen whose «фф» is off is not there (MOL-382): home, as `/:rest(.*)` sends an address the app does
 * not have — the same move, so nothing says the feature exists. Asked of the фф the phone last heard; a
 * screen already open stays until it is left.
 *
 * What the phone last heard may be older than the API: a link opened cold is judged before any answer
 * (adversarial А2). So the next answer decides: naming the фф on, it takes the person where the link was
 * going — if they are still where this move landed, behind the door too, which stands over the route, and
 * have not touched the page since, nor has a sheet opened there: the answer may come minutes later, with
 * the connection, and what is typed in a sheet or the search, a list scrolled, a finger over a row would go
 * with the screen (adversarial Б1, В1). One move (В2): over a home that stands alone — a cold start — it is
 * laid on top, so «back» steps home and never out of the app (Б2); over an entry of the app it takes home's
 * place, so «back» leads where the person was.
 */
export function closedByFf(router: Router): NavigationGuard {
  return (to) => {
    const ff = to.meta.ff
    if (ff === undefined || ffOn(ff)) return true
    const wanted = to.fullPath
    const touched = new AbortController()
    for (const kind of TOUCHES) {
      document.addEventListener(
        kind,
        () => {
          touched.abort()
        },
        {
          capture: true,
          passive: true,
          signal: touched.signal,
        },
      )
    }
    atNextFf(() => {
      const moved = touched.signal.aborted
      touched.abort()
      if (moved || !ffOn(ff) || sheetOpen(router)) return
      if (router.currentRoute.value.redirectedFrom?.fullPath !== wanted) return
      const below: unknown = router.options.history.state.back
      void (typeof below === 'string' ? router.replace(wanted) : router.push(wanted))
    })
    return '/'
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- its replacement is still vue-router/experimental
  scrollBehavior,
})
router.beforeEach(closedByFf(router))
