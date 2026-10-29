<script setup lang="ts">
import { inject } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';

import Modal from '@/client/components/common/modal.vue';
import LoginForm from '@/client/components/logged_out/LoginForm.vue';
import { currentAccountId } from '@/client/service/authn';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { resetUserStores } from '@/client/stores/reset-user-stores';

const authn = inject('authn') as any;
const router = useRouter();
const calendarStore = useCalendarStore();

const { t } = useTranslation('authentication', {
  keyPrefix: 'session_expired',
});

/**
 * After re-authentication, carry on where the account left off, unless a
 * different account signed in. The "before" account is the one the calendar
 * store was loaded for: the expired token can no longer answer, because
 * `currentAccountId()` returns null once its `exp` has passed.
 *
 * On an account change the previous account's state is cleared and its queued
 * requests are aborted, never replayed: replaying them under the new token
 * would attribute the previous account's mutations to the new one.
 */
async function handleSuccess() {
  const previousAccountId = calendarStore.accountId;
  if (previousAccountId === currentAccountId()) {
    await authn.drainPendingRequests();
    return;
  }
  resetUserStores();
  authn.abortPendingRequests();
  router.replace('/');
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
