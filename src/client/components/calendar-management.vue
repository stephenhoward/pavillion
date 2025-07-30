<script setup>
import { reactive, nextTick, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import CategoriesTab from './calendar-management/categories.vue';
import EditorsTab from './calendar-management/editors.vue';
import CalendarService from '../service/calendar';

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
  <div class="calendar-management">
    <div class="management-header">
      <h1>{{ t('page_title') }}: @{{ state.calendar?.urlName }}</h1>
    </div>

    <div role="tablist" class="tab-list">
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
    </div>

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
  </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

.calendar-management {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.management-header {
  margin-bottom: 32px;

  h1 {
    margin: 0 0 8px 0;
    color: #1f2937;
    font-size: 2rem;
    font-weight: 600;
  }

  .calendar-name {
    margin: 0;
    color: #6b7280;
    font-size: 1rem;
  }
}

.tab-list {
  display: flex;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 24px;
}

.tab {
  padding: 12px 24px;
  background: none;
  border: none;
  font-size: 16px;
  font-weight: 500;
  color: #6b7280;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s ease;

  &:hover {
    color: #374151;
    background-color: #f9fafb;
  }

  &[aria-selected="true"] {
    color: #ea580c;
    border-bottom-color: #ea580c;
  }
}

.tab-panel {
  min-height: 400px;
}

@include dark-mode {
  .management-header h1 {
    color: $dark-mode-text;
  }

  .management-header .calendar-name {
    color: $dark-mode-secondary-text;
  }

  .tab-list {
    border-bottom-color: $dark-mode-border;
  }

  .tab {
    color: $dark-mode-secondary-text;

    &:hover {
      color: $dark-mode-text;
      background-color: $dark-mode-selected-background;
    }

    &[aria-selected="true"] {
      color: #f97316;
    }
  }
}
</style>
