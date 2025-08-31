<template>
  <main role="main" aria-label="Logout">
    <p>Signing you out...</p>
  </main>
</template>

<script setup>
import { inject, onBeforeMount } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const authentication = inject('authn');

onBeforeMount( () => {
  authentication.logout();
  router.replace('/');
});
</script>
