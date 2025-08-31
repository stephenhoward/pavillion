<script setup>
import { reactive, nextTick, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import CategoriesTab from './categories.vue';
import EditorsTab from './editors.vue';
import CalendarService from '../../../service/calendar';

const route = useRoute();
const calendarId = route.params.calendar;

const { t } = useTranslation('calendars', {
  keyPrefix: 'management',
});

const calendarService = new CalendarService();

const state = reactive({
  activeTab: 'categories',
});

onBeforeMount(async () => {
  state.calendar = await calendarService.getCalendarById(calendarId);
  console.log('Calendar data loaded:', state.calendar);
});

const activateTab = (tab) => {
  state.activeTab = tab;
  nextTick(() => {
    const panel = document.getElementById(`${tab}-panel`);
    if (panel) {
      panel.focus();
    }
  });
};

</script>

<template>
  <section class="calendar-management">
    <nav class="breadcrumb">
      <RouterLink class="breadcrumb__item" :to="`/calendar/${state.calendar?.urlName}`">📅 {{ state.calendar?.urlName }}</RouterLink>
      <span class="breadcrumb__item">{{ t('page_title') }}</span>
    </nav>

    <nav role="tablist" class="tab-list">
      <button
        type="button"
        role="tab"
        :aria-selected="state.activeTab === 'categories' ? 'true' : 'false'"
        aria-controls="categories-panel"
        class="tab"
        @click="activateTab('categories')"
      >
        {{ t('categories_tab') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="state.activeTab === 'editors' ? 'true' : 'false'"
        aria-controls="editors-panel"
        class="tab"
        @click="activateTab('editors')"
      >
        {{ t('editors_tab') }}
      </button>
    </nav>

    <div
      id="categories-panel"
      role="tabpanel"
      aria-labelledby="categories-tab"
      :aria-hidden="state.activeTab !== 'categories'"
      :hidden="state.activeTab !== 'categories'"
      class="tab-panel"
    >
      <CategoriesTab :calendar-id="calendarId" />
    </div>

    <div
      id="editors-panel"
      role="tabpanel"
      aria-labelledby="editors-tab"
      :aria-hidden="state.activeTab !== 'editors'"
      :hidden="state.activeTab !== 'editors'"
      class="tab-panel"
    >
      <EditorsTab :calendar-id="calendarId" />
    </div>
  </section>
</template>
