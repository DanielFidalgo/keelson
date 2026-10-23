import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';
import IncidentsPage from './pages/IncidentsPage.vue';
import MonitorPage from './pages/MonitorPage.vue';
import MonitorsPage from './pages/MonitorsPage.vue';

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      { path: '/', name: 'monitors', component: MonitorsPage },
      { path: '/monitors/:id', name: 'monitor', component: MonitorPage, props: true },
      { path: '/incidents', name: 'incidents', component: IncidentsPage },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  });
}
