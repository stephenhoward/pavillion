<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import EmptyState from '@/client/components/common/empty_state.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import CreateCalendarSheet from './create-calendar-sheet.vue';

/**
 * Zero-calendar empty state, rendered in place at bare `/calendar` when the
 * account owns and edits no calendar. Creating one navigates to it, which
 * makes it current through the route sync guard.
 */

const { t } = useTranslation('calendars', { keyPrefix: 'list' });

const showCreateSheet = ref(false);
const triggerEl = ref<HTMLElement | null>(null);

function openCreateSheet(event: MouseEvent) {
  triggerEl.value = (event.currentTarget as HTMLElement) ?? null;
  showCreateSheet.value = true;
}

async function closeCreateSheet() {
  showCreateSheet.value = false;
  await nextTick();
  triggerEl.value?.focus();
}
</script>

<template>
  <div class="no-calendars">
    <EmptyState
      :title="t('no_calendars_title')"
      :description="t('no_calendars_description')"
      :guide="{ slug: 'guides/calendar-owners/quickstart', key: 'quickstart' }"
      :guide-label="t('guide_link')"
    >
      <PillButton variant="primary" @click="openCreateSheet">
        {{ t('create_calendar_button') }}
      </PillButton>
    </EmptyState>
    <CreateCalendarSheet v-if="showCreateSheet" @close="closeCreateSheet" />
  </div>
</template>
