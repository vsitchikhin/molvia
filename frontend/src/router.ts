import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import ItemSearchView from '@/views/ItemSearchView.vue'
import TripView from '@/views/TripView.vue'
import VerdictsView from '@/views/VerdictsView.vue'

/** The three sections of the tab bar. «trip» is home: the main scenario of the product. */
export type Tab = 'trip' | 'advice' | 'verdicts'

export type RouteName = 'trip' | 'advice' | 'verdicts' | 'item-search'

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
  }
}

// Not lazy: four small screens, and a chunk per route would turn the first tap on a tab into
// a network request exactly where the connection drops.
export const routes = [
  { path: '/', name: 'trip', component: TripView, meta: { titleKey: 'trip.title', tab: 'trip' } },
  {
    path: '/advice',
    name: 'advice',
    component: HomeView,
    meta: { titleKey: 'advice.title', tab: 'advice' },
  },
  {
    path: '/verdicts',
    name: 'verdicts',
    component: VerdictsView,
    meta: { titleKey: 'verdict.title', tab: 'verdicts' },
  },
  {
    path: '/trip/add',
    name: 'item-search',
    component: ItemSearchView,
    meta: { titleKey: 'item.search_title', parent: 'trip' },
  },
  { path: '/:rest(.*)', redirect: '/' },
] satisfies (RouteRecordRaw & { name?: RouteName })[]

export const router = createRouter({ history: createWebHistory(), routes })
