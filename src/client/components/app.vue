<script setup>
import { inject } from 'vue';
import ToastContainer from '@/client/components/common/toast-container.vue';
import SessionExpiredModal from '@/client/components/common/session-expired-modal.vue';

const authn = inject('authn');
</script>

<template>
  <RouterView />
  <ToastContainer />
  <SessionExpiredModal v-if="authn?.sessionExpired?.value" />
</template>

<style lang="scss">
/* Semantic styling - no legacy mixins needed */
</style>
