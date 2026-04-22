<script setup lang="ts">
import { inject } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';

import Modal from '@/client/components/common/modal.vue';
import LoginForm from '@/client/components/logged_out/LoginForm.vue';

const authn = inject('authn') as any;
const router = useRouter();

const { t } = useTranslation('authentication', {
  keyPrefix: 'session_expired',
});

async function handleSuccess() {
  await authn.drainPendingRequests();
}

function handleClose() {
  authn.abortPendingRequests();
  router.push('/auth/login');
}
</script>

<template>
  <Modal
    :title="t('title')"
    size="md"
    @close="handleClose"
  >
    <p class="session-expired-description">{{ t('description') }}</p>
    <LoginForm
      :initial-email="authn.lastKnownEmail ?? ''"
      heading-level="h3"
      @success="handleSuccess"
    />
  </Modal>
</template>

<style scoped lang="scss">
.session-expired-description {
  margin: 0 0 var(--pav-space-lg) 0;
  color: var(--pav-text-secondary);
  font-size: 0.9375rem;
  line-height: 1.5;
}
</style>
