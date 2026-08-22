<template>
  <main role="main" aria-label="Logout">
    <p>Signing you out...</p>
  </main>
</template>

<script setup>
import { inject, onBeforeMount } from 'vue';
import { useRouter } from 'vue-router';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFeedStore } from '@/client/stores/feedStore';
import { useEventStore } from '@/client/stores/eventStore';
import { useCategoryStore } from '@/client/stores/categoryStore';
import { useSeriesStore } from '@/client/stores/seriesStore';
import { useInvitationStore } from '@/client/stores/invitationStore';
import { useApplicationStore } from '@/client/stores/applicationStore';
import { useFundingStore } from '@/client/stores/fundingStore';
import { useCalendarAdminStore } from '@/client/stores/calendarAdminStore';
import { useLocationStore } from '@/client/stores/locationStore';
import { useModerationStore } from '@/client/stores/moderation-store';
import { useNotificationStore } from '@/client/stores/notificationStore';

const router = useRouter();
const authentication = inject('authn');
const calendarStore = useCalendarStore();
const feedStore = useFeedStore();
const eventStore = useEventStore();
const categoryStore = useCategoryStore();
const seriesStore = useSeriesStore();
const invitationStore = useInvitationStore();
const applicationStore = useApplicationStore();
const fundingStore = useFundingStore();
const calendarAdminStore = useCalendarAdminStore();
const locationStore = useLocationStore();
const moderationStore = useModerationStore();
const notificationStore = useNotificationStore();

onBeforeMount( () => {
  authentication.logout();
  // Clear all user-specific stores to prevent data leakage between sessions
  calendarStore.$reset();
  feedStore.$reset();
  eventStore.$reset();
  categoryStore.$reset();
  seriesStore.$reset();
  invitationStore.$reset();
  applicationStore.$reset();
  fundingStore.$reset();
  calendarAdminStore.$reset();
  locationStore.$reset();
  moderationStore.$reset();
  notificationStore.$reset();
  router.replace('/');
});
</script>
