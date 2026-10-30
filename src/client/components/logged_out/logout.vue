<template>
  <main role="main" aria-label="Logout">
    <p>Signing you out...</p>
  </main>
</template>

<script setup>
import { inject, onBeforeMount } from 'vue';
import { useRouter } from 'vue-router';
import { resetUserStores } from '@/client/stores/reset-user-stores';

const router = useRouter();
const authentication = inject('authn');

onBeforeMount( () => {
  // Sign out before clearing the stores: a reset re-runs state initializers
  // that read storage, which must no longer hold the previous session.
  authentication.logout();
  // Clear all user-specific stores to prevent data leakage between sessions
  resetUserStores();
  router.replace('/');
});
</script>
