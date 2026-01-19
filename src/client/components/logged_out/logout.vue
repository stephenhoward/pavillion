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
import { useInvitationStore } from '@/client/stores/invitationStore';
import { useApplicationStore } from '@/client/stores/applicationStore';

const router = useRouter();
const authentication = inject('authn');
const calendarStore = useCalendarStore();
const feedStore = useFeedStore();
const eventStore = useEventStore();
const categoryStore = useCategoryStore();
const invitationStore = useInvitationStore();
const applicationStore = useApplicationStore();

onBeforeMount( () => {
  authentication.logout();
  // Clear all user-specific stores to prevent data leakage between sessions
  calendarStore.$reset();
  feedStore.$reset();
  eventStore.$reset();
  categoryStore.$reset();
  invitationStore.$reset();
  applicationStore.$reset();
  router.replace('/');
});
</script>
